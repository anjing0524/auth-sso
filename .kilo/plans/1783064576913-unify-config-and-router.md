# 统一 Config 模型 + 消除两段路由查找 + 前缀路由去歧义 + 补齐 API Guidelines

## 问题诊断

1. **Config 重复**：`[portal].upstream` 和 `[[upstreams]].name="portal".addresses` 配置同一组地址，改一处漏另一处会让 JWKS/续签静默失败。语义上所有 upstream 都是同一抽象（反向代理），区别仅在于 `path_prefixes` 不同和是否为 OIDC Provider。
2. **两段路由查找**：`Router::resolve() → upstream_name → HashMap::get → LoadBalancer`，中间 HashMap 是多余的间接层。
3. **Router 排序依赖**：有序 Vec + "首个匹配生效" 导致三种静默风险：
   - 前缀精确重复（两个 upstream 同时声明 `/shared/`）→ 无告警
   - 前缀遮蔽（`/` 排在 `/demo/` 前）→ 有 warn 但不阻止
   - 调换 `[[upstreams]]` 顺序就改变路由行为
4. **API Guidelines 缺失**：`Route` 缺 `PartialEq+Eq`，`Router` 缺 `Debug`，`UpstreamRouteConfig` 与 `Route` 形近但无转换关系。

## 目标

1. 统一 config：所有 upstream 在 `[[upstreams]]` 表格建模，`oidc_provider = true` 标记 OIDC 数据源，`[portal]` 段删除
2. `Route` 直接持有 `Arc<LoadBalancer<RoundRobin>>`，消除 HashMap 两段查找
3. Router 改为扁平前缀表 + 降序最长匹配，消除排序依赖和静默遮蔽
4. `validate_routing_consistency`：跨 upstream 前缀重复/重叠 → `anyhow::bail!`（硬错误），不保留 warn 逻辑
5. 补齐 `Debug`、重命名消除歧义

---

## Router 设计决策

**核心约束**：不同 `[[upstreams]]` 的 `path_prefixes` 之间不允许重复或前缀重叠。合并在同一个 upstream 内的多个前缀（如 `/login` + `/api/auth/` + `/` 都属于 portal）是允许的——它们路由到同一个后端。

**数据结构**：

```rust
pub struct Router {
    // 扁平化 (prefix, Route) 对，按前缀长度降序排列
    // 确保最长前缀优先匹配，不依赖配置顺序
    routes: Vec<(String, Route)>,
    // 未匹配任何前缀时的兜底 upstream（配置中第一个 [[upstreams]]）
    default_route: Route,
}
```

**匹配算法**：降序遍历前缀表，首个 `path.starts_with(prefix)` 命中即返回。因为前缀不重叠，最多命中一个（或命中 default）。

**构建时（main.rs）**：将 `[[upstreams]]` 的所有 `path_prefixes` 展开为 `(prefix, route)` 对并排序。第一条 upstream 的 Route 作为 default。

---

## 任务 1：重构 `config.rs`

### 1a. 删除 `PortalConfig`，重命名 `UpstreamRouteConfig` → `UpstreamConfig`

```rust
#[derive(Debug, Deserialize, Clone, Default)]
#[serde(default)]
pub struct UpstreamConfig {
    pub name: String,
    pub addresses: String,
    pub path_prefixes: Vec<String>,
    pub public_paths: Vec<String>,
    pub oidc_provider: bool,  // default: false，标记为 OIDC 数据源
}
```

### 1b. Config 删除 `portal` 字段

```rust
pub struct Config {
    pub gateway: GatewayConfig,
    pub redis: RedisConfig,
    pub upstreams: Vec<UpstreamConfig>,
}
```

### 1c. Config::default() 合成默认 upstreams

