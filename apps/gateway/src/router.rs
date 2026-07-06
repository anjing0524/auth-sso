use std::sync::Arc;

use pingora_load_balancing::LoadBalancer;
use pingora_load_balancing::selection::RoundRobin;

/// 前缀路由表 — upstream name 即 path prefix，按 name 长度降序排列。
///
/// 匹配规则：最长前缀优先（首条目即最长前缀），兜底取末条目（最短前缀，通常为 `/`）。
/// 无需额外的 prefix 字段或 HashMap。
pub struct Router {
    entries: Vec<(String, Arc<LoadBalancer<RoundRobin>>)>,
}

impl std::fmt::Debug for Router {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Router")
            .field(
                "routes",
                &self
                    .entries
                    .iter()
                    .map(|(n, _)| n.as_str())
                    .collect::<Vec<_>>(),
            )
            .finish()
    }
}

impl Router {
    /// `entries`: `(name, lb)`，name 即 path prefix。
    ///
    /// 按 name 长度降序排序，使 `resolve` 线性扫描时首个命中即为最长前缀。
    /// 首条目为最长前缀；末条目为最短前缀（兜底）。
    pub fn new(mut entries: Vec<(String, Arc<LoadBalancer<RoundRobin>>)>) -> Self {
        entries.sort_by_key(|(n, _)| std::cmp::Reverse(n.len()));
        Self { entries }
    }

    /// 最长前缀匹配：线性扫描（已按长度降序），首个命中即为最长前缀。
    ///
    /// 未命中时返回末条目（排序后最短前缀，通常为 `/`，作 portal 兜底）。
    pub fn resolve(&self, path: &str) -> (&str, &Arc<LoadBalancer<RoundRobin>>) {
        for (name, lb) in &self.entries {
            if path.starts_with(name.as_str()) {
                return (name.as_str(), lb);
            }
        }
        let (name, lb) = self.entries.last().expect("Router 至少含一条 upstream");
        (name.as_str(), lb)
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
            .map(|n| (n.to_string(), make_lb()))
            .collect::<Vec<_>>();
        Router::new(entries)
    }

    #[test]
    fn resolve_longest_prefix_wins() {
        // 构造顺序故意打乱，验证 new() 会按长度降序排序
        let router = make_router(&["/", "/demo/", "/demo/admin/"]);
        let (name, _) = router.resolve("/demo/admin/x");
        assert_eq!(name, "/demo/admin/");
        let (name, _) = router.resolve("/demo/landing");
        assert_eq!(name, "/demo/");
    }

    #[test]
    fn resolve_root_matches_any_slash_path() {
        let router = make_router(&["/", "/demo/"]);
        let (name, _) = router.resolve("/dashboard");
        assert_eq!(name, "/");
    }

    #[test]
    fn resolve_fallback_returns_shortest_prefix() {
        // 不以任何 name 开头的路径 → 兜底应返回最短前缀（"/"），
        // 而非降序排序后的首条目（最长前缀）。
        let router = make_router(&["/", "/demo/"]);
        let (name, _) = router.resolve("non-slash-path");
        assert_eq!(name, "/");
    }
}
