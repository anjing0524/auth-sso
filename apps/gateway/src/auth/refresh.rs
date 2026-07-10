//! Token 静默续签，包含 HTTP 调用与 Redis 去重。
//!
//! [`TokenRefresher`] 持有 JWKS 缓存（用于获取 OIDC refresh_endpoint）
//! 和上游地址列表（用于回退），Redis 操作通过 [`crate::redis`] 模块函数完成。

use std::sync::Arc;

use tracing::{debug, info, warn};

use crate::config::Upstreams;
use crate::cookie;
use crate::http::HTTP_CLIENT;
use crate::jwks::JwksCache;

use super::RefreshedTokens;

/// 同用户续签去重窗口（秒），防止并发请求反复轮换 Refresh Token
const REFRESH_DEDUP_SEC: u64 = 30;

/// Redis 续签去重 key 前缀
const REFRESH_DEDUP_PREFIX: &str = "portal:refresh_dedup:";

/// Token 静默续签器。
///
/// 先尝试 OIDC Discovery 缓存的主端点，失败后遍历全部 upstream 逐一回退。
/// 通过 Redis 实现 30s 跨实例去重。
#[derive(Debug)]
pub struct TokenRefresher {
    jwks_cache: Arc<JwksCache>,
    upstreams: Arc<Upstreams>,
}

impl TokenRefresher {
    pub fn new(jwks_cache: Arc<JwksCache>, upstreams: Arc<Upstreams>) -> Self {
        Self {
            jwks_cache,
            upstreams,
        }
    }

    /// 向 Portal 发起 Access Token 静默续签。
    ///
    /// 返回 `Some(RefreshedTokens)` 或 `None`（续签失败不阻断请求，旧 AT 仍有效）。
    ///
    /// # Examples
    ///
    /// ```ignore
    /// # use std::sync::Arc;
    /// # use gateway::jwks::JwksCache;
    /// # use gateway::config::Upstreams;
    /// # use gateway::auth::TokenRefresher;
    /// let cache = Arc::new(JwksCache::new());
    /// let ups = Arc::new(Upstreams::from_config("127.0.0.1:4100"));
    /// let refresher = TokenRefresher::new(cache, ups);
    /// // 服务未启动时续签返回 None
    /// // let tokens = refresher.try_refresh("rt_value", "user-1").await;
    /// ```
    pub async fn try_refresh(&self, refresh_token: &str, sub: &str) -> Option<RefreshedTokens> {
        // 1. Redis 去重检查（30s 窗口，跨实例共享）
        //
        // 去重缓存仅存标记（sub 的 SHA-256），不存 token 明文，避免 Redis 内
        // 出现可用 token 的泄露面。命中标记的并发请求放弃续签（旧 AT 仍有效，
        // 下次请求会再试，多数场景能自愈）。
        if self.check_dedup(sub).await {
            debug!("续签去重命中 (Redis): sub={}", sub);
            return None;
        }

        // 2. 尝试主端点（来自 OIDC Discovery 缓存）
        if let Some(primary) = self.primary_endpoint()
            && let Some(tokens) = self.try_endpoint(&primary, refresh_token, sub).await
        {
            self.set_dedup(sub).await;
            return Some(tokens);
        }

        // 3. 回退：遍历全部 upstream 的默认续签路径
        if self.upstreams.is_empty() {
            warn!(
                "无法续签: OIDC 元数据未就绪且未配置任何 upstream，放弃续签 sub={}",
                sub
            );
            crate::metrics::inc_refresh_failure();
            return None;
        }

        for upstream in self.upstreams.iter() {
            let fallback_url = format!("http://{}/api/auth/refresh", upstream);
            if let Some(tokens) = self.try_endpoint(&fallback_url, refresh_token, sub).await {
                self.set_dedup(sub).await;
                return Some(tokens);
            }
        }

        crate::metrics::inc_refresh_failure();
        None
    }

    /// OIDC Discovery 缓存中的主续签端点 URL
    fn primary_endpoint(&self) -> Option<Arc<str>> {
        self.jwks_cache.refresh_endpoint()
    }

    /// 向指定续签端点发起 POST 请求，从响应 Set-Cookie 中提取新 Token 对
    async fn try_endpoint(
        &self,
        endpoint: &str,
        refresh_token: &str,
        sub: &str,
    ) -> Option<RefreshedTokens> {
        debug!("发起静默续签: url={}, sub={}", endpoint, sub);
        let response = HTTP_CLIENT
            .post(endpoint)
            .header(
                "Cookie",
                format!("{}={}", cookie::REFRESH_COOKIE, refresh_token),
            )
            .send()
            .await;

        match response {
            Ok(resp) if resp.status().is_success() => {
                let mut new_at = None;
                let mut new_rt = None;

                for header_value in resp.headers().get_all("set-cookie").iter() {
                    if let Ok(cookie_str) = header_value.to_str() {
                        if let Some(val) =
                            cookie::extract_from_set_cookie(cookie_str, cookie::ACCESS_COOKIE)
                        {
                            new_at = Some(val.to_string());
                        }
                        if let Some(val) =
                            cookie::extract_from_set_cookie(cookie_str, cookie::REFRESH_COOKIE)
                        {
                            new_rt = Some(val.to_string());
                        }
                    }
                }

                match (new_at, new_rt) {
                    (Some(access), Some(refresh)) => {
                        info!("静默续签成功: sub={}", sub);
                        crate::metrics::inc_refresh_success();
                        Some(RefreshedTokens { access, refresh })
                    }
                    _ => {
                        warn!("续签响应缺少预期的 Set-Cookie 头: sub={}", sub);
                        None
                    }
                }
            }
            Ok(resp) => {
                warn!(
                    "续签请求被 Portal 拒绝: status={}, sub={}",
                    resp.status(),
                    sub
                );
                None
            }
            Err(e) => {
                warn!("续签请求网络错误: {}, sub={}", e, sub);
                None
            }
        }
    }

    /// Redis 续签去重：检查 30s 窗口内同用户是否已有续签进行中
    ///
    /// 返回 true 表示已有续签在窗口内完成（应跳过本次续签）。
    async fn check_dedup(&self, sub: &str) -> bool {
        let key = format!("{}{}", REFRESH_DEDUP_PREFIX, sub);
        crate::redis::get(&key).await.is_some()
    }

    /// Redis 续签去重：写入标记（SET NX EX，原子去重 + 自动过期）
    ///
    /// 仅存固定标记值 "1"，不包含任何 token 明文，消除 Redis 中的 token 泄露面。
    async fn set_dedup(&self, sub: &str) {
        let key = format!("{}{}", REFRESH_DEDUP_PREFIX, sub);
        crate::redis::set_nx_ex(&key, "1", REFRESH_DEDUP_SEC).await;
    }
}
