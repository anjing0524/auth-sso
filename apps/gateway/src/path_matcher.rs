use std::collections::HashSet;

/// 路径分类结果 — 一次分类，贯穿 request_filter 与 upstream_request_filter
///
/// 判定优先级自上而下：Static → 显式白名单(Public) → Microservice
/// → 非 `/api/` 扩展名(Public) → Protected。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PathClass {
    /// 受保护业务路径：需验签，上行仅剥离 RT Cookie（默认，最安全假设）
    #[default]
    Protected,
    /// 静态资源目录（`/_next/`、`/static/`）：跳过限流与验签
    Static,
    /// 白名单公开路径（含非 `/api/` 的静态资源扩展名）：跳过验签，但可能仍走限流
    Public,
    /// 内网微服务路由（`/api/v1/...`，排除 `/api/v1/auth/`）：需验签，上行剥离全部 Cookie
    Microservice,
}

/// 预分类和高性能过滤的公开路径匹配器
///
/// 将白名单中的路径分为精确匹配（O(1)）和前缀匹配两类，
/// 结合静态资源放行规则，在网关热路径上实现低延迟路径分类。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PathMatcher {
    /// 精确匹配路径集合（如 "/login"、"/"）
    public_exact_paths: HashSet<String>,
    /// 前缀匹配路径列表，按长度降序排列以尽早触及深度路径
    public_prefix_paths: Vec<String>,
}

/// 判断请求路径是否发往内网后端微服务
///
/// 规则：以 /api/v1/ 开头且排除 /api/v1/auth/ 登录校验类接口
fn is_microservice_route(path: &str) -> bool {
    path.starts_with("/api/v1/") && !path.starts_with("/api/v1/auth/")
}

/// 长度分桶 + 栈上小写化的静态扩展名判定（≤5 字节，无堆分配）
fn is_static_ext(ext: &str) -> bool {
    if ext.len() > 5 || ext.is_empty() {
        return false;
    }
    let mut buf = [0u8; 5];
    let lower = &mut buf[..ext.len()];
    lower.copy_from_slice(ext.as_bytes());
    lower.make_ascii_lowercase();
    matches!(
        &*lower,
        b"js"
            | b"css"
            | b"ico"
            | b"png"
            | b"jpg"
            | b"gif"
            | b"svg"
            | b"ttf"
            | b"txt"
            | b"json"
            | b"jpeg"
            | b"woff"
    ) || &*lower == b"woff2"
}

/// 非 /api/ 路径的静态资产扩展名放行（零信任收窄：API 命名空间禁止扩展名旁路）
fn is_asset_path(path: &str) -> bool {
    if path.starts_with("/api/") {
        return false;
    }
    match path.rfind('.') {
        Some(idx) => {
            let ext = &path[idx + 1..];
            !ext.contains('/') && is_static_ext(ext)
        }
        None => false,
    }
}

