import { Elysia, t } from "elysia";
import { db } from "../db";
import { categories, tags, posts } from "../db/schema";
import { eq, asc } from "drizzle-orm";

export const forumRouter = new Elysia({ prefix: "/forum" })

  .get("/categories", async () => {
    return await db.query.categories.findMany({
      orderBy: [asc(categories.title)],
    });
  })

  .get("/categories/:slug", async ({ params }) => {
    const result = await db.query.categories.findFirst({
      where: eq(categories.slug, params.slug),
      with: {
        posts: {
          where: eq(posts.isPublished, true),
          with: {
            author: true,
          },
        },
      },
    });


    return result ?? null;
  })

  .post(
    "/categories",
    async ({ body }) => {
      const inserted = await db
        .insert(categories)
        .values({
          title: body.title,
          slug: body.slug,
          description: body.description,
        })
        .returning();
      
      return inserted[0];
    },
    {
      body: t.Object({
        title: t.String(),
        slug: t.String(),
        description: t.Optional(t.String()),
      }),
    }
  )

  .get("/tags", async () => {
    return await db.select().from(tags);
  })

  .post(
    "/tags",
    async ({ body }) => {
      const inserted = await db
        .insert(tags)
        .values({
          name: body.name,
        })
        .returning();
      
      return inserted[0];
    },
    {
      body: t.Object({
        name: t.String(),
      }),
    }
  );