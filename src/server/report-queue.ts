import { and, eq } from "drizzle-orm";

import { db } from "@/server/db";
import { contentReports } from "@/server/db/schema";

export async function removeReportsForComment(commentId: string) {
  await db
    .delete(contentReports)
    .where(and(eq(contentReports.targetType, "comment"), eq(contentReports.targetId, commentId)));
}
