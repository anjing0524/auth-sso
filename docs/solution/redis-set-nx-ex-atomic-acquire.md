# Redis SET NX EX 前置抢占替代「检查-后写」

> 来源：Gateway 安全审计 B4（续签去重 TOCTOU），2026-07-16 修复。

## 问题

Token 静默续签的去重曾是「先 GET 检查，成功后再 SET NX EX 写标记」：

```
请求 A: GET dedup:sub → nil        ┐
请求 B: GET dedup:sub → nil        ┤ 检查与写入之间的窗口内，
请求 A: 发起续签（RT 轮换）         │ 并发请求全部通过检查
请求 B: 发起续签（RT 已被 A 作废）  ┘ → RT reuse 检测误杀 / 会话互相踢下线
```

「检查」与「写入」是两次独立的 Redis 往返，中间窗口就是 TOCTOU。检查通过的并发方都会发起续签，RT 轮换互相作废。

## 模式

**把「检查 + 写入」合并为服务端单命令原子抢占**，抢占成功者才有资格执行动作；执行失败则释放锁允许快速重试：

```rust
/// SET key value NX EX ttl，返回是否抢占成功。fail-open：Redis 不可用时返回 true。
pub async fn acquire_nx_ex(key: &str, value: &str, ttl_secs: u64) -> bool {
    // SET ... NX 在 key 已存在时返回 nil，抢占成功返回 OK —— 服务端原子判定
}

pub async fn try_refresh(&self, ...) -> Option<RefreshedTokens> {
    if !redis::acquire_nx_ex(&dedup_key, "1", REFRESH_DEDUP_SEC).await {
        return None;                      // 未抢到：窗口内已有续签在进行
    }
    // ... 尝试各端点 ...
    // 成功：保留锁至 TTL 自然过期（即去重窗口）
    // 全部失败：DEL 释放锁，下次请求可立即重试
}
```

三条纪律：

1. **抢占在前，动作在后**——绝不允许「先检查再动作再写标记」。
2. **动作失败必须释放锁（DEL）**，否则失败会把用户锁死一个 TTL 窗口。
3. **fail-open 语义要与业务安全面对齐**：Redis 不可用时返回「抢占成功」（放行续签），代价是降级期间可能重复续签，但不阻断业务。

## 竞争失败方的行为（有意的权衡）

抢占失败 + AT 已 `Expired` 的请求收到 401/PKCE。我们**不在 Redis 缓存新 AT** 供失败方取用——Redis 中零 token 明文是既定安全设计（消除泄露面）。失败方浏览器会在续签成功方下发新 Cookie 后自愈。

## 适用判据

任何「检查 Redis 状态 → 据此执行带副作用的动作」的代码都适用此模式：去重、幂等控制、分布式互斥、一次性任务领取。识别信号是代码里出现 `if redis::get(..).is_none() { do(); redis::set(..) }` 形态。
