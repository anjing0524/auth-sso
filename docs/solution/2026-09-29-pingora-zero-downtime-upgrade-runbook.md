# Pingora 网关零停机升级 Runbook（-u 二进制热交接）

**日期**: 2026-09-29
**关联**: docs/research/2026-09-29-pingora-rust-gateway-practices.md（§1/§4）、docs/solution/2026-07-28-gateway-letsencrypt-zero-downtime.md（证书级零停机，本文覆盖进程级）

## 机制

Pingora 内建 `-u / --upgrade` 零停机升级：新进程启动后经 **Unix upgrade socket** 从旧进程接管全部监听 fd（HTTPS 443 / HTTP 80），旧进程继续排空在途请求后退出。全程无请求丢弃、无端口空窗。这与证书级零重启（ACME + ArcSwap 快照热替换）正交——前者换进程，后者换证书。

## 升级步骤

```bash
# 1. 构建并分发新二进制（确认 cargo clippy -D warnings + cargo test 全绿后构建）
cargo build --release

# 2. 以 -u 启动新进程（必须与旧进程同配置文件、同数据目录）
./gateway -c gateway.toml -d -u

# 3. 观察交接：新进程日志出现监听就绪，旧进程排空后退出
tail -f logs/gateway.log
```

## 前提与注意

1. **同配置**：新旧进程必须使用同一 `-c` 配置（监听端口、`ssl_port`、`upstream_scheme`）。配置变更需分两步发布：先热升级到"兼容新旧行为"的版本，再热升级到新配置版本。
2. **状态目录不受影响**：ACME 状态目录（`acme/`，账户 + 证书 bundle）与日志目录由两个进程共享读、仅新进程写——升级窗口内 ACME 后台任务可能同时存活，`write_atomic`（fsync + rename）保证 bundle 原子性，无半更新风险。
3. **就绪门控自动生效**：新进程的 Redis 初始化、JWKS 首刷均经 `start_with_ready_notifier` + `add_dependency` 门控，公钥缓存就绪前不接流量；首刷连续失败会降级放行（与冷启动语义一致）。
4. **健康检查随进程重建**：共享 `HealthRegistry` 的探活状态在新进程内从零开始，首轮探测完成前所有节点视为就绪——升级窗口内若恰有节点宕机，可能短暂命中后由 fail_to_connect 兜底，与升级前行为一致。
5. **回滚**：升级失败（新进程启动即退）时旧进程仍在服务——用旧二进制再次 `-u` 即可；若旧进程已退出，按冷启动路径拉起。

## 验证清单

- [ ] 升级期间压测无 5xx / connection refused
- [ ] 新进程 JWKS 日志出现"首次 JWKS 缓存刷新成功，开始接受流量"
- [ ] ACME 日志无异常（若 self-managed-tls）
- [ ] `X-Gateway-Signature` 验签在 Portal 侧持续通过（HMAC 密钥未变）
- [ ] 旧进程完全退出（`pgrep gateway` 仅剩新 PID）
