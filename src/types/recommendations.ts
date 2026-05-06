import type { PostCard } from "@/types/posts";

export type RecommendationBlockName =
  | "forYou"
  | "fromFriends"
  | "trending"
  | "newInFavoriteTags";

export type RecommendationsHomeResponse = {
  blocks: Record<RecommendationBlockName, PostCard[]>;
};
