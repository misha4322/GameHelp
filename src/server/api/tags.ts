import { Elysia, t } from "elysia";
import { db } from "../db";
import { tags, categories } from "../db/schema";

export const forumRouter = new Elysia()
    .get("/categories", async () => await db.select().from(categories))
    .get("/tags", async () => await db.select().from(tags))
    .post("/tags", async ({ body }) => {
        return await db.insert(tags).values(body).returning();
    }, {
        body: t.Object({ name: t.String() })
    });