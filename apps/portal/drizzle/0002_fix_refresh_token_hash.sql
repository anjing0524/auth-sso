-- Migration: 0002_fix_refresh_token_hash.sql
--
-- 背景：refresh_tokens.token_hash 字段名暗示 SHA256 存储，
-- 但代码历史上误存了明文 token。代码已修复（issueRefreshToken 改为 hashToken(token)），
-- 但存量数据是明文，必须清空，防止新旧格式混存导致 RT 永久失效。
--
-- 影响评估：RT TTL = 7 天，清空后所有用户需重新登录获取新 RT。
-- 建议在低峰期执行，或告知用户重新登录。

TRUNCATE TABLE "refresh_tokens";
