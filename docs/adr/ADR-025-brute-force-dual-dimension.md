# ADR-025: 暴力破解防护改为「账户 × IP + IP 总量」双维度

| 属性 | 值 |
|---|---|
| **状态** | implemented (2026-10-23) |
| **日期** | 2026-10-23 |
| **决策者** | Auth-SSO 团队（质量审计 H-03 / H-04.a 的 Lead 决策） |
| **影响范围** | `apps/portal/src/lib/auth/brute-force.ts`、`/api/auth/login`、管理员解锁、`packages/contracts`（`RATE_LIMITED`、`LOGIN_FAIL_IP`）、API/PRD/需求矩阵 |

## 背景

旧实现只有一个按 `userId` 的失败计数器：5 次错误密码 → 该账户锁定 15 分钟。审计（2026-10-23）确认两个缺陷：

1. **定向 DoS（H-04.a）**：知道邮箱即可用 5 次错误请求把受害者锁在门外；锁定期间连正确密码也 423。
2. **锁定不可管理（H-03）**：锁定只存在于 Redis，`users.status` 恒为 ACTIVE；管理员的"解锁"动作
   只对 DB `LOCKED` 生效，对这类窗口锁不可达。且不存在邮箱的尝试完全不计入任何限流（枚举无成本，H-04）。

## 决策

采用**双维度计数**（OWASP Authentication Cheat Sheet 的 "rate limit by account and IP" 形态）：

| 维度 | Redis 键 | 默认阈值 | 响应 |
|---|---|---|---|
| 账户 × 客户端 IP | `portal:login_fail:<userId>:<ip>` | 5 次 / 15min | **423** `AUTH_SSO_2004` |
| 客户端 IP 总量 | `portal:login_fail_ip:<ip>` | 20 次 / 15min | **429** `AUTH_SSO_1008`（`Retry-After`） |

关键取舍：

- **锁键包含 IP**：单 IP 只能锁住"该 IP 对受害者的尝试"，受害者换网络/设备可正常登录——消除定向 DoS；
  分布式攻击者需为每个 IP 单独付费，成本被抬到"每 IP 5 次"。
- **IP 总量独立计数**：不存在邮箱也递增 IP 计数（配合等成本 bcrypt），使枚举有成本；
  同时锁定期间的继续尝试也计入 IP 总量，避免锁定期成为免费窗口。
- **管理员解锁**：清除该用户**全部 IP** 的账户计数（`clearUserBruteForceCounters`，SCAN 增量遍历）。
- **成功登录**只清（账户, IP）计数；IP 总量不清（防止攻击者用一次性正确登录洗白来源计数）。
- **Redis 故障**回退 DB（`login_logs` 含 `userId` + `ip`），语义与 Redis 路径一致；两者皆故障时
  fail-close（抛"暴力破解防范服务不可用"）。
- 阈值全部可用环境变量覆盖：`BRUTE_FORCE_MAX_ATTEMPTS`、`BRUTE_FORCE_WINDOW_MINUTES`、
  `BRUTE_FORCE_IP_MAX_ATTEMPTS`、`BRUTE_FORCE_IP_WINDOW_MINUTES`。

## 后果

- 正面：定向锁死攻击对受害者失效；枚举有 IP 成本；锁定状态可在 Redis 层管理；错误语义区分
  "账户×IP 锁定"（423，可换网络继续）与"来源被限流"（429）。
- 代价：多一次 Redis 读/写与两个键的内存；同一 NAT 后的多人共享 IP 会在 20 次失败后互相影响
  （阈值可调；生产可结合 Gateway 边缘限流分层）。
- 未解决（记录）：真正的分布式慢速攻击仍需 WAF/边缘限流或 CAPTCHA；管理员 UI 对"ACTIVE 但被
  Redis 窗口锁定"的用户没有独立按钮（窗口 15 分钟自愈，解锁动作已覆盖 DB LOCKED 与全部 IP 计数）。

## 验证

- `apps/portal/__tests__/api/brute-force.test.ts`：单 IP 锁不死其他 IP、IP 总量 429、成功登录不清 IP 总量。
- `apps/portal/__tests__/api/auth-login.test.ts`：攻击者 5 次失败后受害者从另一 IP 登录 200；
  同 IP 跨账户 20 次 → 429 `RATE_LIMITED`。
- 运行时验收：`tests/e2e` + 运行栈黑盒（见 roadmap 续九十六/续九十七）。

## 相关 ADR

- ADR-005（三层安全模型：登录风控属 Portal 层）
- ADR-011（失败语义分级：423/429 的业务含义）
