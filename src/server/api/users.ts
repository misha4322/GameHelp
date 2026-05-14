import { Elysia, t } from "elysia";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

import { favoriteGamesToNameList, normalizeFavoriteGamesPatchValue } from "@/lib/favorite-games";
import { moderationBlockedHttpBody } from "../moderation";
import { applyModerationToProfilePatch } from "../profile-moderation";

import { db } from "../db";
import { comments, friendships, posts, users } from "../db/schema";

const nullableString = t.Union([t.String(), t.Null()]);

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function isFriendCode(value: string) {
  return /^\d{4}-\d{4}$/i.test(value.trim());
}

function normalizeUsername(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 32);
}

function isValidUsername(value: string) {
  if (value.length < 3 || value.length > 32) return false;
  return /^[\p{L}\p{N} _.\-()]+$/u.test(value);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
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

async function getFriendStatus(viewerId: string | null, targetId: string) {
  if (!viewerId) return "none" as const;
  if (viewerId === targetId) return "self" as const;

  const directRows = await db
    .select({ status: friendships.status })
    .from(friendships)
    .where(
      and(
        eq(friendships.requesterId, viewerId),
        eq(friendships.addresseeId, targetId)
      )
    )
    .limit(1);

  const reverseRows = await db
    .select({ status: friendships.status })
    .from(friendships)
    .where(
      and(
        eq(friendships.requesterId, targetId),
        eq(friendships.addresseeId, viewerId)
      )
    )
    .limit(1);

  const direct = directRows[0];
  const reverse = reverseRows[0];

  if (direct?.status === "accepted" || reverse?.status === "accepted") {
    return "friends" as const;
  }

  if (direct?.status === "pending") {
    return "outgoing" as const;
  }

  if (reverse?.status === "pending") {
    return "incoming" as const;
  }

  return "none" as const;
}

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
        or(
          eq(friendships.requesterId, userId),
          eq(friendships.addresseeId, userId)
        )
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

export const usersRouter = new Elysia({ prefix: "/users" })

  .get(
    "/search",
    async ({ query, set }) => {
      try {
        const q = String(query.q ?? "").trim();
        const viewerId = query.viewerId ? String(query.viewerId) : null;

        if (!q) {
          return { users: [] };
        }

        const conditions: any[] = [ilike(users.username, `%${q}%`)];

        if (isUuid(q)) {
          conditions.push(eq(users.id, q));
        }

        if (isFriendCode(q.toUpperCase())) {
          conditions.push(eq(users.friendCode, q.toUpperCase()));
        }

        const list = await db
          .select({
            id: users.id,
            username: users.username,
            avatarUrl: users.avatarUrl,
            friendCode: users.friendCode,
            isProfilePrivate: users.isProfilePrivate,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(conditions.length === 1 ? conditions[0] : or(...conditions))
          .limit(20);

        const result = await Promise.all(
          list.map(async (user) => {
            const friendStatus = await getFriendStatus(viewerId, user.id);
            const canView =
              !user.isProfilePrivate ||
              friendStatus === "self";

            return {
              id: user.id,
              username: user.username,
              avatarUrl: canView ? user.avatarUrl ?? null : null,
              friendCode:
                friendStatus === "self" ? user.friendCode ?? null : null,
              isProfilePrivate: user.isProfilePrivate,
              createdAt: user.createdAt?.toISOString?.() ?? user.createdAt,
              friendStatus,
              canView,
            };
          })
        );

        return { users: result };
      } catch (error: unknown) {
        console.error("GET /api/users/search error:", error);
        set.status = 500;
        return {
          error: "Internal Server Error",
          details:
            process.env.NODE_ENV === "development"
              ? getErrorMessage(error)
              : undefined,
        };
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        viewerId: t.Optional(t.String()),
      }),
    }
  )

  /** Не `/me/:id`: иначе коллизия с Next `/api/users/me/warnings`, `/api/users/me/ban-status`. */
  .get("/full-profile/:userId", async ({ params, set }) => {
    try {
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
        .where(eq(users.id, params.userId))
        .limit(1);

      const me = rows[0];

      if (!me) {
        set.status = 404;
        return { error: "User not found" };
      }

      const friendCode = await ensureFriendCode(me.id);
      const counts = await getUserCounts(me.id);
      const recentPosts = await getRecentPosts(me.id);

      return {
        user: {
          ...me,
          avatarUrl: me.avatarUrl ?? null,
          profileBannerUrl: me.profileBannerUrl ?? null,
          friendCode,
          favoriteGamesList: favoriteGamesToNameList(me.favoriteGames),
          createdAt: me.createdAt?.toISOString?.() ?? me.createdAt,
        },
        counts,
        recentPosts,
      };
    } catch (error: unknown) {
      console.error("GET /api/users/full-profile/:userId error:", error);
      set.status = 500;
      return {
        error: "Internal Server Error",
        details:
          process.env.NODE_ENV === "development"
            ? getErrorMessage(error)
            : undefined,
      };
    }
  })

  .patch(
    "/me",
    async ({ body, set }) => {
      try {
        const userId = body.userId;

        const rows = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        const target = rows[0];

        if (!target) {
          set.status = 404;
          return { error: "User not found" };
        }

        const patch: Record<string, unknown> = {};
        const has = (key: string) =>
          Object.prototype.hasOwnProperty.call(body, key);

        if (has("username")) {
          const username = normalizeUsername(String(body.username ?? ""));

          if (!isValidUsername(username)) {
            set.status = 400;
            return {
              error: "Ник: 3–32 символа. Можно буквы, цифры, пробел, _, -, ., (, )",
            };
          }

          const existingRows = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.username, username))
            .limit(1);

          const existing = existingRows[0];

          if (existing && existing.id !== userId) {
            set.status = 409;
            return { error: "Этот ник уже занят" };
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
            set.status = 400;
            return { error: norm.error };
          }
          patch.favoriteGames = norm.value;
        }

        if (has("showEmail")) patch.showEmail = !!body.showEmail;
        if (has("showFriendCode")) patch.showFriendCode = !!body.showFriendCode;
        if (has("isProfilePrivate")) patch.isProfilePrivate = !!body.isProfilePrivate;

        if (!Object.keys(patch).length) {
          set.status = 400;
          return { error: "Nothing to update" };
        }

        try {
          await applyModerationToProfilePatch(userId, patch);
        } catch (e) {
          const blocked = moderationBlockedHttpBody(e);
          if (blocked) {
            set.status = 400;
            return blocked;
          }
          throw e;
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
        const friendCode = await ensureFriendCode(user.id);

        return {
          success: true,
          user: {
            ...user,
            avatarUrl: user.avatarUrl ?? null,
            profileBannerUrl: user.profileBannerUrl ?? null,
            friendCode,
            favoriteGamesList: favoriteGamesToNameList(user.favoriteGames),
            createdAt: user.createdAt?.toISOString?.() ?? user.createdAt,
          },
        };
      } catch (error: unknown) {
        console.error("PATCH /api/users/me error:", error);
        set.status = 500;
        return {
          error: "Internal Server Error",
          details:
            process.env.NODE_ENV === "development"
              ? getErrorMessage(error)
              : undefined,
        };
      }
    },
    {
      body: t.Object({
        userId: t.String(),

        username: t.Optional(t.String()),
        avatarUrl: t.Optional(nullableString),
        profileBannerUrl: t.Optional(nullableString),
        statusText: t.Optional(nullableString),
        bio: t.Optional(nullableString),
        location: t.Optional(nullableString),
        websiteUrl: t.Optional(nullableString),
        telegram: t.Optional(nullableString),
        discord: t.Optional(nullableString),
        steamProfileUrl: t.Optional(nullableString),
        favoriteGames: t.Optional(nullableString),

        showEmail: t.Optional(t.Boolean()),
        showFriendCode: t.Optional(t.Boolean()),
        isProfilePrivate: t.Optional(t.Boolean()),
      }),
    }
  )

  .post(
    "/me/friend-code/regenerate",
    async ({ body, set }) => {
      try {
        const rows = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, body.userId))
          .limit(1);

        if (!rows[0]) {
          set.status = 404;
          return { error: "User not found" };
        }

        const newCode = await generateFriendCode();

        await db
          .update(users)
          .set({ friendCode: newCode })
          .where(eq(users.id, body.userId));

        return {
          success: true,
          friendCode: newCode,
        };
      } catch (error: unknown) {
        console.error("POST /api/users/me/friend-code/regenerate error:", error);
        set.status = 500;
        return {
          error: "Internal Server Error",
          details:
            process.env.NODE_ENV === "development"
              ? getErrorMessage(error)
              : undefined,
        };
      }
    },
    {
      body: t.Object({
        userId: t.String(),
      }),
    }
  )

  .get(
    "/:id",
    async ({ params, query, set }) => {
      try {
        const targetId = params.id;
        const viewerId = query.viewerId ? String(query.viewerId) : null;

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
          set.status = 404;
          return { error: "User not found" };
        }

        const friendCode = await ensureFriendCode(user.id);
        const friendStatus = await getFriendStatus(viewerId, targetId);
        const canView =
          !user.isProfilePrivate ||
          friendStatus === "self";

        if (!canView) {
          return {
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
          };
        }

        const counts = await getUserCounts(targetId);
        const recentPosts = await getRecentPosts(targetId);
        const isSelf = friendStatus === "self";

        return {
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
        };
      } catch (error: unknown) {
        console.error("GET /api/users/:id error:", error);
        set.status = 500;
        return {
          error: "Internal Server Error",
          details:
            process.env.NODE_ENV === "development"
              ? getErrorMessage(error)
              : undefined,
        };
      }
    },
    {
      query: t.Object({
        viewerId: t.Optional(t.String()),
      }),
    }
  );