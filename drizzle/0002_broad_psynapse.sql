ALTER TABLE "users" ADD COLUMN "nickname" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "nickname_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_nickname_key_uq" ON "users" USING btree ("nickname_key") WHERE "users"."nickname_key" IS NOT NULL;