```rust
impl Default for Config {
    fn default() -> Self {
        Self {
            gateway: GatewayConfig::default(),
            redis: RedisConfig::default(),
            upstreams: vec![UpstreamConfig {
                name: "portal".to_string(),
                addresses: "127.0.0.1:4100".to_string(),
                path_prefixes: vec!["/".to_string()],
                public_paths: vec![
                    "/login".into(), "/register".into(), "/error".into(),
                    "/".into(), "/api/auth/".into(), "/oauth2/".into(),
                    "/.well-known/".into(),
                ],
                oidc_provider: true,
            }],
        }
    }
}
```

### 1d. `validate_routing_consistency` 重写为硬错误

签名：`validate_routing_consistency(routes: &[UpstreamConfig]) -> anyhow::Result<()>`

检查项（全部 `bail!`，不再 warn）：

| 检查 | 规则 | 示例 |
|------|------|------|
| 重复 upstream name | 同名条目 `bail!` | 两条 `name = "portal"` |
| 跨 upstream 前缀精确重复 | 同一前缀出现在两个不同 upstream 中 `bail!` | portal 和 demo 都声明 `/` |
| 跨 upstream 前缀重叠 | A 的前缀是 B 的前缀 → `bail!` | portal 有 `/api/`，demo 有 `/api/v2/` |
| 空字符串 path_prefix | `""` 恒真吞流量 → `bail!` | |
| 缺少 OIDC Provider | 无任何 upstream 标记 `oidc_provider = true` → `bail!` | |
| OIDC Provider 无 default 前缀 | 标记了 `oidc_provider` 的 upstream 不在 routes[0] 位置 → 暂不检查（见下方说明） | |

**说明**：OIDC Provider 的可达性由 Router 保证——default_route 始终是 `routes[0]`（配置中第一条 upstream）。如果用户把 non-OIDC upstream 放第一条，OIDC upstream 放后面，OIDC 的路径仍能通过前缀匹配正确路由（因为不影响 default），但 `portal_upstreams` 的地址取自 OIDC upstream 的 `addresses` 字段（独立于路由表）。因此不需要额外检查。

### 1e. 删除 `GatewayConfig` 中遗留的 `PortalConfig` 相关导入/注释

实际的 `PortalConfig` struct 定义和 Default impl 一并删除。

### 1f. 更新全部受影响测试

- `test_load_default_config`：验证 `config.upstreams[0].oidc_provider == true`
- `test_config_all`：TOML 改为新格式（`[[upstreams]]`），移除 `[portal]`
- `upstream_route_config_parses_public_paths`：增加 `oidc_provider` 验证
- `routing_check_*` 系列全部重写：构造 `UpstreamConfig` 时增加 `oidc_provider` 字段，断言从 `warnings` 改为 `Result` 错误消息
- 新增测试：
  - `routing_check_rejects_duplicate_prefix_across_upstreams`
  - `routing_check_rejects_overlapping_prefix_across_upstreams`
  - `routing_check_rejects_missing_oidc_provider`

---

## 任务 2：重构 `router.rs`

### 2a. Route 持有 LB

```rust
#[derive(Debug, Clone)]
pub struct Route {
    pub name: String,
    pub lb: Arc<LoadBalancer<RoundRobin>>,
}
```

注意：`path_prefixes` 从 `Route` 中移除——它是 Router 内部构建扁平表时的分组 key，不是 Route 的身份属性。

### 2b. Router 扁平前缀表 + Debug

