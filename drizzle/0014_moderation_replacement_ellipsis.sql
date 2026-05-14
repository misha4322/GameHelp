ALTER TABLE "moderation_words" ALTER COLUMN "replacement" SET DEFAULT '...';
--> statement-breakpoint
UPDATE "moderation_words" SET "replacement" = '...' WHERE "replacement" = '***';