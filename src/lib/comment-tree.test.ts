import { describe, expect, it } from "vitest";
import type { CommentNode } from "@/types/comments";
import { patchCommentReactions } from "./comment-tree";

function makeNode(id: string, replies: CommentNode[] = []): CommentNode {
  return {
    id,
    postId: "p1",
    parentId: null,
    content: "c",
    createdAt: null,
    author: { id: "a1", username: "u", avatarUrl: null },
    likeCount: 0,
    likedByMe: false,
    dislikeCount: 0,
    dislikedByMe: false,
    replies,
    isDeleted: false,
    deletedBySelf: false,
    editedByStaff: false,
  };
}

describe("patchCommentReactions", () => {
  it("обновляет реакции у комментария верхнего уровня", () => {
    const tree = [makeNode("c1")];
    const next = patchCommentReactions(tree, "c1", {
      likeCount: 5,
      dislikeCount: 1,
      likedByMe: true,
      dislikedByMe: false,
    });
    expect(next[0]!.likeCount).toBe(5);
    expect(next[0]!.likedByMe).toBe(true);
    expect(next[0]!.id).toBe("c1");
  });

  it("обновляет реакции у вложенного ответа", () => {
    const inner = makeNode("c2");
    const tree = [makeNode("c1", [inner])];
    const next = patchCommentReactions(tree, "c2", {
      likeCount: 2,
      dislikeCount: 0,
      likedByMe: false,
      dislikedByMe: true,
    });
    expect(next[0]!.replies[0]!.dislikedByMe).toBe(true);
    expect(next[0]!.replies[0]!.likeCount).toBe(2);
  });
});
