# SSO 安全网关重构实施计划 (Gateway Refactoring Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 遵循 Rust 哲学（消除热路径上的异步锁、路由白名单机制模块化封装、显式强类型错误），对 `apps/gateway` 进行安全性与简洁性优化，且确保完全向后兼容。

**Architecture:** 
1. 将 `JwksCache` 的 `tokio::sync::RwLock` 替换为同步锁 `std::sync::RwLock`，并对外暴露 `get_key` 同步接口，免除过滤器中 JWT 校验时对异步锁的申请；
2. 抽象并封装 `PathMatcher` 模块，简化 `main.rs` 和 `gateway.rs` 的职责边界；
3. 定义强类型的 `JwksError` 以取代 `Box<dyn Error>`。

**Tech Stack:** Rust 2024, Pingora, Tokio, reqwest

---

### Task 1: 引入强类型错误 `JwksError` 并重构公钥拉取错误传递

**Files:**
- Modify: `apps/gateway/src/jwks.rs`
- Modify: `apps/gateway/src/main.rs`

- [ ] **Step 1: 在 `jwks.rs` 中定义 `JwksError` 自定义错误枚举**
  
  ```rust
  use std::fmt;

  /// JWKS 获取与解析过程中的强类型错误定义
  #[derive(Debug)]
  pub enum JwksError {
      /// 网络请求或解析 JSON 失败
      Network(reqwest::Error),
      /// 响应中不含任何合法的公钥
      EmptyKeys,
      /// 读写锁中毒故障
      LockPoisoned,
  }

  impl fmt::Display for JwksError {
      fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
          match self {
              JwksError::Network(e) => write!(f, "网络或 JSON 解析错误: {}", e),
              JwksError::EmptyKeys => write!(f, "JWKS 响应中未找到任何有效且可解析的公钥"),
              JwksError::LockPoisoned => write!(f, "JWKS 读写锁中毒失效"),
          }
      }
  }

  impl std::error::Error for JwksError {}

  impl From<reqwest::Error> for JwksError {
      fn from(err: reqwest::Error) -> Self {
          JwksError::Network(err)
      }
  }
  ```

- [ ] **Step 2: 修改 `JwksCache::refresh` 方法以返回 `Result<(), JwksError>`**
  
  ```rust
  pub async fn refresh(&self, jwks_url: &str) -> Result<(), JwksError> {
      let resp = self.client.get(jwks_url).send().await?;
      let jwk_set: JwkSet = resp.json().await?;

      let mut new_keys = HashMap::new();
      for jwk in jwk_set.keys {
          if let Some(ref kid) = jwk.common.key_id {
              if let Ok(key) = DecodingKey::from_jwk(&jwk) {
                  new_keys.insert(kid.clone(), key);
              }
          }
      }

      if new_keys.is_empty() {
          return Err(JwksError::EmptyKeys);
      }

      let loaded_count = new_keys.len();
      
      // 注意：此处写锁仍使用异步锁，但在 Task 2 中会替换为同步写锁
      *self.keys.write().await = new_keys;

      info!(
          "JWKS 公钥缓存刷新成功，加载了 {} 个 Key，来源: {}",
          loaded_count, jwks_url
      );
      Ok(())
  }
  ```

- [ ] **Step 3: 修改 `main.rs` 以适配 `JwksError`**
  
  在 `main.rs` 中：
  1. 第 44-59 行的错误匹配分支
  2. 第 93-106 行的首次拉取错误匹配分支

- [ ] **Step 4: 运行 `cargo test` 验证编译与现有测试是否成功**
  
  Run: `cargo test`
  Expected: 8 tests passed, 0 failed

- [ ] **Step 5: 提交代码**
  
  ```bash
  git add apps/gateway/src/jwks.rs apps/gateway/src/main.rs
  git commit -m "refactor: introduce strongly-typed JwksError"
  ```

---

### Task 2: 将 `JwksCache` 读写锁转为同步锁，并封装 `get_key` 与 `is_empty`

**Files:**
- Modify: `apps/gateway/src/jwks.rs`
- Modify: `apps/gateway/src/gateway.rs`
- Modify: `apps/gateway/src/main.rs`

- [ ] **Step 1: 修改 `jwks.rs` 使用 `std::sync::RwLock`**
  
  ```rust
  pub struct JwksCache {
      keys: std::sync::RwLock<HashMap<String, DecodingKey>>,
      pub client: reqwest::Client,
  }

  impl JwksCache {
      pub fn new() -> Arc<Self> {
          let client = reqwest::Client::builder()
              .timeout(std::time::Duration::from_secs(5))
              .build()
              .unwrap_or_else(|_| reqwest::Client::new());

          Arc::new(Self {
              keys: std::sync::RwLock::new(HashMap::new()),
              client,
          })
      }

      pub fn get_key(&self, kid: &str) -> Option<DecodingKey> {
          self.keys.read().ok()?.get(kid).cloned()
      }

      pub fn is_empty(&self) -> bool {
          self.keys.read().map(|k| k.is_empty()).unwrap_or(true)
      }
  }
  ```
  在 `refresh` 中同步写锁：
  ```rust
  let loaded_count = new_keys.len();
  {
      let mut keys_guard = self.keys.write().map_err(|_| JwksError::LockPoisoned)?;
      *keys_guard = new_keys;
  }
  ```

