export type CommentAuthor = {
  id: string;
  username: string;
  avatarUrl: string | null;
};

export type CommentNode = {
  id: string;
  postId: string;
  parentId: string | null;
  content: string;
  createdAt: string | null;
  author: CommentAuthor;
  likeCount: number;
  likedByMe: boolean;
  dislikeCount: number;
  dislikedByMe: boolean;
  replies: CommentNode[];
  /** Мягкое удаление: ответы под комментарием сохраняются */
  isDeleted: boolean;
  deletedBySelf: boolean;
  editedByStaff: boolean;
  /** Только для модераторов: сколько жалоб в очереди на этот комментарий */
  staffReportCount?: number;
};

export type PostCommentsResponse = {
  comments: CommentNode[];
};

export type UserWarningDto = {
  id: string;
  commentSnapshot: string | null;
  reason: string;
  createdAt: string;
};
