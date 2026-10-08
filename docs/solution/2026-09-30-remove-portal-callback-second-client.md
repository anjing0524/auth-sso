# 移除 Portal callback 第二套 OAuth Client 实现（架构评审候选 ④）

> 日期：2026-09-30
> 来源：improve-codebase-architecture 架构评审（Strong 候选 ④）
> 关联 ADR：ADR-003 / ADR-009 / **ADR-010（Gateway 是唯一 OAuth Client，本修复是其执行而非变更）**
> 词汇：module / interface / seam / depth / adapter（codebase-design）

## 一、问题总结

同一 OAuth Client 协议存在两套 Adapter：Gateway（Rust `oauth_flow.rs`）与 Portal（`api/auth/callback/route.ts`），且同一安全概念已经语义漂移——

| 不变量 | Gateway（oauth_flow.rs:210-214） | Portal（callback/route.ts:109，已删） |
|--------|----------------------------------|--------------------------------------|
| nonce 校验 | fail-close **双向闭合**：单侧存在即拒绝 | `cookieNonce && id_token` 同在才比对——Cookie 存在而 id_token 缺失时**静默放行** |

知识也有三处互相矛盾：callback 注释称 PKCE Cookie 由 proxy.ts 写入，proxy.ts 称职责已归 Gateway，discovery/seed 各自注册同一 path。

## 二、死代码判定（事实链，非偏好）

1. **活跃闭环不经 Portal handler**：Gateway 在边缘按 `com_authsso_callback_path` 拦截 `/api/auth/callback`（`gateway.rs:460-490`），经 Gateway 的 callback 请求永远不到达 Portal；docker-release E2E 断言 portal JWT 由 Gateway 写入。
2. **直连场景已断链**：PKCE 发起端（写 `pkce_verifier/oauth_state/oauth_nonce/return_to` 4 个 Cookie）在 a69c462 重构中已从 proxy.ts 移除；全仓 grep 证实无任何代码写这些 Cookie → 直连 callback 必然 `invalid_state` 失败。
3. **ADR-010 已定案**：config.rs 注释明言 Gateway 是唯一 OAuth Client。

Deletion test：删掉 Portal 版 callback 流程，其复杂度不会重现（Gateway 版完整覆盖）——传声筒式的第二实现。**删除它是执行 ADR-010，保留它才是违背。**

## 三、修复内容

- **删除** `apps/portal/src/app/api/auth/callback/route.ts`（Portal 侧第二套 Client Adapter，含漂移的 nonce 语义）。
- **保留** 全部 redirect_uri 白名单注册值（seed.ts / playwright.config / docker-compose.test.yml / 测试夹具）——authorize 端点校验的是 **Gateway 发来的** redirect_uri，白名单与 handler 是两回事。
- **文档对齐**（描述追上 a69c462 起的现实）：
  - `docs/spec/ARCHITECTURE.md` 阶段三：处理主体 `[Portal]` → `[Gateway]` 边缘拦截（nonce fail-close 双向闭合）。
  - `docs/spec/API.md` §2.4：标注处理方为 Gateway，Portal 无 handler，白名单仍需注册。
  - `docs/spec/ACCEPTANCE_CRITERIA.md` §13.1：追加现状注记（不改写 2026-07-08 历史审计记录）。
  - `tests/e2e/login.spec.ts`：注释明确断言边界（authorize 签发 code 为止，不涉及已移除的 handler）。
  - `docs/glossary.md` Session 段：会话 Cookie 由 Gateway 统一下发。

## 四、验证

- `typecheck` / `lint`：0 错误（`.next/types` 陈旧缓存首次误报，清理后干净）。
- `test:api`：24 文件 228 用例全绿。
- `next build`（Docker 栈内）：编译 + TS 检查通过，路由树无残留引用。
- **docker-release E2E 通过**：真实浏览器 + Gateway TLS 发布栈，登录/登出闭环（Gateway 拦截 callback → 换 token → 下发 portal_jwt_token → return_to）完整可用。

已知环境限制（与本次改动无关）：login.spec 的 redirect_uri（直连 4102）不在 Docker 栈白名单，该 spec 仅适用于直连模式（`E2E_BASE_URL` 不设、webServer 自动起 4102）；本机 glibc 与 Turbopack 原生绑定不兼容导致 webServer 无法启动，直连验证待环境修复后补跑。

## 五、最佳实践沉淀

1. **"同一协议两套实现"的漂移是必然的**：nonce 校验这种安全不变量在两个 Adapter 中必然各自演化；只要存在第二实现，语义对齐就要靠人工纪律。删除不可达的第二实现比维护对齐清单便宜。
2. **死代码判定要找"发起端"**：callback 类 handler 是否可活，取决于谁写它的前置 Cookie/参数——grep 写入点比 grep 引用点更可靠（引用点可能只剩注释和配置字符串）。
3. **redirect_uri 白名单 ≠ handler 存在**：两者共享 path 字符串但职责无关，删除 handler 时不要连带清理白名单（那会打断 Gateway 发起的合法 authorize）。
4. **历史审计档案（ACCEPTANCE_CRITERIA 等）追加注记、不改写正文**——档案记录的是当时状态，注记记录现状与原因。
