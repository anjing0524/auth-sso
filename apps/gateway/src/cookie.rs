/// Cookie 头解析与操作工具（零拷贝 + 零分配，适配网关热路径）
///
/// 所有提取函数返回的字符串切片引用自原始 Cookie 头部，避免不必要的内存分配。
///
/// # Cookie 名称约定（与 @auth-sso/contracts 保持同步）
///
/// | 本模块使用 | @auth-sso/contracts 常量 | 说明 |
/// |-----------|-------------------------|------|
/// | `portal_jwt_token` | `COOKIE_NAMES.JWT` | Access Token Cookie |
/// | `portal_refresh_token` | `COOKIE_NAMES.REFRESH` | Refresh Token Cookie |
///
/// ⚠️ 修改 Cookie 名称时，必须同步更新 `packages/contracts/src/index.ts` 中的
/// `COOKIE_NAMES` 常量和本模块中的字符串字面量。
/// 从请求 Cookie 头部中提取指定名称的 cookie 值（零拷贝）
///
/// 容错处理双引号包裹的值（RFC 6265 兼容）。
/// 统一了原先 `extract_token_from_cookie` 和 `extract_refresh_token_from_cookie`
/// 的重复实现。
///
/// # 参数
/// * `cookie_header` - 原始的 Cookie 请求头字符串
/// * `name` - 要提取的 cookie 名称（如 "portal_jwt_token"）
///
/// # 示例
/// ```
/// let header = "portal_jwt_token=abc.def; other=val";
/// assert_eq!(cookie::extract_from_header(header, "portal_jwt_token"), Some("abc.def"));
/// ```
pub fn extract_from_header<'a>(cookie_header: &'a str, name: &str) -> Option<&'a str> {
    cookie_header.split(';').find_map(|cookie_str| {
        let trimmed = cookie_str.trim_start();
        // 零分配：strip_prefix 两次 — 先匹配名称，再剥离 '='
        let val = trimmed.strip_prefix(name)?.strip_prefix('=')?;
        Some(val.strip_prefix('"').and_then(|v| v.strip_suffix('"')).unwrap_or(val))
    })
}

/// 从 Set-Cookie 响应头中提取指定 cookie 的值（仅匹配首个分号前的 name=value 段）
///
/// 与 `extract_from_header` 不同，Set-Cookie 头中 `;` 之后是属性（Path、HttpOnly 等），
/// 因此只解析第一个分号前的部分。
///
/// # 参数
/// * `set_cookie` - Set-Cookie 响应头值
/// * `name` - cookie 名称
///
/// # 示例
/// ```
/// let sc = "portal_jwt_token=eyJ.xxx; Path=/; HttpOnly; Secure; Max-Age=3600";
/// assert_eq!(cookie::extract_from_set_cookie(sc, "portal_jwt_token"), Some("eyJ.xxx"));
/// ```
pub fn extract_from_set_cookie<'a>(set_cookie: &'a str, name: &str) -> Option<&'a str> {
    let first_segment = set_cookie.split(';').next()?;
    let val = first_segment.trim_start().strip_prefix(name)?.strip_prefix('=')?;
    Some(val.strip_prefix('"').and_then(|v| v.strip_suffix('"')).unwrap_or(val))
}

/// 从 Cookie 头部中移除指定名称的 cookie
///
/// 用于在上行请求中剥离不应透传给 Portal 的 cookie（如 refresh_token）。
///
/// # 参数
/// * `cookie_header` - 原始 Cookie 头
/// * `cookie_name` - 要移除的 cookie 名称
pub fn remove_from_header(cookie_header: &str, cookie_name: &str) -> String {
    cookie_header
        .split(';')
        .filter_map(|s| {
            let trimmed = s.trim_start();
            if trimmed.starts_with(cookie_name) && trimmed[cookie_name.len()..].starts_with('=') {
                None
            } else {
                Some(trimmed)
            }
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// 替换 Cookie 头部中指定 cookie 的值；若不存在则追加
///
/// 用于续签成功后更新上行请求中的 portal_jwt_token。
///
/// # 参数
/// * `cookie_header` - 原始 Cookie 头
/// * `cookie_name` - 要替换的 cookie 名称
/// * `new_value` - 新的 cookie 值
pub fn replace_in_header(cookie_header: &str, cookie_name: &str, new_value: &str) -> String {
    let mut found = false;
    let mut parts: Vec<String> = cookie_header
        .split(';')
        .map(|s| {
            let trimmed = s.trim_start();
            if trimmed.starts_with(cookie_name) && trimmed[cookie_name.len()..].starts_with('=') {
                found = true;
                format!("{}={}", cookie_name, new_value)
            } else {
                trimmed.to_string()
            }
        })
        .collect();

    if !found {
        parts.push(format!("{}={}", cookie_name, new_value));
    }
    parts.join("; ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_from_header_basic() {
        let header = "portal_jwt_token=abc.def; portal_refresh_token=rrr.ttt; other=val";
        assert_eq!(
            extract_from_header(header, "portal_jwt_token"),
            Some("abc.def")
        );
        assert_eq!(
            extract_from_header(header, "portal_refresh_token"),
            Some("rrr.ttt")
        );
    }

    #[test]
    fn test_extract_from_header_quoted() {
        // 带双引号包裹（RFC 6265 兼容）
        assert_eq!(
            extract_from_header("portal_refresh_token=\"simple\"", "portal_refresh_token"),
            Some("simple")
        );
    }

    #[test]
    fn test_extract_from_header_missing() {
        assert_eq!(
            extract_from_header("portal_jwt_token=abc; other=val", "portal_refresh_token"),
            None
        );
        assert_eq!(extract_from_header("", "portal_jwt_token"), None);
    }

    #[test]
    fn test_extract_from_set_cookie_basic() {
        let set_cookie =
            "portal_jwt_token=eyJ.xxx; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600";
        assert_eq!(
            extract_from_set_cookie(set_cookie, "portal_jwt_token"),
            Some("eyJ.xxx")
        );
        assert_eq!(
            extract_from_set_cookie(set_cookie, "portal_refresh_token"),
            None
        );
    }

    #[test]
    fn test_remove_from_header() {
        let header = "portal_jwt_token=abc; portal_refresh_token=rrr; other=val";
        let result = remove_from_header(header, "portal_refresh_token");
        assert!(result.contains("portal_jwt_token=abc"));
        assert!(result.contains("other=val"));
        assert!(!result.contains("portal_refresh_token"));
    }

    #[test]
    fn test_replace_in_header_existing() {
        let header = "portal_jwt_token=old; portal_refresh_token=rrr";
        let result = replace_in_header(header, "portal_jwt_token", "new");
        assert!(result.contains("portal_jwt_token=new"));
        assert!(!result.contains("portal_jwt_token=old"));
        assert!(result.contains("portal_refresh_token=rrr"));
    }

    #[test]
    fn test_replace_in_header_append() {
        let header = "portal_refresh_token=rrr";
        let result = replace_in_header(header, "portal_jwt_token", "new");
        assert!(result.contains("portal_jwt_token=new"));
        assert!(result.contains("portal_refresh_token=rrr"));
    }
}
