// app/api/users/me/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { and, desc, eq, or } from "drizzle-orm";
import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { comments, friendships, posts, users } from "@/server/db/schema";
import { favoriteGamesToNameList, normalizeFavoriteGamesPatchValue } from "@/lib/favorite-games";
import { resolveUserUuid } from "@/lib/user-utils";

export const runtime = "nodejs";

function normalizeUsername(s: string) {
  return s.trim().replace(/\s+/g, " ").slice(0, 32);
}

function isValidUsername(s: string) {
  if (s.length < 3 || s.length > 32) return false;
  return /^[\p{L}\p{N} _.\-()]+$/u.test(s);
}

async function generateFriendCode() {
  while (true) {
    const code = `${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(
      1000 + Math.random() * 9000
    )}`;

    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.friendCode, code))
      .limit(1);

    if (!rows[0]) return code;
  }
}

async function ensureFriendCode(userId: string) {
  const rows = await db
    .select({
      id: users.id,
      friendCode: users.friendCode,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const user = rows[0];
  if (!user) return null;

  if (user.friendCode) return user.friendCode;

  const newCode = await generateFriendCode();
  await db.update(users).set({ friendCode: newCode }).where(eq(users.id, userId));
  return newCode;
}

async function getUserCounts(userId: string) {
  const [postsCountRows, commentsCountRows, friendsCountRows] = await Promise.all([
    db
      .select({ count: posts.id })
      .from(posts)
      .where(and(eq(posts.authorId, userId), eq(posts.isPublished, true))),
    db.select({ count: comments.id }).from(comments).where(eq(comments.authorId, userId)),
    db
      .select({ count: friendships.id })
      .from(friendships)
      .where(
        and(
          eq(friendships.status, "accepted"),
          or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))
        )
      ),
  ]);

  return {
    posts: postsCountRows.length,
    comments: commentsCountRows.length,
    friends: friendsCountRows.length,
  };
}

async function getRecentPosts(userId: string) {
  const list = await db
    .select({
      id: posts.id,
      slug: posts.slug,
      title: posts.title,
      coverImage: posts.coverImage,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(and(eq(posts.authorId, userId), eq(posts.isPublished, true)))
    .orderBy(desc(posts.createdAt))
    .limit(6);

  return list.map((post) => ({
    ...post,
    coverImage: post.coverImage ?? null,
    createdAt: post.createdAt?.toISOString?.() ?? post.createdAt,
  }));
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = await resolveUserUuid(session);
  if (!userId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const u = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      id: true,
      username: true,
      email: true,
      avatarUrl: true,
      profileBannerUrl: true,
      statusText: true,
      bio: true,
      location: true,
      websiteUrl: true,
      telegram: true,
      discord: true,
      steamProfileUrl: true,
      favoriteGames: true,
      showEmail: true,
      showFriendCode: true,
      friendCode: true,
      isProfilePrivate: true,
      createdAt: true,
    },
  });

  if (!u) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const [friendCode, counts, recentPosts] = await Promise.all([
    ensureFriendCode(userId),
    getUserCounts(userId),
    getRecentPosts(userId),
  ]);

  return NextResponse.json({
    user: {
      ...u,
      avatarUrl: u.avatarUrl ?? null,
      profileBannerUrl: u.profileBannerUrl ?? null,
      friendCode: friendCode ?? u.friendCode,
      favoriteGamesList: favoriteGamesToNameList(u.favoriteGames),
      createdAt: u.createdAt?.toISOString?.() ?? u.createdAt,
    },
    counts,
    recentPosts,
  });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = await resolveUserUuid(session);
  if (!userId) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

  const patch: Record<string, unknown> = {};

  if (has("username") && body.username !== undefined) {
    const username = normalizeUsername(String(body.username ?? ""));

    if (!isValidUsername(username)) {
      return NextResponse.json(
        { error: "Ник: 3–32 символа. Можно: буквы (в т.ч. кириллица), цифры, пробел, _, -, ., (, )" },
        { status: 400 }
      );
    }

    const existing = await db.query.users.findFirst({
      where: eq(users.username, username),
      columns: { id: true },
    });

    if (existing && existing.id !== userId) {
      return NextResponse.json({ error: "Этот ник уже занят" }, { status: 409 });
    }

    patch.username = username;
  }

  if (has("avatarUrl")) patch.avatarUrl = body.avatarUrl ?? null;
  if (has("profileBannerUrl")) patch.profileBannerUrl = body.profileBannerUrl ?? null;
  if (has("statusText")) patch.statusText = body.statusText ?? null;
  if (has("bio")) patch.bio = body.bio ?? null;
  if (has("location")) patch.location = body.location ?? null;
  if (has("websiteUrl")) patch.websiteUrl = body.websiteUrl ?? null;
  if (has("telegram")) patch.telegram = body.telegram ?? null;
  if (has("discord")) patch.discord = body.discord ?? null;
  if (has("steamProfileUrl")) patch.steamProfileUrl = body.steamProfileUrl ?? null;
  if (has("favoriteGames")) {
    const norm = normalizeFavoriteGamesPatchValue(body.favoriteGames);
    if (!norm.ok) {
      return NextResponse.json({ error: norm.error }, { status: 400 });
    }
    patch.favoriteGames = norm.value;
  }
  if (has("showEmail")) patch.showEmail = !!body.showEmail;
  if (has("showFriendCode")) patch.showFriendCode = !!body.showFriendCode;
  if (has("isProfilePrivate")) patch.isProfilePrivate = !!body.isProfilePrivate;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      username: users.username,
      email: users.email,
      avatarUrl: users.avatarUrl,
      profileBannerUrl: users.profileBannerUrl,
      statusText: users.statusText,
      bio: users.bio,
      location: users.location,
      websiteUrl: users.websiteUrl,
      telegram: users.telegram,
      discord: users.discord,
      steamProfileUrl: users.steamProfileUrl,
      favoriteGames: users.favoriteGames,
      showEmail: users.showEmail,
      showFriendCode: users.showFriendCode,
      friendCode: users.friendCode,
      isProfilePrivate: users.isProfilePrivate,
      createdAt: users.createdAt,
    });

  const user = updated[0];
  if (!user) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  const friendCode = (await ensureFriendCode(userId)) ?? user.friendCode;

  return NextResponse.json({
    success: true,
    user: {
      ...user,
      favoriteGamesList: favoriteGamesToNameList(user.favoriteGames),
      friendCode,
      createdAt: user.createdAt?.toISOString?.() ?? user.createdAt,
    },
  });
}
