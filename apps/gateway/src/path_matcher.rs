use std::collections::HashSet;

/// 路径分类结果 — 一次分类，贯穿 request_filter 与 upstream_request_filter
///
/// 判定优先级自上而下：Static → Public → Microservice → Protected。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PathClass {
    /// 受保护业务路径：需验签，上行仅剥离 RT Cookie（默认，最安全假设）
    #[default]
    Protected,
    /// 静态资源目录（`/_next/`、`/static/`）：跳过限流与验签
    Static,
    /// 白名单公开路径（含静态资源扩展名）：跳过验签，但可能仍走限流
    Public,
    /// 内网微服务路由（`/api/v1/...`，排除 `/api/v1/auth/`）：需验签，上行剥离全部 Cookie
    Microservice,
}

/// 预分类和高性能过滤的公开路径匹配器
///
/// 将白名单中的路径分为精确匹配（O(1)）和前缀匹配两类，
/// 结合静态资源放行规则，在网关热路径上实现低延迟路径分类。
#[derive(Debug, Clone, PartialEq, Eq)]
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

    /// 校验当前请求路径是否放行（无需 JWT 验签）
    ///
    /// 检查顺序：静态资源 → 文件扩展名 → 精确匹配 → 前缀匹配
    fn is_public(&self, path: &str) -> bool {
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
            if !ext.contains('/')
                && STATIC_EXTENSIONS
                    .iter()
                    .any(|&static_ext| ext.eq_ignore_ascii_case(static_ext))
            {
                return true;
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

    /// 对请求路径做一次完整分类，供请求生命周期各阶段复用。
    ///
    /// 取代原先在 request_filter / upstream_request_filter 中
    /// 反复 `starts_with` 与重复 `is_public` 的散点判断。
    pub fn classify(&self, path: &str) -> PathClass {
        // 1. 静态资源目录优先：需跳过限流
        if path.starts_with("/_next/") || path.starts_with("/static/") {
            return PathClass::Static;
        }
        // 2. 白名单 / 静态扩展名：跳过验签
        if self.is_public(path) {
            return PathClass::Public;
        }
        // 3. 内网微服务路由：上行需剥离全部 Cookie
        if is_microservice_route(path) {
            return PathClass::Microservice;
        }
        // 4. 其余为受保护业务路径
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

        // 静态目录资产放行
        assert!(matcher.is_public("/_next/static/chunks/main.js"));
        assert!(matcher.is_public("/static/images/logo.png"));

        // 静态资源文件扩展名放行
        assert!(matcher.is_public("/favicon.ico"));
        assert!(matcher.is_public("/logo.PNG")); // 测试大小写不敏感
        assert!(matcher.is_public("/robots.txt"));
        assert!(matcher.is_public("/site.webmanifest.json"));

        // 公开页面和认证接口放行 (前缀或精确相等)
        assert!(matcher.is_public("/login"));
        assert!(matcher.is_public("/register"));
        assert!(matcher.is_public("/error"));
        assert!(matcher.is_public("/"));
        assert!(matcher.is_public("/api/auth/session"));
        assert!(matcher.is_public("/oauth2/authorize"));
        assert!(matcher.is_public("/.well-known/jwks.json"));

        // 受保护的管理页面和路由应该拦截 (返回 false)
        assert!(!matcher.is_public("/dashboard"));
        assert!(!matcher.is_public("/dashboard/users"));
        assert!(!matcher.is_public("/profile"));
        assert!(!matcher.is_public("/api/v1/users"));
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
