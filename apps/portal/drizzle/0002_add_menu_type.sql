CREATE TYPE "public"."menu_type" AS ENUM('DIRECTORY', 'MENU', 'BUTTON');--> statement-breakpoint
ALTER TYPE "public"."user_status" ADD VALUE 'DELETED';--> statement-breakpoint
ALTER TABLE "menus" ADD COLUMN "menu_type" "menu_type" DEFAULT 'MENU' NOT NULL;