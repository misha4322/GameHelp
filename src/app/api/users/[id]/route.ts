import { NextResponse } from "next/server";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { comments, friendships, posts, users } from "@/server/db/schema";
import { favoriteGamesToNameList } from "@/lib/favorite-games";
import { resolveUserUuid } from "@/lib/user-utils";

export const runtime = "nodejs";

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
    .select({ id: users.id, friendCode: users.friendCode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.friendCode) return row.friendCode;
  const newCode = await generateFriendCode();
  await db.update(users).set({ friendCode: newCode }).where(eq(users.id, userId));
  return newCode;
}

async function getFriendStatus(viewerId: string | null, targetId: string) {
  if (!viewerId) return "none" as const;
  if (viewerId === targetId) return "self" as const;

  const directRows = await db
    .select({ status: friendships.status })
    .from(friendships)
    .where(and(eq(friendships.requesterId, viewerId), eq(friendships.addresseeId, targetId)))
    .limit(1);

  const reverseRows = await db
    .select({ status: friendships.status })
    .from(friendships)
    .where(and(eq(friendships.requesterId, targetId), eq(friendships.addresseeId, viewerId)))
    .limit(1);

  const direct = directRows[0];
  const reverse = reverseRows[0];

  if (direct?.status === "accepted" || reverse?.status === "accepted") return "friends" as const;
  if (direct?.status === "pending") return "outgoing" as const;
  if (reverse?.status === "pending") return "incoming" as const;
  return "none" as const;
}

/** Как в Elysia `/users/:id`: все посты автора (включая черновики) в счётчике. */
async function getUserCounts(userId: string) {
  const [postsRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(posts)
    .where(eq(posts.authorId, userId));

  const [commentsRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(comments)
    .where(eq(comments.authorId, userId));

  const [friendsRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, "accepted"),
        or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))
      )
    );

  return {
    posts: Number(postsRow?.count ?? 0),
    comments: Number(commentsRow?.count ?? 0),
    friends: Number(friendsRow?.count ?? 0),
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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: targetId } = await params;

    const session = await getServerSession(authOptions);
    const viewerId = session?.user ? await resolveUserUuid(session) : null;

    const rows = await db
      .select({
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
      })
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);

    const user = rows[0];
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const friendCode = await ensureFriendCode(user.id);
    const friendStatus = await getFriendStatus(viewerId, targetId);
    const canView = !user.isProfilePrivate || friendStatus === "self";

    if (!canView) {
      return NextResponse.json({
        user: {
          id: user.id,
          username: user.username,
          avatarUrl: null,
          profileBannerUrl: null,
          statusText: null,
          bio: null,
          location: null,
          websiteUrl: null,
          telegram: null,
          discord: null,
          steamProfileUrl: null,
          favoriteGames: null,
          favoriteGamesList: [],
          email: null,
          friendCode: null,
          showEmail: user.showEmail,
          isProfilePrivate: user.isProfilePrivate,
          createdAt: user.createdAt?.toISOString?.() ?? user.createdAt,
        },
        friendStatus,
        canView: false,
        counts: await getUserCounts(targetId),
        recentPosts: [],
      });
    }

    const counts = await getUserCounts(targetId);
    const recentPosts = await getRecentPosts(targetId);
    const isSelf = friendStatus === "self";

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl ?? null,
        profileBannerUrl: user.profileBannerUrl ?? null,
        statusText: user.statusText ?? null,
        bio: user.bio ?? null,
        location: user.location ?? null,
        websiteUrl: user.websiteUrl ?? null,
        telegram: user.telegram ?? null,
        discord: user.discord ?? null,
        steamProfileUrl: user.steamProfileUrl ?? null,
        favoriteGames: user.favoriteGames ?? null,
          favoriteGamesList: favoriteGamesToNameList(user.favoriteGames),
        email: isSelf || user.showEmail ? user.email ?? null : null,
        friendCode: isSelf || user.showFriendCode ? friendCode : null,
        showEmail: user.showEmail,
        isProfilePrivate: user.isProfilePrivate,
        createdAt: user.createdAt?.toISOString?.() ?? user.createdAt,
      },
      friendStatus,
      canView: true,
      counts,
      recentPosts,
    });
  } catch (e) {
    console.error("GET /api/users/[id]", e);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
