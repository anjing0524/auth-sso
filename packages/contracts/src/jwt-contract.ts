/**
 * Portal JWT Claims 跨语言契约（A5-3）
 *
 * Portal（TypeScript，`lib/auth/token.ts` 签发）与 Gateway（Rust，
 * `auth::Claims` 验签）共享同一套 claims 字段契约。唯一真相源是同目录的
 * `jwt-claims-fixture.json`：
 *
 * - TS 侧（`jwt-contract.test.ts`）校验签发端字段集合与语义（TTL、URL issuer、jti 前缀）。
 * - Rust 侧（`apps/gateway/src/auth/tests.rs`）以 `include_str!` + serde 反序列化
 *   同一 fixture，校验验签端 `Claims` 结构可消费。
 *
 * 任何一侧增删/改名 claims 字段，必须同步本 fixture 与两端测试 —— 这是由
 * 跨语言漂移引发的硬约束（历史上 Portal 端曾单方面增删 claims 而无门禁）。
 *
 * 注意：Gateway 的 `Claims` 只消费子集（sub/iss/aud/jti/exp；iat 仅 Portal 侧
 * 语义使用），serde 默认忽略未知字段，fixture 携带 iat 以锚定 AT TTL 契约。
 *
 * @module @auth-sso/contracts/jwt-contract
 */

/** 双端约定的 claims 字段集合（排序后与 fixture 的 Object.keys 严格相等） */
export const PORTAL_JWT_CLAIM_KEYS = [
  'sub',
  'iss',
  'aud',
  'jti',
  'iat',
  'exp',
] as const;

export type PortalJwtClaimKey = (typeof PORTAL_JWT_CLAIM_KEYS)[number];
