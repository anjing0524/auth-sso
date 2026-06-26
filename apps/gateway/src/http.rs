use std::sync::LazyLock;
use std::time::Duration;

/// 全局 HTTP 客户端单例（reqwest::Client 内置连接池，应全局复用而非每次创建）
///
/// 供 `jwks` 和 `auth` 模块共享，统一超时策略。
pub static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("❌ 全局 HTTP 客户端初始化失败")
});
