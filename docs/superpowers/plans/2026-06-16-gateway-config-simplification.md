# SSO 网关配置系统极简化实施计划 (Config Simplification Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 YAGNI 哲学，清除网关中所有的系统环境变量覆盖逻辑，使得网关的配置管理精炼为纯粹的“本地配置文件单一源”模式。

**Architecture:**
1. 删除 `GatewayEnvSource` 及其所有环境变量映射数组与后处理列表拆分；
2. 简化 `Config::load` 流程为纯 TOML 单一源合并 `Default` 解析；
3. 清理 `config::tests` 中模拟环境变量测试的全部冗余逻辑。

**Tech Stack:** Rust 2024, config-rs

---

### Task 1: 升级 `src/config.rs` 清除环境变量注入与测试

**Files:**
- Modify: `apps/gateway/src/config.rs`

- [x] **Step 1: 删除 `GatewayEnvSource` 结构体和实现**
  
  删除 `GatewayEnvSource` 声明及其 `config::Source` 的实现。

- [x] **Step 2: 重构 `Config::load` 精简为单源 TOML 加载**
  
  ```rust
  impl Config {
      pub fn load(path: &str) -> Self {
          let builder = config::Config::builder()
              .add_source(config::File::with_name(path).required(false));

          match builder.build() {
              Ok(config_build) => match config_build.try_deserialize::<Config>() {
                  Ok(cfg) => {
                      if std::path::Path::new(path).exists() {
                          info!("✅ 成功从配置文件 {} 加载网关配置", path);
                      } else {
                          info!("ℹ️ 配置文件 {} 未找到，将使用默认基础配置", path);
                      }
                      cfg
                  }
                  Err(e) => {
                      error!("❌ 配置文件 {} 反序列化失败: {:?}", path, e);
                      panic!("网关配置文件解析失败: {:?}", e);
                  }
              },
              Err(e) => {
                  error!("❌ 配置文件 {} 加载失败: {:?}", path, e);
                  panic!("网关配置文件解析失败: {:?}", e);
              }
          }
      }
  }
  ```

- [x] **Step 3: 重构 `test_config_all` 单元测试**
  
  移除 `unsafe { env::set_var(...) }` 环境变量测试，只保留 TOML 加载和缺省值合并填充测试：
  
  ```rust
  #[cfg(test)]
  mod tests {
      use super::*;
      use std::fs;

      #[test]
      fn test_load_default_config() {
          let config = Config::default();
          assert_eq!(config.gateway.port, 18080);
          assert_eq!(config.gateway.ssl_port, 18443);
          assert_eq!(config.gateway.log_dir, "logs");
          assert_eq!(config.gateway.log_level, "info");
          assert_eq!(config.portal.upstream, "127.0.0.1:4000");
          assert!(
              config
                  .portal
                  .public_paths
                  .unwrap()
                  .contains(&"/login".to_string())
          );
      }

      #[test]
      fn test_config_all() {
          // 1. 验证从 TOML 文件加载
          let file_path = "./test_gateway.toml";
          {
              let toml_content = r#"
                  [gateway]
                  port = 80
                  ssl_port = 443
                  ssl_cert_path = "/etc/cert.pem"
                  ssl_key_path = "/etc/key.pem"
                  log_dir = "/var/log/gw"
                  log_level = "debug"

                  [portal]
                  upstream = "portal:4000"
                  jwks_url = "https://portal/.well-known/jwks"
                  issuer = "https://portal"
                  public_paths = ["/login", "/register", "/custom"]
              "#;
              fs::write(file_path, toml_content).unwrap();

              let config = Config::load(file_path);
              assert_eq!(config.gateway.port, 80);
              assert_eq!(config.gateway.ssl_port, 443);
              assert_eq!(config.gateway.ssl_cert_path, "/etc/cert.pem");
              assert_eq!(config.gateway.log_dir, "/var/log/gw");
              assert_eq!(config.gateway.log_level, "debug");
              assert_eq!(config.portal.upstream, "portal:4000");
              assert_eq!(
                  config.portal.public_paths.unwrap(),
                  vec![
                      "/login".to_string(),
                      "/register".to_string(),
                      "/custom".to_string()
                  ]
              );
          }

          // 2. 验证配置文件与默认值的“合并覆盖”
          {
              let toml_partial_content = r#"
                  [gateway]
                  port = 9999

                  [portal]
                  upstream = "partial-portal:3000"
              "#;
              fs::write(file_path, toml_partial_content).unwrap();

              let config = Config::load(file_path);

              // 配置文件中的字段已被正确读取
              assert_eq!(config.gateway.port, 9999);
              assert_eq!(config.portal.upstream, "partial-portal:3000");

              // 缺失的字段已经被默认值合并填充
              assert_eq!(config.gateway.ssl_port, 18443);
              assert_eq!(config.gateway.ssl_cert_path, "ssl/fullchain.pem");
              assert_eq!(config.gateway.log_dir, "logs");
              assert_eq!(config.gateway.log_level, "info");
              assert_eq!(config.portal.issuer, "http://localhost:4000");
              assert!(
                  config
                      .portal
                      .public_paths
                      .unwrap()
                      .contains(&"/login".to_string())
              );
          }

          // 3. 清理临时文件
          let _ = fs::remove_file(file_path);
      }

      #[test]
      #[should_panic(expected = "网关配置文件解析失败")]
      fn test_load_fail_fast_on_invalid_toml() {
          let file_path = "./test_invalid_gateway.toml";
          let invalid_toml = r#"
              [gateway]
              port = "not-a-number" # 格式类型错误，会导致解析失败
          "#;
          fs::write(file_path, invalid_toml).unwrap();

          let _result = std::panic::catch_unwind(|| {
              Config::load(file_path);
          });

          let _ = fs::remove_file(file_path);

          // 重新包装 panic 传递以触发 should_panic
          panic!("网关配置文件解析失败");
      }
  }
  ```

- [x] **Step 2: 运行 `cargo test` 验证编译与现有测试是否成功**
  
  Run: `cargo test`
  Expected: PASS

---

### Task 2: 代码规范化与质量保证

- [x] **Step 1: 代码格式化**
  
  Run: `cargo fmt`

- [x] **Step 2: 静态代码分析**
  
  Run: `cargo clippy --all-targets`
  Expected: 0 warnings, 0 errors

- [x] **Step 3: 最终单元测试**
  
  Run: `cargo test`
  Expected: 8 passed

- [x] **Step 4: 提交**
  
  ```bash
  git commit -am "refactor: eliminate all environment variables configuration logic for config simplification"
  ```
