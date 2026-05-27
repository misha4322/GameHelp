import { and, eq } from "drizzle-orm";

import { db } from "@/server/db";
import { userPostRecSignals } from "@/server/db/schema";

export type UserPostRecSignalRow = typeof userPostRecSignals.$inferSelect;

/** Штраф к скору за недавно «потреблённый» контент (чтобы после выхода из поста лента менялась). */
export function recentConsumptionPenalty(sig: {
  lastOpenAt: Date | null;
  lastClickAt: Date | null;
}): number {
  const now = Date.now();
  let p = 0;
  if (sig.lastOpenAt) {
    const age = now - sig.lastOpenAt.getTime();
    const windowMs = 12 * 60 * 60 * 1000;
    if (age >= 0 && age < windowMs) {
      p += 26 * (1 - age / windowMs);
    }
  }
  if (sig.lastClickAt) {
    const age = now - sig.lastClickAt.getTime();
    const windowMs = 4 * 60 * 60 * 1000;
    if (age >= 0 && age < windowMs) {
      p += 12 * (1 - age / windowMs);
    }
  }
  return Math.min(34, p);
}

export async function recordUserPostRecSignal(
  userId: string,
  postId: string,
  kind: "impression" | "click"
) {
  const now = new Date();
  const row = await db.query.userPostRecSignals.findFirst({
    where: and(eq(userPostRecSignals.userId, userId), eq(userPostRecSignals.postId, postId)),
  });

  if (!row) {
    await db.insert(userPostRecSignals).values({
      userId,
      postId,
      lastImpressionAt: kind === "impression" ? now : null,
      lastClickAt: kind === "click" ? now : null,
      impressionCount: kind === "impression" ? 1 : 0,
      clickCount: kind === "click" ? 1 : 0,
      openCount: 0,
      updatedAt: now,
    });
    return;
  }

  await db
    .update(userPostRecSignals)
    .set({
      lastImpressionAt: kind === "impression" ? now : row.lastImpressionAt,
      lastClickAt: kind === "click" ? now : row.lastClickAt,
      impressionCount: kind === "impression" ? row.impressionCount + 1 : row.impressionCount,
      clickCount: kind === "click" ? row.clickCount + 1 : row.clickCount,
      updatedAt: now,
    })
    .where(and(eq(userPostRecSignals.userId, userId), eq(userPostRecSignals.postId, postId)));
}

export async function recordUserPostOpenSignal(userId: string, postId: string) {
  const now = new Date();
  const row = await db.query.userPostRecSignals.findFirst({
    where: and(eq(userPostRecSignals.userId, userId), eq(userPostRecSignals.postId, postId)),
  });

  if (!row) {
    await db.insert(userPostRecSignals).values({
      userId,
      postId,
      lastOpenAt: now,
      openCount: 1,
      impressionCount: 0,
      clickCount: 0,
      updatedAt: now,
    });
    return;
  }

  await db
    .update(userPostRecSignals)
    .set({
      lastOpenAt: now,
      openCount: row.openCount + 1,
      updatedAt: now,
    })
    .where(and(eq(userPostRecSignals.userId, userId), eq(userPostRecSignals.postId, postId)));
}

export async function loadRecSignalsForViewer(userId: string): Promise<UserPostRecSignalRow[]> {
  return db.query.userPostRecSignals.findMany({
    where: eq(userPostRecSignals.userId, userId),
  });
}