- [ ] **Step 2: 修改 `gateway.rs` 中的 `verify_jwt` 使用同步接口 `get_key`**
  
  ```rust
  let decoding_key = match self.jwks_cache.get_key(&kid) {
      Some(k) => k,
      None => {
          error!("JWKS 缓存中未找到对应的 kid: {}", kid);
          return false;
      }
  };
  ```

- [ ] **Step 3: 修改 `main.rs` 中的 `start_jwks_background_refresh_task` 以调用 `is_empty`**
  
  ```rust
  let has_keys = !jwks_cache.is_empty();
  ```

- [ ] **Step 4: 运行 `cargo test` 验证**
  
  Run: `cargo test`
  Expected: PASS

- [ ] **Step 5: 提交代码**
  
  ```bash
  git add apps/gateway/src/jwks.rs apps/gateway/src/gateway.rs apps/gateway/src/main.rs
  git commit -m "refactor: eliminate tokio async lock in JwksCache and encapsulate read interface"
  ```

---

### Task 3: 提取并实现 `PathMatcher` 模块，模块化路由白名单逻辑

**Files:**
- Modify: `apps/gateway/src/gateway.rs`
- Modify: `apps/gateway/src/main.rs`

- [ ] **Step 1: 在 `gateway.rs` 中声明并实现 `PathMatcher`**
  
  ```rust
  /// 预分类和高性能过滤的公开路径匹配器
  pub struct PathMatcher {
      public_exact_paths: HashSet<String>,
      public_prefix_paths: Vec<String>,
  }

  impl PathMatcher {
      /// 初始化并对白名单进行分类与高性能前缀排序
      pub fn new(public_paths: Option<Vec<String>>) -> Self {
          let mut exact_paths = HashSet::new();
          let mut prefix_paths = Vec::new();
          for path in public_paths.unwrap_or_default() {
              if path.ends_with('/') && path != "/" {
                  prefix_paths.push(path);
              } else {
                  exact_paths.insert(path);
              }
          }
          // 性能优化：降序排列前缀以尽早触及深度具体路径
          prefix_paths.sort_by_key(|p| std::cmp::Reverse(p.len()));

          Self {
              public_exact_paths: exact_paths,
              public_prefix_paths: prefix_paths,
          }
      }

      /// 校验当前请求路径是否放行
      pub fn is_public(&self, path: &str) -> bool {
          // 1. 放行静态资源目录
          if path.starts_with("/_next/") || path.starts_with("/static/") {
              return true;
          }

          // 2. 常见静态资产文件的扩展名放行
          const STATIC_EXTENSIONS: &[&str] = &[
              "js", "css", "ico", "png", "jpg", "jpeg", "gif", "svg", "woff", "woff2", "ttf", "json",
              "txt",
          ];
          if let Some(idx) = path.rfind('.') {
              let ext = &path[idx + 1..];
              if !ext.contains('/') {
                  if STATIC_EXTENSIONS
                      .iter()
                      .any(|&static_ext| ext.eq_ignore_ascii_case(static_ext))
                  {
                      return true;
                  }
              }
          }

          // 3. O(1) 快速精确匹配
          if self.public_exact_paths.contains(path) {
              return true;
          }

          // 4. 动态前缀放行路径匹配
          for prefix in &self.public_prefix_paths {
              if path.starts_with(prefix) {
                  return true;
              }
          }

          false
      }
  }
  ```

- [ ] **Step 2: 修改 `Gateway` 结构体使用 `PathMatcher`**
  
  ```rust
  pub struct Gateway {
      pub portal_lb: Arc<LoadBalancer<RoundRobin>>,
      pub jwks_cache: Arc<JwksCache>,
      pub issuer: String,
      pub path_matcher: PathMatcher,
  }
  ```
  并在 `ProxyHttp` 里的 `request_filter` 调用之：
  ```rust
  let path = session.req_header().uri.path();
  if self.path_matcher.is_public(path) {
      return Ok(false);
  }
  ```
  删除原先的局部函数 `is_public_asset_or_route`。

- [ ] **Step 3: 修改 `main.rs` 以实例化 `PathMatcher`**
  
  删除原先在 `main.rs` 中进行路径过滤、降序排序的代码，简化为：
  ```rust
  let path_matcher = PathMatcher::new(config.portal.public_paths.clone());
  ```

- [ ] **Step 4: 更新 `gateway.rs` 的单元测试**
  
  在单元测试中实例化 `PathMatcher` 并对其进行测试，验证与原先逻辑完全等价。

- [ ] **Step 5: 运行 `cargo test`**
  
  Run: `cargo test`
  Expected: PASS

- [ ] **Step 6: 提交代码**
  
  ```bash
  git add apps/gateway/src/gateway.rs apps/gateway/src/main.rs
  git commit -m "feat: abstract PathMatcher for routing encapsulation"
  ```

---

### Task 4: 代码规范化与质量保证

**Files:**
- Modify: `apps/gateway/src/main.rs`, `apps/gateway/src/gateway.rs`, `apps/gateway/src/jwks.rs`, `apps/gateway/src/config.rs`

- [ ] **Step 1: 代码格式化**
  
  Run: `cargo fmt`

- [ ] **Step 2: 静态代码分析**
  
  Run: `cargo clippy --all-targets`
  Expected: 没有任何警告和错误。

- [ ] **Step 3: 运行完整测试**
  
  Run: `cargo test`
  Expected: PASS

- [ ] **Step 4: 提交**
  
  ```bash
  git commit -am "style: format code and resolve clippy warnings"
  ```
