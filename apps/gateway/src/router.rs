use std::sync::Arc;

use pingora_load_balancing::LoadBalancer;
use pingora_load_balancing::selection::RoundRobin;

/// 前缀路由表 — upstream name 即 path prefix，按 name 长度降序排列。
///
/// 最长前缀优先 + 首条目兜底。无需额外的 prefix 字段或 HashMap。
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
    /// `entries`: `(name, lb)`，name 即 path prefix。首条目为兜底。
    pub fn new(mut entries: Vec<(String, Arc<LoadBalancer<RoundRobin>>)>) -> Self {
        entries.sort_by_key(|(n, _)| std::cmp::Reverse(n.len()));
        Self { entries }
    }

    /// 最长前缀匹配。未命中时返回首条目（兜底）。
    pub fn resolve(&self, path: &str) -> (&str, &Arc<LoadBalancer<RoundRobin>>) {
        for (name, lb) in &self.entries {
            if path.starts_with(name.as_str()) {
                return (name.as_str(), lb);
            }
        }
        (&self.entries[0].0, &self.entries[0].1)
    }
}