```rust
use std::sync::Arc;
use pingora_load_balancing::LoadBalancer;
use pingora_load_balancing::selection::RoundRobin;

pub struct Router {
    /// (prefix, Route) 对，按 prefix 长度降序 → 最长前缀优先匹配
    routes: Vec<(String, Route)>,
    /// 未匹配任何前缀时的兜底 upstream（entries[0] 即配置中第一条 upstream）
    default_route: Route,
}

impl std::fmt::Debug for Router {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Router")
            .field("prefixes", &self.routes.iter()
                .map(|(p, r)| format!("{} → {}", p, r.name))
                .collect::<Vec<_>>())
            .field("default", &self.default_route.name)
            .finish()
    }
}

impl Router {
    /// 构建路由器。
    ///
    /// `entries` 的第 0 号元素作为 default（兜底 upstream）。
    /// 其余元素的所有 `path_prefixes` 展开为扁平前缀表，按长度降序排列。
    /// 假定 `validate_routing_consistency` 已通过（无跨 upstream 重叠）。
    pub fn new(mut entries: Vec<(Route, Vec<String>)>) -> Self {
        let (default_route, _) = entries.remove(0);
        let mut flat = Vec::new();
        for (route, prefixes) in &entries {
            for p in prefixes {
                flat.push((p.clone(), route.clone()));
            }
        }
        flat.sort_by_key(|(p, _)| std::cmp::Reverse(p.len()));
        Self { routes: flat, default_route }
    }

    /// 最长前缀匹配 → 返回对应的 Route（失败时返回 default_route）
    pub fn resolve(&self, path: &str) -> &Route {
        for (prefix, route) in &self.routes {
            if path.starts_with(prefix.as_str()) {
                return route;
            }
        }
        &self.default_route
    }
}
```

关于 `Route` 的 `Clone`：在展开前缀表时 `route.clone()` 只增加 `Arc` 引用计数（LB 是 `Arc`，upstream_name 是 `String` 的 clone）。对于 < 5 个 upstream，这个开销可忽略。

---

## 任务 3：重构 `gateway.rs`

### 3a. Gateway 移除 `upstreams: HashMap<...>` 字段

```rust
pub struct Gateway {
    path_matcher: PathMatcher,
    router: Router,
    jwt_verifier: JwtVerifier,
    token_refresher: TokenRefresher,
}
```

### 3b. upstream_peer() 直接使用 router

```rust
async fn upstream_peer(&self, session: &mut Session, _ctx: &mut Self::CTX) -> Result<Box<HttpPeer>> {
    let path = session.req_header().uri.path();
    let route = self.router.resolve(path);
    let host = header_str(session, "Host").unwrap_or("");
    debug!("接收代理请求，Host: {}，路径: {} → upstream={}", host, path, route.name);

    let peer = route.lb.select(b"", UPSTREAM_SELECT_WEIGHT).ok_or_else(|| {
        Error::explain(ErrorType::HTTPStatus(502),
            format!("gateway: upstream \"{}\" 无可用节点", route.name))
    })?;
    debug!("路由至 upstream \"{}\": {:?}", route.name, peer);
    Ok(Box::new(HttpPeer::new(peer, false, String::new())))
}
```

### 3c. 更新 Gateway::new 签名 + doc 示例 + Debug impl

- `new(path_matcher, router, jwt_verifier, token_refresher)` — 4 参数，移除 `upstreams`
- doc 示例中 Router 构造需要 `lb` 字段
- `Debug` impl 移除 `upstreams` 字段

---

## 任务 4：重构 `main.rs`

### 4a. OIDC Provider 地址提取

```rust
let upstream_routes = &config.upstreams;

let oidc_entry = upstream_routes.iter()
    .find(|u| u.oidc_provider)
    .ok_or_else(|| anyhow::anyhow!("❌ 至少需要一个 upstream 标记 oidc_provider = true"))?;
let portal_upstreams = Arc::new(Upstreams::from_config(&oidc_entry.addresses));
```

### 4b. 构建 Router（展开前缀表 + 直接嵌入 LB）

```rust
let default_upstream_name = upstream_routes.first()
    .map(|u| u.name.clone())
    .unwrap_or_else(|| "portal".to_string());

// 为每个 UpstreamConfig 构建 (Route, path_prefixes) 对
let mut entries: Vec<(Route, Vec<String>)> = Vec::new();
for uc in upstream_routes {
    let ups = Upstreams::from_config(&uc.addresses);
    if ups.is_empty() {
        anyhow::bail!("❌ upstream \"{}\" 未配置有效地址", uc.name);
    }
    let lb = Arc::new(LoadBalancer::try_from_iter(ups.iter())
        .map_err(|e| anyhow::anyhow!("配置 upstream \"{}\" 负载均衡器失败: {:?}", uc.name, e))?);
    entries.push((
        Route { name: uc.name.clone(), lb },
        uc.path_prefixes.clone(),
    ));
}
// Router::new 负责展开扁平前缀表 + 降序排列（0 号位置为 default）
let router = Router::new(entries);
```

