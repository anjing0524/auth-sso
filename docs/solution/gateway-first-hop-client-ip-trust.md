# 第一跳代理的客户端 IP 信任模型

> 来源：Gateway 安全审计 B2（XFF 伪造）/ B7（限流键可伪造导致自我 DoS），2026-07-16 修复。

## 问题

网关曾从入站 `X-Forwarded-For` 首段提取「客户端 IP」，同时用于：

1. 认证端点限流键 —— 攻击者每请求换一个伪造 XFF 即可绕过限流；反之伪造他人 IP 可把受害者打进限流黑桶。
2. 注入下游的 `X-Client-IP` —— 下游审计日志记录的是攻击者任意指定的地址。
3. 无 XFF 的请求全部落入共享 `"unknown"` 桶 —— 正常用户互相挤兑，形成自我 DoS。

## 信任模型

**Gateway 是 TLS 终结的第一跳**（见 AGENTS.md「信创网关 — HTTPS 终结」）。对第一跳而言：

- **socket 对端地址是唯一可信的客户端 IP**（TCP 三次握手保证，不可伪造）。
- 入站的 `X-Forwarded-For` / `X-Real-IP` 全部来自不可信客户端，**一律覆写，绝不透传**。

```rust
// SessionExt::client_ip — socket 真实地址
fn client_ip(&self) -> Option<String> {
    self.client_addr().and_then(|a| a.as_inet()).map(|inet| inet.ip().to_string())
}

// upstream_request_filter — 权威覆写
let _ = upstream_request.remove_header("X-Forwarded-For");
let _ = upstream_request.remove_header("X-Real-IP");
if let Some(ip) = real_ip.as_deref() {
    upstream_request.insert_header("X-Forwarded-For", ip)?;
    upstream_request.insert_header("X-Real-IP", ip)?;
    upstream_request.insert_header("X-Client-IP", ip)?;
}
```

要点：

1. **剥离清单与覆写解耦**。`strip_identity_headers` 的放行清单可以保留 `x-forwarded-*`（代理标准头），因为随后必然被权威覆写——语义安全不依赖剥离。
2. **限流键取 socket 地址**，且仅对限流路径（`/api/auth/**`）才提取 IP，非限流路径零开销。
3. **`"unknown"` 仅剩 unix-socket 等边缘场景**，不再是全站共享桶。

## 边界与演进

若未来在 Gateway 前部署 LB/CDN，socket 地址将变成 LB 地址。届时需引入 **trusted-proxy 配置**：仅当对端 socket 地址 ∈ 可信代理网段时，才信任其 XFF 的最后 N 跳。本次明确不做（当前拓扑无前置代理）。

## 验证

- E2E：本地 `curl -H "X-Forwarded-For: 1.2.3.4"` 不影响限流桶，下游收到的 `X-Client-IP` 为 socket 地址。
- 单测：`is_secure_host` 回环判定覆盖 `127.0.0.0/8`、`[::1]:port`；防子串绕过（`2127.0.0.1`、`localhost.evil.com`）。
