DROP INDEX "idx_users_status";--> statement-breakpoint
CREATE UNIQUE INDEX "ux_user_roles_user_role" ON "user_roles" USING btree ("user_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_role_clients_role_client" ON "role_clients" USING btree ("role_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_role_data_scopes_role_dept" ON "role_data_scopes" USING btree ("role_id","dept_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_role_permissions_role_perm" ON "role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE INDEX "idx_users_status" ON "users" USING btree ("status") WHERE "users"."status" <> 'DELETED';