# Portal 活体自检：6 条判据（2026-10-16）

> 关联：ADR-012（issuer 同源）、三层安全模型、`docs/solution/2026-10-16-declaration-blocking-point-survey.md`
> 索引：挂于 `docs/solution/README.md` 的「测试真实性与守卫」主题下。

## 为什么需要它

本仓的验证此前几乎全是**静态面**（守卫 / 契约 / ADR 取证）—— 它们能证明「规则写着、守卫拦着」，
但证明不了「系统跑起来也对」。e2e 本意是补这一块，却被本沙箱的 Docker 构建挡死（需 npm registry，
见 `AGENTS.md` 的 e2e 一条）。本文记录**另一条可行路径**：直接起 Portal 并打真实请求。

## 如何起（本沙箱实测可行）

1. 写 `apps/portal/.env.local`（被 gitignore）：7 个变量，**`DATABASE_URL` 用 `auth_sso`**
   —— `.env.example` 里的 `auth_sso_portal` **不存在**。
2. `--webpack` 是必须的：本沙箱缺 SWC 原生绑定（`GLIBC_2.29` 缺失 / musl 包 ELF 头异常）⇒
   Turbopack 不可用。
3. 起法（**不带** Temporal 旗标 —— 见下）：`node <require.resolve('next/dist/bin/next')> dev --webpack -p 4100`。

## 6 条判据（全部只读，2026-10-16 实测全 PASS）

| # | 请求 | 期望 | 实测 | 它验证了什么 |
|---|---|---|---|---|
| 1 | `/.well-known/openid-configuration` | 200 且 `issuer` 与 base URL **同源** | 200，`issuer=http://localhost:4100` | **ADR-012 的同源要求**（此前只读过 `resolvePublicUrls` 的代码） |
| 2 | `/api/auth/jwks` | 200、`keys[0].alg=ES256`、`kid` 存在 | 200，`alg=ES256 kty=EC use=sig kid ✓` | "Portal 用 ES256 签发、密钥存 `jwks` 表"这条链路在位 |
| 3 | Discovery 的 `grant_types_supported` / `code_challenge_methods_supported` / `id_token_signing_alg_values_supported` | 与 `packages/contracts/src/oidc.ts` 的常量**逐项相等** | 三条全等 | 把契约普查的结论（"route 直接引用常量 ⇒ 结构上不可能脱节"）从**读代码可信**升级为**运行时事实** |
| 4 | `POST /api/auth/oauth2/token`（缺 `grant_type`） | 400 | **400** | RFC 6749 §5.2 的 `invalid_request` ✓ |
| 5 | `/api/auth/oauth2/authorize`（缺 `client_id` / 未知 `client_id` / `redirect_uri` 不匹配） | **不得**重定向到非法的 `redirect_uri` | **307 → `http://localhost:4100/oauth/error?error=invalid_request…`** | **开放重定向不存在** ✓（三种非法输入都回到**自家**错误页） |
| 6 | `/api/users`（不带认证） | 401 | **401** | 三层安全的 `withAuth` 层真的在拒，且码正是设计值 |

## 判读这条线时的两条方法（都来自实际踩坑）

1. **拿值，不只看码**：判据 5 若只看「307 不是 4xx」会误判成缺陷；若只看「3xx 也算拒绝」又会漏掉
   真正的开放重定向。**必须打印 `Location` 再判语义** —— 结论：`Location` 指向 Portal 自身，
   合规且安全。
2. **先弄清端点归谁负责，再判结果**：我曾拿 `/api/auth/callback`（**客户端侧**回调，属网关/子应用）
   去测 **Provider**，得到 404 并差点当成"state 校验生效" —— 实际是"Portal 根本没有这个端点"。
   与"守卫没红时先读它的判据定义"是同一原则：**先确定它该负责什么，再判结果**。

## 已知限制（如实记录）

- 本沙箱 `dev`/`start` 脚本**仍起不来**：它们把 `--harmony-temporal` 放进 `NODE_OPTIONS`，
  而 node@26 拒绝 `NODE_OPTIONS` 里的 V8 旗标；绕开脚本（命令行注入）时**仍见同一报错**，
  传播机制**未查明**。⇒ 本自检走的是"直接 `node <next 入口>`"这条绕过路径。
- 未做**认证成功**路径：需要真实凭据/种子账号，且属写操作 ⇒ 不在只读自检范围内。
