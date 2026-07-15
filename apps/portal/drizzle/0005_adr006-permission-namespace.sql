ALTER TABLE "permissions" DROP CONSTRAINT "permissions_type_fields_chk";--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_client_id_clients_client_id_fk";
--> statement-breakpoint
ALTER TABLE "permissions" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "permissions" ALTER COLUMN "type" SET DEFAULT 'API'::text;--> statement-breakpoint
DROP TYPE "public"."permission_type";--> statement-breakpoint
CREATE TYPE "public"."permission_type" AS ENUM('DIRECTORY', 'PAGE', 'API');--> statement-breakpoint
ALTER TABLE "permissions" ALTER COLUMN "type" SET DEFAULT 'API'::"public"."permission_type";--> statement-breakpoint
ALTER TABLE "permissions" ALTER COLUMN "type" SET DATA TYPE "public"."permission_type" USING "type"::"public"."permission_type";--> statement-breakpoint
DROP INDEX "idx_refresh_tokens_client";--> statement-breakpoint
ALTER TABLE "permissions" ALTER COLUMN "code" SET DATA TYPE varchar(150);--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP COLUMN "client_id";--> statement-breakpoint
ALTER TABLE "permissions" DROP COLUMN "resource";--> statement-breakpoint
ALTER TABLE "permissions" DROP COLUMN "action";--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_type_fields_chk" CHECK ((type IN ('DIRECTORY','PAGE') AND client_id IS NULL)
      OR (type = 'API'));