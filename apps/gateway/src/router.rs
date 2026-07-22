use std::sync::Arc;

use pingora_load_balancing::LoadBalancer;
use pingora_load_balancing::selection::RoundRobin;

use crate::config::OAuthConfig;

/// 单条路由条目 — prefix 即 upstream name，一次装配负载均衡器与 OAuth Client 配置。
pub struct RouteEntry {
    /// 路径前缀（即 upstream name，如 `/`、`/demo/`）
    pub prefix: String,
    pub lb: Arc<LoadBalancer<RoundRobin>>,
    pub oauth: OAuthConfig,
}

/// 前缀路由表 — 按 prefix 长度降序排列的单一真相源。
///
/// 匹配规则：最长前缀优先（首条目即最长前缀），兜底取末条目（最短前缀，通常为 `/`）。
/// `resolve_idx` 返回索引存入请求 ctx，`request_filter` 与 `upstream_peer`
/// 全生命周期共享一次匹配结果（OAuth 配置与 LB 同源，杜绝两张表漂移）。
pub struct Router {
    entries: Vec<RouteEntry>,
}

impl std::fmt::Debug for Router {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Router")
            .field(
                "routes",
                &self
                    .entries
                    .iter()
                    .map(|e| e.prefix.as_str())
                    .collect::<Vec<_>>(),
            )
            .finish()
    }
}

impl Router {
    /// 按 prefix 长度降序排序；启动期已保证非空（main.rs 校验）。
    pub fn new(mut entries: Vec<RouteEntry>) -> Self {
        assert!(!entries.is_empty(), "Router::new 要求至少一条路由条目");
        entries.sort_by_key(|e| std::cmp::Reverse(e.prefix.len()));
        Self { entries }
    }

    /// 最长前缀匹配；未命中兜底末条目（最短前缀，通常 "/"）
    pub fn resolve_idx(&self, path: &str) -> usize {
        self.entries
            .iter()
            .position(|e| path.starts_with(&e.prefix))
            .unwrap_or(self.entries.len() - 1)
    }

    /// 按索引取路由条目（索引来自 `resolve_idx`）
    pub fn entry(&self, idx: usize) -> Option<&RouteEntry> {
        self.entries.get(idx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_lb() -> Arc<LoadBalancer<RoundRobin>> {
        Arc::new(LoadBalancer::try_from_iter(["127.0.0.1:1"]).unwrap())
    }

    fn make_router(names: &[&str]) -> Router {
        let entries = names
            .iter()
            .map(|n| RouteEntry {
                prefix: n.to_string(),
                lb: make_lb(),
                oauth: OAuthConfig {
                    client_id: format!("client{n}"),
                    client_secret: "secret".to_string(),
                },
            })
            .collect::<Vec<_>>();
        Router::new(entries)
    }

    #[test]
    fn resolve_longest_prefix_wins() {
        // 构造顺序故意打乱，验证 new() 会按长度降序排序
        let router = make_router(&["/", "/demo/", "/demo/admin/"]);
        let e = router.entry(router.resolve_idx("/demo/admin/x")).unwrap();
        assert_eq!(e.prefix, "/demo/admin/");
        let e = router.entry(router.resolve_idx("/demo/landing")).unwrap();
        assert_eq!(e.prefix, "/demo/");
    }

    #[test]
    fn resolve_root_matches_any_slash_path() {
        let router = make_router(&["/", "/demo/"]);
        let e = router.entry(router.resolve_idx("/dashboard")).unwrap();
        assert_eq!(e.prefix, "/");
    }

    #[test]
    fn resolve_fallback_returns_shortest_prefix() {
        // 不以任何 prefix 开头的路径 → 兜底应返回末条目（最短前缀 "/"），
        // 而非降序排序后的首条目（最长前缀）。
        let router = make_router(&["/", "/demo/"]);
        let e = router.entry(router.resolve_idx("non-slash-path")).unwrap();
        assert_eq!(e.prefix, "/");
    }

    #[test]
    fn entry_carries_oauth_config() {
        // 路由条目与 OAuth 配置同源：一次匹配同时得到 LB 与 OAuth Client
        let router = make_router(&["/", "/demo/"]);
        let e = router.entry(router.resolve_idx("/demo/x")).unwrap();
        assert_eq!(e.oauth.client_id, "client/demo/");
        let e = router.entry(router.resolve_idx("/dashboard")).unwrap();
        assert_eq!(e.oauth.client_id, "client/");
    }
}
