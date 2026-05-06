import { isNull } from "drizzle-orm";

import { db } from "@/server/db";
import { posts } from "@/server/db/schema";

async function main() {
  const updated = await db
    .update(posts)
    .set({ views: 0 })
    .where(isNull(posts.views))
    .returning({ id: posts.id });

  console.log(
    JSON.stringify(
      {
        updatedRows: updated.length,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

