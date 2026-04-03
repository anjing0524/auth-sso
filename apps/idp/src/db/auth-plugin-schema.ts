import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { users } from "./schema";

// 完美适配 Better-Auth OIDC 插件与现有数据库的中间 Schema

export const jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at"),
});

export const oauthApplication = pgTable("clients", {
    id: text("id").primaryKey(),
    name: text("name"),
    icon: text("logo_url"), // 映射 icon 到 logo_url
    metadata: text("metadata"), // 虽然 DB 中没有，但 Drizzle 会尝试查询。如果在查询时报错，我们需要在数据库中增加此列
    clientId: text("client_id").unique(),
    clientSecret: text("client_secret"),
    redirectUrls: text("redirect_uris"), // 映射 redirectUrls 到 redirect_uris
    type: text("type"),
    disabled: boolean("disabled").default(false),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
});

export const oauthAccessToken = pgTable("oauth_access_tokens", {
    id: text("id").primaryKey(),
    accessToken: text("access_token").unique(),
    refreshToken: text("refresh_token").unique(),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    clientId: text("client_id").references(() => oauthApplication.clientId, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    scopes: text("scopes"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
});

export const oauthConsent = pgTable("oauth_consent", {
    id: text("id").primaryKey(),
    clientId: text("client_id").references(() => oauthApplication.clientId, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    scopes: text("scopes"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    consentGiven: boolean("consent_given"),
});
