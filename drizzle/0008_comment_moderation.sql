ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "banned_until" timestamp with time zone;

ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "deleted_by_id" uuid;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "edited_at" timestamp with time zone;
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "edited_by_staff_id" uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comments_deleted_by_id_users_id_fk'
  ) THEN
    NULL;
  ELSE
    ALTER TABLE "comments"
      ADD CONSTRAINT "comments_deleted_by_id_users_id_fk"
      FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comments_edited_by_staff_id_users_id_fk'
  ) THEN
    NULL;
  ELSE
    ALTER TABLE "comments"
      ADD CONSTRAINT "comments_edited_by_staff_id_users_id_fk"
      FOREIGN KEY ("edited_by_staff_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_parent_id_comments_id_fk";
ALTER TABLE "comments"
  ADD CONSTRAINT "comments_parent_id_comments_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE TABLE IF NOT EXISTS "user_warnings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
  "comment_id" uuid REFERENCES "public"."comments"("id") ON DELETE SET NULL,
  "comment_snapshot" text,
  "reason" text NOT NULL,
  "created_by_staff_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "dismissed_at" timestamp with time zone
);
