import { describe, expect, it } from 'vitest';
import fixture from '../cross-language-fixture.json';
import { COOKIE_NAMES, GATEWAY_HEADERS } from '../index';
import {
  DEFAULT_SCOPES,
  DISCOVERY_CUSTOM_FIELDS,
  JWT_TYP,
  REDIS_KEY_PREFIX,
  SCOPES_SUPPORTED,
} from '../oidc';

/**
 * Portal（TypeScript）↔ Gateway（Rust）跨语言**字面量**契约
 *
 * 唯一真相源：`cross-language-fixture.json`。Rust 侧
 * （`apps/gateway/src/contract_tests.rs`）以 `include_str!` 消费同一文件并断言
 * **本端常量 == 工件值**；本文件守卫 TS 侧。任何一侧单独改名都会让本端或对端变红。
 *
 * ## 为什么需要它（此前为什么是坏的）
 *
 * 这些值在两端都是**手写字面量**，靠注释同步（Rust 侧写着"与 @auth-sso/contracts
 * `XXX` 同步"）。而两端的测试各自只断言**自己那一份**，于是：
 *
 * - 改 Portal 的 cookie 名 → Portal 测试照绿，Gateway 静默读不到 cookie；
 * - 改 Gateway 的 jti 前缀 → 撤销**静默失效**（Gateway 写 A、Portal 读 B）；
 * - 改 Discovery 自定义字段名 → Gateway 靠**旧名回退**继续工作，看不出坏了；
 * - 收窄 Portal client 的 scopes → Gateway 的 `/authorize` 跳转拿到 `invalid_scope`。
 *
 * ## 纳入与不纳入（不纳入的必须写明理由）
 *
 * 纳入 = 该值**确实跨语言**（一侧写、另一侧读）。不纳入的见文件末尾的
 * "明确不纳入"用例——把理由写下来，下一位读者才不会把它当成漏修。
 *
 * @req A5-3, H-CFG-001
 */
describe('跨语言字面量契约 — TS 侧', () => {
  describe('Cookie 名（Gateway 读写 ↔ Portal 读写）', () => {
    it('Access / Refresh Token 名一致', () => {
      expect(COOKIE_NAMES.JWT).toBe(fixture.cookies.jwt);
      expect(COOKIE_NAMES.REFRESH).toBe(fixture.cookies.refresh);
    });

    it('Gateway 下发的四个 OAuth 临时 Cookie 名一致', () => {
      expect(COOKIE_NAMES.PKCE_VERIFIER).toBe(fixture.cookies.pkce_verifier);
      expect(COOKIE_NAMES.OAUTH_STATE).toBe(fixture.cookies.oauth_state);
      expect(COOKIE_NAMES.OAUTH_NONCE).toBe(fixture.cookies.oauth_nonce);
      expect(COOKIE_NAMES.RETURN_TO).toBe(fixture.cookies.return_to);
    });

    it('工件恰好覆盖这 6 个跨语言 Cookie 名（新增须同步改本测试）', () => {
      expect(Object.keys(fixture.cookies).sort()).toEqual([
        'jwt',
        'oauth_nonce',
        'oauth_state',
        'pkce_verifier',
        'refresh',
        'return_to',
      ]);
    });
  });

  describe('Gateway 注入的请求头（Gateway 注入 ↔ Portal 读取）', () => {
    it('用户 ID / jti 头名一致（HTTP 头名大小写不敏感，两端写法可不同）', () => {
      // contracts 用小写；Rust 侧写 "X-User-Id"。两者都合法——故 Rust 侧断言
      // 时用大小写不敏感比较，此处只钉 contracts 这一份的规范形态。
      expect(GATEWAY_HEADERS.USER_ID).toBe(fixture.gatewayHeaders.user_id);
      expect(GATEWAY_HEADERS.USER_JTI).toBe(fixture.gatewayHeaders.user_jti);
      expect(GATEWAY_HEADERS.USER_ID).toBe(GATEWAY_HEADERS.USER_ID.toLowerCase());
    });
  });

  describe('JWT typ（Portal 签发 ↔ Gateway 校验）', () => {
    it('Access Token 的 typ 一致', () => {
      expect(JWT_TYP.ACCESS_TOKEN).toBe(fixture.jwtTyp.access_token);
    });
  });

  describe('Redis 键前缀（Portal 写 ↔ Gateway 读）', () => {
    it('jti 黑名单前缀一致（漂移会让撤销静默失效）', () => {
      expect(REDIS_KEY_PREFIX.JTI_BLOCKLIST).toBe(fixture.redisKeyPrefixes.jti_blocklist);
    });
  });

  describe('scope 集合（Gateway 在 /authorize 请求 ↔ Portal 校验）', () => {
    it('受支持 scope 一致，且默认集合由其派生', () => {
      expect([...SCOPES_SUPPORTED]).toEqual(fixture.scopesSupported);
      expect(DEFAULT_SCOPES).toBe(fixture.scopesSupported.join(' '));
    });
  });

  describe('Discovery 自定义字段名（Portal 发布 ↔ Gateway 探测）', () => {
    it('字段名一致', () => {
      expect(DISCOVERY_CUSTOM_FIELDS.REFRESH_ENDPOINT).toBe(
        fixture.discoveryFields.refresh_endpoint,
      );
      expect(DISCOVERY_CUSTOM_FIELDS.CALLBACK_PATH).toBe(fixture.discoveryFields.callback_path);
    });
  });

  describe('明确不纳入（写理由，避免被当成漏修）', () => {
    it('只在本端使用的值不进工件', () => {
      // Gateway 源码里 grep 不到这些标识，故它们**不跨语言**：
      // - COOKIE_NAMES.LOGIN_SESSION：仅 Portal 的 authorize / callback 读写
      // - COOKIE_NAMES 之外的 Portal 私有键、AUDIT_* 等：无 Rust 消费方
      expect(fixture.cookies).not.toHaveProperty('login_session');
    });

    it('JWT_TYP 的另两种 typ 不进工件', () => {
      // LOGIN_SESSION / ID_TOKEN 由 Portal 自己签发与校验；Gateway 只验 AT。
      expect(Object.keys(fixture.jwtTyp)).toEqual(['access_token']);
    });

    it('Portal 私有 Redis 前缀不进工件', () => {
      // USER_JTI / USER_PERMS / AUTH_REQUEST / LOGIN_FAIL 均无 Gateway 消费方
      // （Gateway 只读 jti 黑名单）。
      expect(Object.keys(fixture.redisKeyPrefixes)).toEqual(['jti_blocklist']);
    });

    it('USER_NAME 头不进工件（无人读取，见下）', () => {
      // GATEWAY_HEADERS.USER_NAME 既不被 Gateway 注入，也不被 Portal 读取
      // （Portal 只读 USER_ID / USER_JTI）。保留定义属历史，但**不是**跨语言契约
      // ——把它写进工件会谎称"有一侧在读它"。
      expect(fixture.gatewayHeaders).not.toHaveProperty('user_name');
    });
  });
});
