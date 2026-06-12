# Project Cleanup and Spec Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up workspace leftovers, update system specifications, rewrite/fix unit tests, and align integration tests to support the stateless JWT Cookie architecture.

**Architecture:** The project BFF (Portal) migrated to stateless JWT Cookie verification. We delete legacy Redis session tests and empty nested folders, update design documentation, fix the callback unit test, rebuild the session test suite around JWT validation, and adjust HttpClient integration tests to extract and pass the JWT cookie (`portal_jwt_token`).

**Tech Stack:** TypeScript, Next.js, Vitest, Node.js HTTP/Fetch.

---

### Task 1: Workspace Cleanup

**Files:**
- Delete: `apps/portal/apps` (empty directory)
- Delete: `apps/idp/idp-dev.log`
- Delete: `apps/idp/local.log`

- [ ] **Step 1: Delete the redundant nested apps folder**

Run: `rm -rf apps/portal/apps`
Expected: Folder is deleted from workspace.

- [ ] **Step 2: Delete local transient logs**

Run: `rm -f apps/idp/idp-dev.log apps/idp/local.log`
Expected: Files are removed from workspace.

- [ ] **Step 3: Verify clean working directory**

Run: `git status`
Expected: Workspace is clean, only untracked local env files are ignored.

- [ ] **Step 4: Commit cleanup**

Run:
```bash
git add -A
git commit -m "chore: clean up nested redundant directory and transient logs"
```

---

### Task 2: Update Specifications & CLAUDE.md

**Files:**
- Modify: `CLAUDE.md:65-72`
- Modify: `docs/spec/ARCHITECTURE.md`
- Modify: `docs/spec/API.md`
- Modify: `docs/spec/PRD.md`
- Modify: `docs/spec/TDD-MASTER-PLAN.md`

- [ ] **Step 1: Modify CLAUDE.md**

Update the Session Architecture table in `CLAUDE.md` to reference `portal_jwt_token` instead of `portal_session_id`.

```diff
- | **标识** | `idp_session` cookie | `portal_session_id` cookie |
+ | **标识** | `idp_session` cookie | `portal_jwt_token` cookie |
```

- [ ] **Step 2: Update docs/spec/ARCHITECTURE.md**

Change Session storage in Tech Stack and overview charts.

```diff
- - **Session Cache**: Redis (for both Portal and IdP sessions).
+ - **Session Cache**: Redis (for IdP sessions and Portal JTI blocklist).
```

Update high-level flowchart:
```diff
  Browser
    -> Portal (BFF)
-        -> Redis (Portal Sessions)
+        -> Redis (Portal JTI Blocklist)
```

Update Step 6 and 7 in Portal Login flow:
```diff
- 6. Portal establishes a **Portal Session** in Redis.
- 7. Portal returns a `portal_session` cookie to the browser.
+ 6. Portal BFF receives tokens and skips Redis session creation.
+ 7. Portal BFF sets HttpOnly Cookies `portal_jwt_token` and `portal_refresh_token` to the browser.
```

- [ ] **Step 3: Update docs/spec/API.md**

Update authorization prerequisite:
```diff
- Requires `portal_session` and relevant permission codes.
+ Requires `portal_jwt_token` HttpOnly Cookie and relevant permission codes.
```

Add the `POST /api/auth/refresh` API definition:
```markdown
### 2.4 `POST /api/auth/refresh`
Silently refreshes the user's portal_jwt_token HttpOnly Cookie using portal_refresh_token.

**Request**:
- Header: Cookie containing `portal_refresh_token` (Path=/api/auth/refresh).

**Success Data (200 OK)**:
```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "expiresAt": 1718080000
  }
}
```
Set-Cookie header will contain a new `portal_jwt_token`.
```

- [ ] **Step 4: Update docs/spec/PRD.md**

Update concurrent session performance target and logout description:
```diff
- - **Logout**: Concurrent invalidation of Portal and IdP sessions.
+ - **Logout**: Concurrent invalidation of Portal JWT cookies, JTI revocation, and IdP session.
```

```diff
- - **Scalability**: Support hundreds of concurrent sessions in Redis.
+ - **Scalability**: Support stateless JWT validation with local JWKS, leveraging Redis only for emergency JTI revocation.
```

- [ ] **Step 5: Update docs/spec/TDD-MASTER-PLAN.md**

```diff
- *   **API TDD (`TDD-AUTH-002`)**: 携带 IdP Session 请求 Portal `/api/auth/login`。断言最终成功获取 `portal_session_id`。
+ *   **API TDD (`TDD-AUTH-002`)**: 携带 IdP Session 请求 Portal `/api/auth/login`。断言最终成功在 Cookie 中写入 `portal_jwt_token`。
```

```diff
-     *   **断言**: 无法读取到 `idp_session` 或 `portal_session_id`，证明 HttpOnly 生效，免受 XSS 攻击窃取。
+     *   **断言**: 无法读取到 `idp_session` 或 `portal_jwt_token`，证明 HttpOnly 生效，免受 XSS 攻击窃取。
```

- [ ] **Step 6: Commit spec updates**

