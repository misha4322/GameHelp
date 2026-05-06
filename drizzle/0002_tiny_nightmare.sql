ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_provider_providerid_unique" ON "users" USING btree ("provider","provider_id");