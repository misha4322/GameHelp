import { and, desc, eq, inArray, isNotNull, sql, or } from "drizzle-orm";

import { db } from "@/server/db";
import { comments, friendships, messages, postLikes, posts } from "@/server/db/schema";
import { RECOMMENDATIONS_API_MAX_LIMIT } from "@/lib/recommendations-display";
import { loadRecSignalsForViewer, recentConsumptionPenalty } from "@/server/recommendation-signals";
import type { RecommendationsHomeResponse } from "@/types/recommendations";

type ReasonCode =
  | "because_friend_liked"
  | "because_friend_posted"
  | "similar_tags"
  | "similar_category"
  | "popular_now"
  | "fresh_pick";

async function getPublishedPosts() {
  return db.query.posts.findMany({
    where: eq(posts.isPublished, true),
    orderBy: [desc(posts.createdAt)],
    limit: 500,
    with: {
      author: true,
      category: true,
      postTags: {
        with: {
          tag: true,
        },
      },
    },
  });
}

type PostWithRelations = Awaited<ReturnType<typeof getPublishedPosts>>[number];

type RecommendationScore = {
  total: number;
  social: number;
  tagMatch: number;
  categoryMatch: number;
  engagement: number;
  freshness: number;
};

function buildPostPayload(
  post: PostWithRelations,
  reasonCode: ReasonCode,
  reasonText: string,
  score: number,
  stats?: { views: number; likeCount: number; dislikeCount: number }
) {
  return {
    id: post.id,
    slug: post.slug,
    title: post.title,
    content: post.content,
    coverImage: post.coverImage ?? null,
    createdAt: post.createdAt?.toISOString?.() ?? null,
    views: stats?.views ?? Number(post.views ?? 0),
    likeCount: stats?.likeCount ?? 0,
    dislikeCount: stats?.dislikeCount ?? 0,
    author: post.author
      ? {
          id: post.author.id,
          username: post.author.username,
          avatarUrl: post.author.avatarUrl ?? null,
          isFriend: false,
        }
      : null,
    category: post.category
      ? {
          id: post.category.id,
          title: post.category.title,
        }
      : null,
    tags: post.postTags.map((entry) => ({
      id: entry.tag.id,
      name: entry.tag.name,
    })),
    reasonCode,
    reasonText,
    score: Number(score.toFixed(2)),
  };
}

function hoursSince(date: Date | null | undefined) {
  if (!date) return 48;
  return Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60));
}

function createCountMap<T extends string>(entries: T[]) {
  const map = new Map<T, number>();
  for (const value of entries) {
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return map;
}

async function getFriendIds(viewerId: string) {
  const rows = await db
    .select({
      requesterId: friendships.requesterId,
      addresseeId: friendships.addresseeId,
    })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, "accepted"),
        or(eq(friendships.requesterId, viewerId), eq(friendships.addresseeId, viewerId))
      )
    );

  return rows.map((row) =>
    row.requesterId === viewerId ? row.addresseeId : row.requesterId
  );
}

function pickReason(
  score: RecommendationScore,
  flags: {
    hasFriendLike: boolean;
    hasFriendComment: boolean;
    hasFriendShare: boolean;
    hasFriendAuthor: boolean;
    hasTagMatch: boolean;
    hasCategoryMatch: boolean;
  }
): { code: ReasonCode; text: string } {
  if (
    score.social >= score.tagMatch &&
    score.social >= score.categoryMatch &&
    (flags.hasFriendLike || flags.hasFriendComment || flags.hasFriendShare)
  ) {
    return {
      code: "because_friend_liked",
      text: "Ваши друзья активно взаимодействуют с этим постом",
    };
  }

  if (flags.hasFriendAuthor) {
    return {
      code: "because_friend_posted",
      text: "Пост от пользователя из вашего круга друзей",
    };
  }

  if (flags.hasTagMatch && score.tagMatch >= score.categoryMatch) {
    return {
      code: "similar_tags",
      text: "Совпадает с тегами, которые вам интересны",
    };
  }

  if (flags.hasCategoryMatch) {
    return {
      code: "similar_category",
      text: "Подходит под категории, которые вы чаще читаете",
    };
  }

  if (score.freshness > 12) {
    return {
      code: "fresh_pick",
      text: "Свежая публикация, которая набирает внимание",
    };
  }

  return {
    code: "popular_now",
    text: "Популярно у сообщества прямо сейчас",
  };
}