Run:
```bash
git add CLAUDE.md docs/spec/
git commit -m "docs: update spec files and CLAUDE.md to match stateless JWT Cookie architecture"
```

---

### Task 3: Rewrite Unit Test - auth-callback.test.ts

**Files:**
- Modify: `apps/portal/__tests__/api/auth-callback.test.ts`

- [ ] **Step 1: Replace createSession mock with setJwtCookies mock**

Modify the mock block for `@/lib/session` at line 29-40:
```typescript
vi.mock('@/lib/session', () => ({
  setJwtCookies: vi.fn(),
  clearJwtCookies: vi.fn(),
}));
```

- [ ] **Step 2: Update the assertion in "Token 交换成功后创建 Session 并重定向"**

Modify the assertion starting at line 150:
```typescript
    // 验证 JWT Cookies 被正确写入
    const { setJwtCookies } = await import('@/lib/session');
    expect(setJwtCookies).toHaveBeenCalledWith(
      expect.any(Object),
      'access-123',
      'refresh-456',
      3600
    );
```

- [ ] **Step 3: Run the modified test specifically to verify it passes**

Run: `npx --userconfig=/dev/null vitest run --project @auth-sso/portal auth-callback.test.ts`
Expected: PASS

- [ ] **Step 4: Commit changes**

Run:
```bash
git add apps/portal/__tests__/api/auth-callback.test.ts
git commit -m "test: align auth-callback test with JWT Cookie model"
```

---

### Task 4: Rewrite Unit Test - session-lifecycle.test.ts

**Files:**
- Modify: `apps/portal/__tests__/api/session-lifecycle.test.ts`

- [ ] **Step 1: Replace file contents with stateless JWT life-cycle test suite**

Replace the contents of `apps/portal/__tests__/api/session-lifecycle.test.ts` with the following test suite:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { createMockRedis } from '../helpers/mock-redis';

// Mock Redis
const { getRedis, store } = createMockRedis();
vi.mock('@/lib/redis', () => ({
  getRedis: () => getRedis(),
}));

// Mock next/headers
const mockCookiesGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: mockCookiesGet,
  }),
}));

// Mock jose
vi.mock('jose', () => ({
  jwtVerify: vi.fn(async (token) => {
    if (token === 'valid-jwt') {
      return { payload: { sub: 'usr_1', jti: 'jti-123', exp: Math.floor(Date.now() / 1000) + 3600 } };
    }
    throw new Error('Invalid signature');
  }),
  decodeJwt: vi.fn((token) => {
    if (token === 'valid-jwt') {
      return { sub: 'usr_1', jti: 'jti-123', exp: Math.floor(Date.now() / 1000) + 3600 };
    }
    return null;
  }),
  createRemoteJWKSet: vi.fn(() => vi.fn()),
}));

import {
  setJwtCookies,
  clearJwtCookies,
  getJwtFromCookie,
  getRefreshTokenFromCookie,
  verifyJwt,
  decodeJwtPayload,
  revokeJti,
  isJtiRevoked,
  revokeUserToken,
  JWT_COOKIE_NAME,
  REFRESH_COOKIE_NAME
} from '@/lib/session';