### 4c. 公开路径合并

```rust
let all_public_paths: Vec<String> = upstream_routes
    .iter()
    .flat_map(|u| u.public_paths.iter().cloned())
    .collect();
let path_matcher = PathMatcher::new(all_public_paths);
```

### 4d. 启动期校验 + 日志调整

```rust
// 硬错误（替代原先的 warn 循环）
gateway::config::validate_routing_consistency(upstream_routes)
    .context("❌ 路由配置一致性校验失败")?;

info!("路由表 ({} 条 upstream):", upstream_routes.len());
for uc in upstream_routes {
    info!("  {} ({}) → {:?}", uc.name, uc.addresses, uc.path_prefixes);
}
info!("默认 upstream（未匹配前缀时 fallback）: {}", default_upstream_name);
```

### 4e. Gateway::new 调用更新

```rust
let gateway_proxy = http_proxy_service(
    &my_server.configuration,
    Gateway::new(path_matcher, router, jwt_verifier, token_refresher),
);
```

### 4f. 移除不再需要的 import

- 移除 `use gateway::config::UpstreamRouteConfig`（已重命名 + 不再在 main 中使用）
- 移除 `use std::collections::HashMap`（不再构建 upstream_map）

---

## 任务 5：更新 TOML 配置文件

### 5a. `gateway.toml`

- 删除整个 `[portal]` 段
- portal `[[upstreams]]` 新增 `oidc_provider = true`
- `path_prefixes` 从 27 条精简为 `["/"]`（最长前缀匹配下 `/` 自动覆盖所有路径）
- `public_paths` 合并原 `[portal].public_paths` + `[[upstreams]].public_paths`

```toml
# 删除 [portal] 段

[[upstreams]]
name = "portal"
addresses = "127.0.0.1:4100"
oidc_provider = true
path_prefixes = ["/"]
public_paths = [
    "/login", "/register", "/error",
    "/api/auth/", "/oauth2/", "/.well-known/",
    "/", "/_next/", "/favicon.ico",
]
```

### 5b. `gateway.docker.toml`

同上，`addresses` 改为 Docker 容器名 `"portal:4000"`。精简 portal `path_prefixes` 为 `["/"]`。

---

## 任务 6：补齐 API Guidelines

- `Route`：`Clone + Debug`（不加 `PartialEq/Eq`，LB 不支持）
- `Router`：自定义 `Debug` impl（前缀表 + default）
- 所有 pub 类型验证有 `Debug`
- `cargo clippy --all-targets` → 0 warnings、`cargo fmt`

---

## 影响范围

| 文件 | 操作 | 风险 |
|------|------|------|
| `src/config.rs` | 删除 PortalConfig，重命名 + 新字段，validate 重写为硬错误 | 中 |
| `src/main.rs` | 启动逻辑简化，OIDC 提取，Router 构建，移除 HashMap | 中 |
| `src/router.rs` | Route 增 lb、Router 扁平前缀表 | 低 |
| `src/gateway.rs` | 移除 upstreams 字段，upstream_peer 简化，Gateway::new 4 参数 | 低 |
| `src/lib.rs` | re-export 不变（Route + Router 仍在 router 模块） | 无 |
| `gateway.toml` | 删除 [portal] | 低 |
| `gateway.docker.toml` | 同上 | 低 |

## 验证

- `cargo check` + `cargo clippy --all-targets` → 0 warnings
- `cargo test` → 全部通过（含新增 prefix 冲突测试）
- 手动 diff toml 确认 migrate 正确