/** Общая логика главной страницы: Next.js API и Elysia */
export async function getRecommendationsHome(
  viewerId: string | null,
  limitRaw?: number
): Promise<RecommendationsHomeResponse> {
  const [allPosts, likesAgg, commentAgg] = await Promise.all([
    getPublishedPosts(),
    db
      .select({
        postId: postLikes.postId,
        type: postLikes.type,
        count: sql<number>`count(*)`.as("count"),
      })
      .from(postLikes)
      .groupBy(postLikes.postId, postLikes.type),
    db
      .select({
        postId: comments.postId,
        count: sql<number>`count(*)`.as("count"),
      })
      .from(comments)
      .groupBy(comments.postId),
  ]);

  const postsById = new Map(allPosts.map((post) => [post.id, post]));
  const allPostIds = allPosts.map((post) => post.id);
  const likeMap = new Map<string, number>();
  const dislikeMap = new Map<string, number>();
  const commentMap = new Map<string, number>();

  for (const row of likesAgg) {
    if (row.type === "like") likeMap.set(row.postId, Number(row.count) || 0);
    if (row.type === "dislike") dislikeMap.set(row.postId, Number(row.count) || 0);
  }
  for (const row of commentAgg) {
    commentMap.set(row.postId, Number(row.count) || 0);
  }

  let friendIds: string[] = [];
  let preferencePostIds: string[] = [];
  let preferredTagCounts = new Map<string, number>();
  let preferredCategoryCounts = new Map<string, number>();
  let friendLikedCounts = new Map<string, number>();
  let friendCommentCounts = new Map<string, number>();
  let friendSharedCounts = new Map<string, number>();
  const signalByPostId = new Map<
    string,
    { lastOpenAt: Date | null; lastClickAt: Date | null }
  >();

  if (viewerId) {
    friendIds = await getFriendIds(viewerId);

    const signalRows = await loadRecSignalsForViewer(viewerId);
    for (const r of signalRows) {
      signalByPostId.set(r.postId, {
        lastOpenAt: r.lastOpenAt,
        lastClickAt: r.lastClickAt,
      });
    }

    const richSignalPostIds = signalRows
      .filter(
        (r) =>
          r.openCount > 0 ||
          r.clickCount > 0 ||
          r.impressionCount >= 3 ||
          (r.impressionCount >= 1 &&
            r.lastImpressionAt &&
            Date.now() - r.lastImpressionAt.getTime() < 48 * 60 * 60 * 1000)
      )
      .map((r) => r.postId)
      .filter((id) => postsById.has(id));

    const [myLikes, myComments, myShares] = await Promise.all([
      db
        .select({ postId: postLikes.postId })
        .from(postLikes)
        .where(and(eq(postLikes.userId, viewerId), eq(postLikes.type, "like"))),
      db
        .select({ postId: comments.postId })
        .from(comments)
        .where(eq(comments.authorId, viewerId)),
      db
        .select({ postId: messages.sharedPostId })
        .from(messages)
        .where(and(eq(messages.senderId, viewerId), isNotNull(messages.sharedPostId))),
    ]);

    preferencePostIds = Array.from(
      new Set([
        ...myLikes.map((entry) => entry.postId),
        ...myComments.map((entry) => entry.postId),
        ...myShares
          .map((entry) => entry.postId)
          .filter((id): id is string => typeof id === "string"),
        ...richSignalPostIds,
      ])
    );

    const preferencePosts = preferencePostIds
      .map((id) => postsById.get(id))
      .filter((item): item is PostWithRelations => !!item);

    preferredTagCounts = createCountMap(
      preferencePosts.flatMap((post) => post.postTags.map((entry) => entry.tag.id))
    );
    preferredCategoryCounts = createCountMap(
      preferencePosts
        .map((post) => post.category?.id)
        .filter((id): id is string => typeof id === "string")
    );

    if (friendIds.length && allPostIds.length) {
      const [friendLikes, friendComments, friendShares] = await Promise.all([
        db
          .select({ postId: postLikes.postId })
          .from(postLikes)
          .where(
            and(
              inArray(postLikes.userId, friendIds),
              eq(postLikes.type, "like"),
              inArray(postLikes.postId, allPostIds)
            )
          ),
        db
          .select({ postId: comments.postId })
          .from(comments)
          .where(and(inArray(comments.authorId, friendIds), inArray(comments.postId, allPostIds))),
        db
          .select({ postId: messages.sharedPostId })
          .from(messages)
          .where(
            and(
              inArray(messages.senderId, friendIds),
              isNotNull(messages.sharedPostId),
              inArray(messages.sharedPostId, allPostIds)
            )
          ),
      ]);

      friendLikedCounts = createCountMap(friendLikes.map((entry) => entry.postId));
      friendCommentCounts = createCountMap(friendComments.map((entry) => entry.postId));
      friendSharedCounts = createCountMap(
        friendShares
          .map((entry) => entry.postId)
          .filter((id): id is string => typeof id === "string")
      );
    }
  }

  /** Нет истории (лайки/комменты/шеры/просмотры) и нет друзей — шире пул «для вас». */
  const coldStart =
    !!viewerId && preferencePostIds.length === 0 && friendIds.length === 0;
  const parsed = Number(limitRaw);
  const baseLimit = Number.isFinite(parsed) && parsed > 0 ? parsed : 48;
  const limit = coldStart
    ? Math.max(3, Math.min(220, baseLimit, RECOMMENDATIONS_API_MAX_LIMIT))
    : Math.max(3, Math.min(baseLimit, RECOMMENDATIONS_API_MAX_LIMIT));

  let pool = allPosts.filter((post) => (viewerId ? post.authorId !== viewerId : true));
  if (coldStart && pool.length === 0 && allPosts.length > 0) {
    pool = allPosts;
  }

  const friendSet = new Set(friendIds);
  const scored = pool
    .map((post) => {
      const postTagIds = post.postTags.map((entry) => entry.tag.id);
      const hasTagMatch = postTagIds.some((id) => preferredTagCounts.has(id));
      const hasCategoryMatch = !!post.categoryId && preferredCategoryCounts.has(post.categoryId);

      const tagMatch = postTagIds.reduce(
        (sum, id) => sum + (preferredTagCounts.get(id) ?? 0) * 1.8,
        0
      );
      const categoryMatch = post.categoryId
        ? (preferredCategoryCounts.get(post.categoryId) ?? 0) * 2.2
        : 0;

      const likes = likeMap.get(post.id) ?? 0;
      const dislikes = dislikeMap.get(post.id) ?? 0;
      const commentsCount = commentMap.get(post.id) ?? 0;
      const views = Number(post.views ?? 0);
      const engagement = Math.min(
        26,
        likes * 1.1 + commentsCount * 1.2 - dislikes * 0.55 + views * 0.03
      );

      const postAgeHours = hoursSince(post.createdAt ?? null);
      const freshness = Math.max(0, 20 - postAgeHours / 5);

      const friendLikeCount = friendLikedCounts.get(post.id) ?? 0;
      const friendCommentCount = friendCommentCounts.get(post.id) ?? 0;
      const friendShareCount = friendSharedCounts.get(post.id) ?? 0;
      const friendAuthor = post.author ? friendSet.has(post.author.id) : false;

      const social =
        friendLikeCount * 4.2 +
        friendCommentCount * 4 +
        friendShareCount * 5.5 +
        (friendAuthor ? 6 : 0);

      const consumePen = viewerId
        ? recentConsumptionPenalty(
            signalByPostId.get(post.id) ?? { lastOpenAt: null, lastClickAt: null }
          )
        : 0;

      const total =
        social +
        tagMatch +
        categoryMatch +
        engagement +
        freshness +
        (viewerId ? 0.5 : 0) -
        consumePen;

      const reason = pickReason(
        { total, social, tagMatch, categoryMatch, engagement, freshness },
        {
          hasFriendLike: friendLikeCount > 0,
          hasFriendComment: friendCommentCount > 0,
          hasFriendShare: friendShareCount > 0,
          hasFriendAuthor: friendAuthor,
          hasTagMatch,
          hasCategoryMatch,
        }
      );

      return {
        post,
        score: { total, social, tagMatch, categoryMatch, engagement, freshness },
        reason,
        friendLikeCount,
        friendCommentCount,
        friendShareCount,
        friendAuthor,
      };
    })
    .sort((a, b) => b.score.total - a.score.total);

  const seen = new Set<string>();
  const takeUnique = (
    rows: typeof scored,
    count: number,
    maxPerAuthor = 2
  ): ReturnType<typeof buildPostPayload>[] => {
    const output: ReturnType<typeof buildPostPayload>[] = [];
    const authorCap = new Map<string, number>();

    for (const row of rows) {
      if (output.length >= count) break;
      if (seen.has(row.post.id)) continue;

      const authorId = row.post.author?.id;
      if (authorId) {
        const alreadyByAuthor = authorCap.get(authorId) ?? 0;
        if (alreadyByAuthor >= maxPerAuthor) continue;
      }

      seen.add(row.post.id);
      if (authorId) {
        authorCap.set(authorId, (authorCap.get(authorId) ?? 0) + 1);
      }

      const payload = buildPostPayload(
        row.post,
        row.reason.code,
        row.reason.text,
        row.score.total,
        {
          views: Number(row.post.views ?? 0),
          likeCount: likeMap.get(row.post.id) ?? 0,
          dislikeCount: dislikeMap.get(row.post.id) ?? 0,
        }
      );
      if (payload.author?.id && friendSet.has(payload.author.id)) {
        payload.author.isFriend = true;
      }
      output.push(payload);
    }

    return output;
  };

  const forYouSource = viewerId
    ? coldStart
      ? [...scored].sort(
          (a, b) =>
            b.score.engagement +
            b.score.freshness -
            (a.score.engagement + a.score.freshness)
        )
      : scored
    : scored.filter((row) => row.score.engagement > 1);
  const fromFriendsSource = scored.filter(
    (row) =>
      row.friendAuthor ||
      row.friendLikeCount > 0 ||
      row.friendCommentCount > 0 ||
      row.friendShareCount > 0
  );
  const trendingSource = [...scored].sort(
    (a, b) =>
      b.score.engagement + b.score.freshness - (a.score.engagement + a.score.freshness)
  );
  const favoriteTagsSource = scored.filter((row) => row.score.tagMatch > 0).sort((a, b) => {
    const aFreshTag = a.score.tagMatch + a.score.freshness * 0.4;
    const bFreshTag = b.score.tagMatch + b.score.freshness * 0.4;
    return bFreshTag - aFreshTag;
  });

  const forYou = takeUnique(forYouSource, limit, 4);
  const fromFriends = takeUnique(fromFriendsSource, limit, 2);
  const trending = takeUnique(trendingSource, limit, 2);
  const newInFavoriteTags = takeUnique(favoriteTagsSource, limit, 2);

  return {
    blocks: {
      forYou,
      fromFriends,
      trending,
      newInFavoriteTags,
    },
  };
}
