ALTER TABLE "comment_likes" ALTER COLUMN "created_at" SET DATA TYPE timestamp;--> statement-breakpoint
ALTER TABLE "comment_likes" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "comment_likes" ADD COLUMN "type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "post_likes" ADD COLUMN "type" text DEFAULT 'like' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "post_likes_post_user_unique" ON "post_likes" USING btree ("post_id","user_id");