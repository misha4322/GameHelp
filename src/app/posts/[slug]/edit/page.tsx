import { redirect, notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { asc, eq } from "drizzle-orm";

import { authOptions } from "@/lib/auth-options";
import PostEditor from "@/app/auth/posts/PostEditor";
import { db } from "@/server/db";
import { categories, posts, tags } from "@/server/db/schema";

import styles from "../../new/PosPage.module.css";

export const dynamic = "force-dynamic";

export default async function EditPostPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/auth/login");

  const post = await db.query.posts.findFirst({
    where: eq(posts.slug, slug),
    with: { postTags: true },
  });

  if (!post) notFound();
  if (post.authorId !== session.user.id) redirect(`/posts/${slug}`);

  const [gameList, themeList] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.title)),
    db.select().from(tags).orderBy(asc(tags.name)),
  ]);

  const tagIds = post.postTags?.map((pt) => pt.tagId) ?? [];

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <div>
            <div className={styles.kicker}>GameHelp</div>
            <h1 className={styles.title}>Редактировать пост</h1>
            <p className={styles.subtitle}>Измени текст, обложку или теги и сохрани.</p>
          </div>
        </div>

        <div className={styles.shell}>
          <PostEditor
            userId={session.user.id}
            categories={gameList}
            tags={themeList}
            editSlug={slug}
            initialTitle={post.title}
            initialContent={post.content}
            initialCategoryId={post.categoryId ?? ""}
            initialTagIds={tagIds}
            initialCoverUrl={post.coverImage ?? null}
          />
        </div>
      </div>
    </div>
  );
}
