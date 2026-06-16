# SSO 网关 Tracing 日志重构实施计划 (Logging Refactoring Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入现代 `tracing` 生态，支持每日日志滚动保存至文件与控制台多路并发输出（文件输出采用高性能非阻塞异步架构），并全面取代传统的 `log` 与 `env_logger` 记录器。

**Architecture:**
1. 在 `Cargo.toml` 引入 `tracing`, `tracing-subscriber` 和 `tracing-appender`，移除 `env_logger`；
2. 在 `config.rs` 和 `gateway.toml` 中扩展 `log_dir` 和 `log_level` 配置；
3. 在 `main.rs` 初始化日志组合订阅 Registry（Stdout 控制台层 + 异步滚动文件层），并绑定 RAII 写入 Guard；
4. 将源文件中全部的 `log` 宏导入改为 `tracing` 宏导入。

**Tech Stack:** Rust 2024, tracing, tracing-subscriber, tracing-appender, config-rs

---

### Task 1: 升级 `Cargo.toml` 依赖包

**Files:**
- Modify: `apps/gateway/Cargo.toml`

- [ ] **Step 1: 移除 `env_logger` 并引入 `tracing` 生态依赖**

  ```toml
  # 移除 env_logger = "0.11.5"
  # 并在 [dependencies] 下新增：
  tracing = "0.1.40"
  tracing-subscriber = { version = "0.3.18", features = ["env-filter", "fmt", "ansi"] }
  tracing-appender = "0.2.3"
  ```

- [ ] **Step 2: 运行 `cargo check` 验证包是否成功下载并解析**

  Run: `cargo check`
  Expected: OK

- [ ] **Step 3: 提交修改**

  ```bash
  git add apps/gateway/Cargo.toml
  git commit -m "chore: update dependencies to include tracing, tracing-subscriber, and tracing-appender"
  ```

---

### Task 2: 扩展配置系统支持日志输出属性

**Files:**
- Modify: `apps/gateway/src/config.rs`
- Modify: `apps/gateway/gateway.toml`

- [ ] **Step 1: 扩展 `GatewayConfig` 结构体和默认实现**

  ```rust
  pub struct GatewayConfig {
      pub port: u16,
      pub ssl_port: u16,
      pub ssl_cert_path: String,
      pub ssl_key_path: String,
      /// 日志目录，默认 "logs"
      pub log_dir: String,
      /// 日志过滤级别，默认 "info"
      pub log_level: String,
  }

  impl Default for GatewayConfig {
      fn default() -> Self {
          Self {
              port: 18080,
              ssl_port: 18443,
              ssl_cert_path: "ssl/fullchain.pem".to_string(),
              ssl_key_path: "ssl/privkey.pem".to_string(),
              log_dir: "logs".to_string(),
              log_level: "info".to_string(),
          }
      }
  }
  ```

- [ ] **Step 2: 在 `GatewayEnvSource` 绑定日志环境变量**

  ```rust
  let env_mappings = [
      ("GATEWAY_PORT", "gateway.port"),
      ("GATEWAY_SSL_PORT", "gateway.ssl_port"),
      ("GATEWAY_SSL_CERT_PATH", "gateway.ssl_cert_path"),
      ("GATEWAY_SSL_KEY_PATH", "gateway.ssl_key_path"),
      ("GATEWAY_LOG_DIR", "gateway.log_dir"),
      ("GATEWAY_LOG_LEVEL", "gateway.log_level"),
      ("PORTAL_UPSTREAM", "portal.upstream"),
      ("PORTAL_JWKS_URL", "portal.jwks_url"),
      ("PORTAL_ISSUER", "portal.issuer"),
  ];
  ```

- [ ] **Step 3: 更新 `gateway.toml`**

  ```toml
  [gateway]
  port = 18080
  ssl_port = 18443
  ssl_cert_path = "ssl/fullchain.pem"
  ssl_key_path = "ssl/privkey.pem"
  # 日志文件夹路径
  log_dir = "logs"
  # 日志默认输出级别
  log_level = "info"
  ```

- [ ] **Step 4: 适配 `config.rs` 的单元测试**

  更新 `test_load_default_config` 和 `test_config_all` 验证默认的 `log_dir` 是 `"logs"` 以及环境变量覆盖的验证。

- [ ] **Step 5: 运行 `cargo test` 验证**

  Run: `cargo test`
  Expected: PASS

- [ ] **Step 6: 提交代码**

  ```bash
  git add apps/gateway/src/config.rs apps/gateway/gateway.toml
  git commit -m "refactor: extend config structure to support log_dir and log_level"
  ```

---

### Task 3: 实现 Tracing 初始化，重构 `main.rs` 日志记录

