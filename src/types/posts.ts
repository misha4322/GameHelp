export type PostTag = {
  id: string;
  name: string;
};

export type PostAuthor = {
  id?: string;
  username?: string | null;
  avatarUrl?: string | null;
  isFriend?: boolean;
} | null;

export type PostCategory = {
  id?: string;
  title?: string | null;
} | null;

export type PostCard = {
  id: string;
  slug: string;
  title: string;
  content: string;
  createdAt: string | null;
  coverImage?: string | null;
  /** Просмотры и реакции — для карточек в ленте */
  views?: number;
  likeCount?: number;
  dislikeCount?: number;
  author?: PostAuthor;
  category?: PostCategory;
  tags?: PostTag[];
  reasonCode?:
    | "because_friend_liked"
    | "because_friend_posted"
    | "similar_tags"
    | "similar_category"
    | "popular_now"
    | "fresh_pick";
  reasonText?: string;
  score?: number;
};

export type PostDetails = PostCard & {
  likeCount: number;
  dislikeCount: number;
  likedByMe: boolean;
  dislikedByMe: boolean;
};

export type PostsListResponse = {
  posts: PostCard[];
};

export type PostDetailsResponse = {
  post: PostDetails;
};
