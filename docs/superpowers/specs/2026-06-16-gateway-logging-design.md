# 2026-06-16 SSO 安全网关 Tracing 日志重构设计说明书 (Logging Spec)

本设计文档旨在引入 Rust 现代的 `tracing` 日志生态，替代传统的 `log` 与 `env_logger`。设计支持日志多路输出（控制台 + 文件），且文件端支持“按日自动分割（Daily Rolling）”以及“非阻塞缓冲刷盘”，以全面提升网关在高并发生产环境下的稳定性与可观测性。

## 1. 方案设计

### 1.1 依赖包更新 (`Cargo.toml`)
* 移除 `env_logger`。
* 引入 `tracing` (核心宏库)。
* 引入 `tracing-subscriber` (订阅者与多 Layer 注册中心)。
* 引入 `tracing-appender` (非阻塞滚动文件输出)。

### 1.2 配置系统扩展 (`gateway.toml` & `config.rs`)
网关配置结构体中将新增 `log_dir` 和 `log_level` 选项：
```rust
pub struct GatewayConfig {
    // ...
    /// 日志目录，默认 "logs"
    pub log_dir: String,
    /// 日志过滤级别，默认 "info"
    pub log_level: String,
}
```
并且在 `gateway.toml` 中支持默认值：
```toml
log_dir = "logs"
log_level = "info"
```

### 1.3 组合日志订阅链 (`src/main.rs`)
* 声明 `init_tracing(log_dir: &str, log_level: &str) -> tracing_appender::non_blocking::WorkerGuard`。
* 使用 `tracing_appender::rolling::daily` 按天自动创建并切分日志。
* 整合两个层：
  1. **控制台输出层 (Stdout)**：输出带 ANSI 颜色的日志，方便本地开发排查。
  2. **每日滚动文件输出层 (File)**：输出无颜色的纯文本日志，支持时间戳、目标、线程 ID 记录，在非阻塞线程中异步写，保证不阻塞网关业务的主执行流。
* 返回的 `WorkerGuard` 绑定在 `main` 周期中，通过 RAII 析构保障网关退出时缓冲区内日志安全落地。

### 1.4 代码内宏替换
将所有 `src/*.rs` 中使用 `log` 宏的导入：
```rust
use log::{debug, error, info, warn};
```
替换为：
```rust
use tracing::{debug, error, info, warn};
```

---

## 2. 验证与回归测试策略
1. **保留并适配全部单元测试**：适配测试配置文件中可能缺少的日志字段。
2. **格式化与静态检查**：运行 `cargo fmt` 与 `cargo clippy --all-targets`。
3. **功能性验证**：运行 `cargo run`，验证是否在指定目录下产生了每日命名的日志文件，且日志能同步在终端渲染输出。
