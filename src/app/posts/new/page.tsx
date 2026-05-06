import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { asc } from "drizzle-orm";

import { authOptions } from "@/lib/auth-options";
import { db } from "@/server/db";
import { categories, tags } from "@/server/db/schema";
import PostEditor from "@/app/auth/posts/PostEditor";

import styles from "./PosPage.module.css";

export const dynamic = "force-dynamic";

export default async function NewPostPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/auth/login");
  }

  const games = await db.select().from(categories).orderBy(asc(categories.title));
  const themes = await db.select().from(tags).orderBy(asc(tags.name));

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <div>
            <div className={styles.kicker}>GameHelp</div>
            <h1 className={styles.title}>Создать пост</h1>
            <p className={styles.subtitle}>
              Напиши обзор, вопрос, обсуждение или полезный гайд для сообщества.
            </p>
          </div>
        </div>

        <div className={styles.shell}>
          <PostEditor
            userId={session.user.id}
            categories={games}
            tags={themes}
          />
        </div>
      </div>
    </div>
  );
}