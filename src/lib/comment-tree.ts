import type { CommentNode } from "@/types/comments";

/** Обновляет счётчики реакций у одного комментария (с вложенными ответами), с разделением ссылок где возможно. */
export function patchCommentReactions(
  nodes: CommentNode[],
  commentId: string,
  patch: Pick<CommentNode, "likeCount" | "dislikeCount" | "likedByMe" | "dislikedByMe">
): CommentNode[] {
  let changed = false;
  const out = nodes.map((n) => {
    if (n.id === commentId) {
      changed = true;
      return { ...n, ...patch };
    }
    if (n.replies?.length) {
      const nextReplies = patchCommentReactions(n.replies, commentId, patch);
      if (nextReplies !== n.replies) {
        changed = true;
        return { ...n, replies: nextReplies };
      }
    }
    return n;
  });
  return changed ? out : nodes;
}