**Files:**
- Modify: `apps/gateway/src/main.rs`

- [ ] **Step 1: 编写并声明 `init_tracing` 函数**

  ```rust
  use tracing_subscriber::{fmt, prelude::*, EnvFilter};

  /// 初始化 Tracing，建立 Stdout 与每日滚动文件的双 Layer 订阅机制，并返回非阻塞缓冲写入 Guard
  fn init_tracing(log_dir: &str, log_level: &str) -> tracing_appender::non_blocking::WorkerGuard {
      // 1. 创建每日切分的日志 Appender，名字格式为 gateway.log.YYYY-MM-DD
      let file_appender = tracing_appender::rolling::daily(log_dir, "gateway.log");
      // 2. 利用非阻塞缓冲区异步落地，防止高并发 I/O 阻塞主服务工作线程
      let (non_blocking_file, guard) = tracing_appender::non_blocking(file_appender);

      // 3. 构建控制台输出 Layer (带 ANSI 颜色渲染)
      let stdout_layer = fmt::layer()
          .with_ansi(true)
          .with_target(true);

      // 4. 构建文件落地 Layer (去除颜色)
      let file_layer = fmt::layer()
          .with_ansi(false)
          .with_writer(non_blocking_file);

      // 5. 设置日志过滤级
      let env_filter = EnvFilter::try_from_default_env()
          .unwrap_or_else(|_| EnvFilter::new(log_level));

      // 6. 组合多重 Layer 并注册为系统全局的 Default Dispatcher
      tracing_subscriber::registry()
          .with(env_filter)
          .with(stdout_layer)
          .with(file_layer)
          .init();

      guard
  }
  ```

- [ ] **Step 2: 修改 `main.rs` 顶层宏引入，替换 `env_logger::init()`**

  - 替换 `use log::{error, info, warn};` ➡️ `use tracing::{error, info, warn};`
  - 移除 `env_logger::init();`
  - 在获取 `config` 后（因为需要 config 的 `log_dir` 和 `log_level`），立即调用 `init_tracing` 并持有 guard：
    ```rust
    let _guard = init_tracing(&config.gateway.log_dir, &config.gateway.log_level);
    ```

- [ ] **Step 3: 运行 `cargo test` 验证是否编译和通过测试**

  Run: `cargo test`
  Expected: PASS

- [ ] **Step 4: 提交**

  ```bash
  git add apps/gateway/src/main.rs
  git commit -m "feat: initialize tracing framework with stdout and rolling files layers in main.rs"
  ```

---

### Task 4: 替换网关源文件中的 `log` 宏

**Files:**
- Modify: `apps/gateway/src/gateway.rs`
- Modify: `apps/gateway/src/jwks.rs`
- Modify: `apps/gateway/src/redirect.rs`

- [ ] **Step 1: 修改各文件中的宏导入**

  将各文件中的 `use log::{...};` 替换为 `use tracing::{...};`：
  - `gateway.rs`: `use log::{debug, error, info, warn};` ➡️ `use tracing::{debug, error, info, warn};`
  - `jwks.rs`: `use log::info;` ➡️ `use tracing::info;`
  - `redirect.rs`: `use log::info;` ➡️ `use tracing::info;`

- [ ] **Step 2: 验证编译与运行测试**

  Run: `cargo test`
  Expected: PASS

- [ ] **Step 3: 提交修改**

  ```bash
  git commit -am "refactor: replace log macro usages with tracing macros across gateway source files"
  ```

---

### Task 5: 全面代码规范化与日志功能验证

**Files:**
- Modify: `apps/gateway/src/main.rs`, `apps/gateway/src/gateway.rs`, `apps/gateway/src/jwks.rs`, `apps/gateway/src/config.rs`

- [ ] **Step 1: 代码格式化**

  Run: `cargo fmt`

- [ ] **Step 2: 运行 Clippy 静态检查**

  Run: `cargo clippy --all-targets`
  Expected: 0 warnings, 0 errors

- [ ] **Step 3: 运行完整测试**

  Run: `cargo test`
  Expected: PASS

- [ ] **Step 4: 启动网关服务，验证日志输出与滚动文件**

  在 `apps/gateway` 目录下执行：
  `RUST_LOG=info cargo run`
  验证：
  - 终端控制台能正常输出 ANSI 颜色渲染的网关启动日志。
  - 在 `apps/gateway` 下成功生成了 `logs/` 文件夹。
  - `logs/` 下成功创建了格式为 `gateway.log.YYYY-MM-DD` 的日志文件，且文件中的日志无颜色、字段清晰详实。

- [ ] **Step 5: 提交**

  ```bash
  git commit -am "style: complete logging refactoring integration and verify everything works"
  ```