describe('JWT Cookie Session Lifecycle', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  describe('setJwtCookies', () => {
    it('正确将 JWT 写入 Response Cookie', () => {
      const response = NextResponse.next();
      const setSpy = vi.spyOn(response.cookies, 'set');
      
      setJwtCookies(response, 'access-token', 'refresh-token', 3600);
      
      expect(setSpy).toHaveBeenCalledWith(JWT_COOKIE_NAME, 'access-token', expect.objectContaining({
        path: '/',
        httpOnly: true,
        maxAge: 3600,
      }));
      expect(setSpy).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, 'refresh-token', expect.objectContaining({
        path: '/api/auth/refresh',
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60,
      }));
    });
  });

  describe('clearJwtCookies', () => {
    it('正确在响应头中追加 Max-Age=0 清理 Cookie', () => {
      const response = new Response();
      clearJwtCookies(response);
      const setCookies = response.headers.getSetCookie();
      expect(setCookies.some(c => c.includes(`${JWT_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
      expect(setCookies.some(c => c.includes(`${REFRESH_COOKIE_NAME}=;`) && c.includes('Max-Age=0'))).toBe(true);
    });
  });

  describe('getJwtFromCookie & getRefreshTokenFromCookie', () => {
    it('从 cookies 接口成功读取 Token', async () => {
      mockCookiesGet.mockImplementation((name) => {
        if (name === JWT_COOKIE_NAME) return { value: 'jwt-val' };
        if (name === REFRESH_COOKIE_NAME) return { value: 'refresh-val' };
        return null;
      });

      const jwt = await getJwtFromCookie();
      const refresh = await getRefreshTokenFromCookie();

      expect(jwt).toBe('jwt-val');
      expect(refresh).toBe('refresh-val');
    });
  });

  describe('jti 黑名单机制', () => {
    it('能够正确加入和判断 jti 黑名单', async () => {
      await revokeJti('jti-123', Math.floor(Date.now() / 1000) + 3600);
      expect(await isJtiRevoked('jti-123')).toBe(true);
      expect(await isJtiRevoked('jti-not-exists')).toBe(false);
    });

    it('能够自动通过 token 进行注销', async () => {
      await revokeUserToken('valid-jwt');
      expect(await isJtiRevoked('jti-123')).toBe(true);
    });
  });

  describe('verifyJwt', () => {
    it('对有效 JWT 成功验签并返回载荷', async () => {
      const payload = await verifyJwt('valid-jwt');
      expect(payload).toBeTruthy();
      expect(payload!.sub).toBe('usr_1');
    });

    it('如果 jti 在黑名单中则返回 null', async () => {
      await revokeJti('jti-123', Math.floor(Date.now() / 1000) + 3600);
      const payload = await verifyJwt('valid-jwt');
      expect(payload).toBeNull();
    });

    it('无效 JWT 返回 null', async () => {
      const payload = await verifyJwt('invalid-jwt');
      expect(payload).toBeNull();
    });
  });

  describe('decodeJwtPayload', () => {
    it('快速解码有效 JWT 载荷', () => {
      const payload = decodeJwtPayload('valid-jwt');
      expect(payload).toBeTruthy();
      expect(payload!.sub).toBe('usr_1');
    });
  });
});
```

- [ ] **Step 2: Run all unit tests inside apps/portal to verify correctness**

Run: `npx --userconfig=/dev/null vitest run --project @auth-sso/portal`
Expected: 100% PASS (both `auth-callback.test.ts` and `session-lifecycle.test.ts` pass)

- [ ] **Step 3: Commit rewritten session-lifecycle test**

Run:
```bash
git add apps/portal/__tests__/api/session-lifecycle.test.ts
git commit -m "test: rewrite session-lifecycle test to cover JWT Cookie operations"
```

---

### Task 5: Align Integration Tests with portal_jwt_token

**Files:**
- Modify: `tests/business.test.js`
- Modify: `tests/data-scope.test.js`
- Modify: `tests/department.test.js`
- Modify: `tests/e2e-complete-flow.test.js`
- Modify: `tests/session.test.js`
- Modify: `tests/sso.test.js`
- Modify: `tests/tdd-prd-all.test.js`

- [ ] **Step 1: Replace portal_session_id assertions inside tests/business.test.js**

Modify line 22:
```javascript
// Before
assert.exists(sessionCookies.get('portal_session_id') || sessionCookies.get('better-auth.session_token'), '登录应成功');
// After
assert.exists(sessionCookies.get('portal_jwt_token') || sessionCookies.get('better-auth.session_token'), '登录应成功');
```

- [ ] **Step 2: Replace portal_session_id assertions inside tests/data-scope.test.js**

Modify line 21:
```javascript
// Before
assert.exists(adminSession.get('portal_session_id'), '登录后应获取 session id');
// After
assert.exists(adminSession.get('portal_jwt_token'), '登录后应获取 token');
```

- [ ] **Step 3: Replace portal_session_id assertions inside tests/department.test.js**

Modify line 18:
```javascript
// Before
assert.exists(sessionCookies.get('portal_session_id'), '登录应成功');
// After
assert.exists(sessionCookies.get('portal_jwt_token'), '登录应成功');
```

- [ ] **Step 4: Replace portal_session_id assertions inside tests/sso.test.js**

Modify line 26:
```javascript
// Before
assert.exists(portalCookies.get('portal_session_id') || portalCookies.get('better-auth.session_token'), 'Portal 应登录成功');
// After
assert.exists(portalCookies.get('portal_jwt_token') || portalCookies.get('better-auth.session_token'), 'Portal 应登录成功');
```

- [ ] **Step 5: Replace portal_session_id assertions inside tests/tdd-prd-all.test.js**

Modify line 28:
```javascript
// Before
assert.exists(portalCookies?.get('portal_session_id') || portalCookies?.get('better-auth.session_token'), 'Portal 登录应成功');
// After
assert.exists(portalCookies?.get('portal_jwt_token') || portalCookies?.get('better-auth.session_token'), 'Portal 登录应成功');
```

- [ ] **Step 6: Update integration tests/session.test.js invalid cookie simulation**

Modify line 49:
```javascript
// Before
Cookie: 'portal_session_id=expired-id-12345'
// After
Cookie: 'portal_jwt_token=expired-jwt-token-value'
```

- [ ] **Step 7: Update integration tests/e2e-complete-flow.test.js assertions & invalid cookies**

Modify line 26:
```javascript
// Before
const hasPortalSession = Object.keys(adminSession.cookies).some(name => name.includes('portal_session'));
// After
const hasPortalSession = Object.keys(adminSession.cookies).some(name => name.includes('portal_jwt_token'));
```

Modify line 57:
```javascript
// Before
Cookie: 'portal_session_id=invalid-id'
// After
Cookie: 'portal_jwt_token=invalid-jwt-token-value'
```

- [ ] **Step 8: Commit integration test suite updates**

Run:
```bash
git add tests/
git commit -m "test: replace legacy portal_session_id with portal_jwt_token in integration tests"
```
