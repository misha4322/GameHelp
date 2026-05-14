import { Elysia, t } from "elysia";
import { db } from "../db";
import { postLikes, commentLikes } from "../db/schema"; 
import { and, eq } from "drizzle-orm";

export const likesRouter = new Elysia({ prefix: "/likes" })

    .post("/toggle", async ({ body }) => {
        const { postId, userId } = body;

        const existing = await db.query.postLikes.findFirst({
            where: and(eq(postLikes.postId, postId), eq(postLikes.userId, userId))
        });

        if (existing) {
            await db.delete(postLikes).where(eq(postLikes.id, existing.id));
            return { liked: false };
        } else {
            await db.insert(postLikes).values({ postId, userId, type: "like" });
            return { liked: true };
        }
    }, {
        body: t.Object({
            postId: t.String(),
            userId: t.String()
        })
    })

    .post("/post", async ({ body }) => {
        const { postId, userId } = body;
        const existing = await db.query.postLikes.findFirst({
            where: and(eq(postLikes.postId, postId), eq(postLikes.userId, userId))
        });

        if (existing) {
            await db.delete(postLikes).where(eq(postLikes.id, existing.id));
            return { liked: false };
        } else {
            await db.insert(postLikes).values({ postId, userId });
            return { liked: true };
        }
    }, {
        body: t.Object({
            postId: t.String(),
            userId: t.String()
        })
    })

    .post("/comment", async ({ body }) => {
        const { commentId, userId, type } = body;
        
        const existing = await db.query.commentLikes.findFirst({
            where: and(
                eq(commentLikes.commentId, commentId), 
                eq(commentLikes.userId, userId)
            )
        });

        if (existing) {
            if (existing.type === type) {
                await db.delete(commentLikes).where(eq(commentLikes.id, existing.id));
                return { action: "removed" };
            } else {
                await db.update(commentLikes)
                    .set({ type })
                    .where(eq(commentLikes.id, existing.id));
                return { action: "updated" };
            }
        } else {
            await db.insert(commentLikes).values({ 
                commentId, 
                userId, 
                type 
            });
            return { action: "added" };
        }
    }, {
        body: t.Object({
            commentId: t.String(),
            userId: t.String(),
            type: t.Union([t.Literal("like"), t.Literal("dislike")])
        })
    });