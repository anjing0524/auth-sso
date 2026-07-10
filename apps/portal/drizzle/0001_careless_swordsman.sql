ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_mobile_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_history" text[];--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_parent_id_permissions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_users_email" ON "users" USING btree ("email") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_users_mobile" ON "users" USING btree ("mobile") WHERE "users"."deleted_at" IS NULL;