impl PathMatcher {
    /// 初始化并对白名单进行分类与高性能前缀排序
    ///
    /// # 参数
    /// * `public_paths` - 配置的白名单路径列表，以 `/` 结尾的视为前缀匹配
    pub fn new(public_paths: Vec<String>) -> Self {
        let mut exact_paths = HashSet::new();
        let mut prefix_paths = Vec::new();
        for path in public_paths {
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

    /// 显式白名单命中（exact O(1) + prefix 降序扫描）
    fn is_whitelisted(&self, path: &str) -> bool {
        if self.public_exact_paths.contains(path) {
            return true;
        }
        self.public_prefix_paths.iter().any(|p| path.starts_with(p))
    }

    /// 对请求路径做一次完整分类，供请求生命周期各阶段复用。
    ///
    /// 分类优先级（自上而下互斥，首个命中即返回）：
    /// 1. `Static` —— 静态资源目录 `/static/`、`/_next/`（跳过限流与验签）
    /// 2. `Public`（显式白名单）—— 配置的 exact/prefix 白名单路径（跳过验签）
    /// 3. `Microservice` —— 内网微服务路由 `/api/v1/...`（需验签，上行剥离全部 Cookie）
    /// 4. `Public`（扩展名资产）—— 非 `/api/` 路径的静态资源扩展名（跳过验签）
    /// 5. `Protected` —— 其余路径均视为受保护业务路径（默认，最安全假设）
    ///
    /// # 优先级说明
    /// - 显式白名单**先于** `is_microservice_route()`：
    ///   如果 `/api/v1/auth/*` 被加入白名单，它以 Public 通过，不会进入 Microservice 分支。
    /// - 扩展名放行**后于** `Microservice` 且对 `/api/` 命名空间整体禁用：
    ///   `/api/v1/reports/2024.json` 归类 Microservice（需验签），
    ///   `/api/reports.json` 归类 Protected（需验签），杜绝扩展名鉴权旁路。
    ///
    /// # Examples
    ///
    /// ```
    /// # use gateway::path_matcher::{PathMatcher, PathClass};
    /// let m = PathMatcher::new(vec!["/login".into(), "/api/auth/".into()]);
    /// assert_eq!(m.classify("/login"), PathClass::Public);
    /// assert_eq!(m.classify("/dashboard"), PathClass::Protected);
    /// ```
    pub fn classify(&self, path: &str) -> PathClass {
        if path.starts_with("/_next/") || path.starts_with("/static/") {
            return PathClass::Static;
        }
        if self.is_whitelisted(path) {
            return PathClass::Public;
        }
        if is_microservice_route(path) {
            return PathClass::Microservice;
        }
        if is_asset_path(path) {
            return PathClass::Public;
        }
        PathClass::Protected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_public_asset_or_route() {
        let public_paths = vec![
            "/login".to_string(),
            "/register".to_string(),
            "/error".to_string(),
            "/".to_string(),
            "/api/auth/".to_string(),
            "/oauth2/".to_string(),
            "/.well-known/".to_string(),
        ];
        let matcher = PathMatcher::new(public_paths);

        // 静态目录资产
        assert_eq!(
            matcher.classify("/_next/static/chunks/main.js"),
            PathClass::Static
        );
        assert_eq!(
            matcher.classify("/static/images/logo.png"),
            PathClass::Static
        );

        // 静态资源文件扩展名放行（非 /api/ 路径）
        assert_eq!(matcher.classify("/favicon.ico"), PathClass::Public);
        assert_eq!(matcher.classify("/logo.PNG"), PathClass::Public); // 大小写不敏感
        assert_eq!(matcher.classify("/robots.txt"), PathClass::Public);
        assert_eq!(
            matcher.classify("/site.webmanifest.json"),
            PathClass::Public
        );

        // 公开页面和认证接口放行 (前缀或精确相等)
        assert_eq!(matcher.classify("/login"), PathClass::Public);
        assert_eq!(matcher.classify("/register"), PathClass::Public);
        assert_eq!(matcher.classify("/error"), PathClass::Public);
        assert_eq!(matcher.classify("/"), PathClass::Public);
        assert_eq!(matcher.classify("/api/auth/session"), PathClass::Public);
        assert_eq!(matcher.classify("/oauth2/authorize"), PathClass::Public);
        assert_eq!(
            matcher.classify("/.well-known/jwks.json"),
            PathClass::Public
        );

        // 受保护的管理页面和路由应该拦截
        assert_eq!(matcher.classify("/dashboard"), PathClass::Protected);
        assert_eq!(matcher.classify("/dashboard/users"), PathClass::Protected);
        assert_eq!(matcher.classify("/profile"), PathClass::Protected);
        assert_eq!(matcher.classify("/api/v1/users"), PathClass::Microservice);
    }

    #[test]
    fn test_classify() {
        let matcher = PathMatcher::new(vec![
            "/login".to_string(),
            "/".to_string(),
            "/api/auth/".to_string(),
        ]);

        // 静态资源目录
        assert_eq!(matcher.classify("/_next/static/main.js"), PathClass::Static);
        assert_eq!(matcher.classify("/static/logo.png"), PathClass::Static);

        // 白名单页面与认证接口（含扩展名资产）
        assert_eq!(matcher.classify("/login"), PathClass::Public);
        assert_eq!(matcher.classify("/"), PathClass::Public);
        assert_eq!(matcher.classify("/api/auth/session"), PathClass::Public);
        assert_eq!(matcher.classify("/favicon.ico"), PathClass::Public);

        // 内网微服务路由
        assert_eq!(matcher.classify("/api/v1/users"), PathClass::Microservice);
        assert_eq!(
            matcher.classify("/api/v1/products/123"),
            PathClass::Microservice
        );

        // 受保护业务路径
        assert_eq!(matcher.classify("/dashboard"), PathClass::Protected);
        assert_eq!(matcher.classify("/profile"), PathClass::Protected);
    }

    /// B1 回归：扩展名放行不得穿透 /api/ 命名空间的鉴权
    #[test]
    fn test_classify_api_extension_no_bypass() {
        let matcher = PathMatcher::new(vec![
            "/login".to_string(),
            "/".to_string(),
            "/api/auth/".to_string(),
        ]);

        // /api/v1/**.json → Microservice（需验签，不再被扩展名放行）
        assert_eq!(
            matcher.classify("/api/v1/reports/2024.json"),
            PathClass::Microservice
        );
        // /api/**.json（非 v1）→ Protected（需验签）
        assert_eq!(matcher.classify("/api/reports.json"), PathClass::Protected);
        // 非 /api/ 的静态资产照常放行（含大小写）
        assert_eq!(matcher.classify("/logo.png"), PathClass::Public);
        assert_eq!(matcher.classify("/logo.PNG"), PathClass::Public);
    }

    #[test]
    fn test_is_static_ext() {
        assert!(is_static_ext("js"));
        assert!(is_static_ext("JSON"));
        assert!(is_static_ext("woff2"));
        assert!(is_static_ext("WOFF2"));
        assert!(!is_static_ext(""));
        assert!(!is_static_ext("html"));
        assert!(!is_static_ext("toolong"));
    }

    #[test]
    fn test_is_asset_path() {
        assert!(is_asset_path("/favicon.ico"));
        assert!(is_asset_path("/assets/logo.svg"));
        // /api/ 命名空间整体禁止扩展名旁路
        assert!(!is_asset_path("/api/data.json"));
        assert!(!is_asset_path("/api/v1/x.png"));
        // 点号后含 / 不是扩展名
        assert!(!is_asset_path("/v1.2/path"));
        assert!(!is_asset_path("/no-extension"));
    }

    #[test]
    fn test_is_microservice_route() {
        assert!(is_microservice_route("/api/v1/users"));
        assert!(is_microservice_route("/api/v1/products/123"));
        assert!(!is_microservice_route("/api/auth/session"));
        assert!(!is_microservice_route("/api/v1/auth/login"));
        assert!(!is_microservice_route("/dashboard"));
        assert!(!is_microservice_route("/_next/data/xxx.json"));
    }
}
