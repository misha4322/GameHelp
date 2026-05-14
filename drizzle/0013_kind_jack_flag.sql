CREATE TABLE "user_post_rec_signals" (
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"last_impression_at" timestamp with time zone,
	"last_click_at" timestamp with time zone,
	"last_open_at" timestamp with time zone,
	"impression_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"open_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_post_rec_signals_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "user_post_rec_signals" ADD CONSTRAINT "user_post_rec_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_post_rec_signals" ADD CONSTRAINT "user_post_rec_signals_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_post_rec_signals_user_id_idx" ON "user_post_rec_signals" USING btree ("user_id");