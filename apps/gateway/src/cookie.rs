//! Cookie 头解析与操作工具（零拷贝 + 零分配，适配网关热路径）

use pingora_http::RequestHeader;

/// Access Token Cookie 名称（与 @auth-sso/contracts `COOKIE_NAMES.JWT` 同步）
pub const ACCESS_COOKIE: &str = "portal_jwt_token";
/// Refresh Token Cookie 名称（与 @auth-sso/contracts `COOKIE_NAMES.REFRESH` 同步）
pub const REFRESH_COOKIE: &str = "portal_refresh_token";

/// 拼合 HTTP/2 多 Cookie 头为单个字符串（兼容 H1/H2）
///
/// 处理 HTTP/2 下多个 `Cookie` 头字段的情况，合并为以 `; ` 分隔的单个字符串。
pub fn collapse_cookie_header(req: &RequestHeader) -> Option<String> {
    let mut result = String::new();
    for cookie_val in req.headers.get_all("cookie").iter() {
        if let Ok(h) = cookie_val.to_str() {
            if !result.is_empty() {
                result.push_str("; ");
            }
            result.push_str(h);
        }
    }
    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}

/// 判定并截取一个 cookie 片段的值：匹配 `name=` 前缀后返回其后的值切片，否则 None
///
/// 统一 `extract_from_header` / `extract_from_set_cookie` / `remove_from_header` /
/// `replace_in_header` 对 "name=" 前缀的匹配逻辑，零分配、无裸索引切片。
fn cookie_value<'a>(seg: &'a str, name: &str) -> Option<&'a str> {
    seg.strip_prefix(name)?.strip_prefix('=')
}

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
/// use gateway::cookie;
/// let header = "portal_jwt_token=abc.def; other=val";
/// assert_eq!(cookie::extract_from_header(header, "portal_jwt_token"), Some("abc.def"));
/// ```
pub fn extract_from_header<'a>(cookie_header: &'a str, name: &str) -> Option<&'a str> {
    cookie_header
        .split(';')
        .find_map(|s| cookie_value(s.trim_start(), name).map(strip_quotes))
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
/// use gateway::cookie;
/// let sc = "portal_jwt_token=eyJ.xxx; Path=/; HttpOnly; Secure; Max-Age=3600";
/// assert_eq!(cookie::extract_from_set_cookie(sc, "portal_jwt_token"), Some("eyJ.xxx"));
/// ```
pub fn extract_from_set_cookie<'a>(set_cookie: &'a str, name: &str) -> Option<&'a str> {
    let first_segment = set_cookie.split(';').next()?.trim_start();
    cookie_value(first_segment, name).map(strip_quotes)
}

/// 剥离 cookie 值两端的双引号（RFC 6265 兼容），零分配
fn strip_quotes(val: &str) -> &str {
    val.strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .unwrap_or(val)
}

/// 从 Cookie 头部中移除指定名称的 cookie
///
/// 采用单次内存分配方式重构，规避中间 Vec 集合分配，提升高并发下的执行效率。
///
/// # 参数
/// * `cookie_header` - 原始 Cookie 头
/// * `cookie_name` - 要移除的 cookie 名称
pub fn remove_from_header(cookie_header: &str, cookie_name: &str) -> String {
    let mut result = String::with_capacity(cookie_header.len());
    let mut first = true;

    for s in cookie_header.split(';') {
        let trimmed = s.trim_start();
        if cookie_value(trimmed, cookie_name).is_some() {
            continue;
        }
        if !first {
            result.push_str("; ");
        }
        result.push_str(trimmed);
        first = false;
    }
    result
}

/// 替换 Cookie 头部中指定 cookie 的值；若不存在则追加
///
/// 采用预估容量的单次内存分配设计，省去 Vec 及各个分段 String 的分配开销。
///
/// # 参数
/// * `cookie_header` - 原始 Cookie 头
/// * `cookie_name` - 要替换的 cookie 名称
/// * `new_value` - 新的 cookie 值
pub fn replace_in_header(cookie_header: &str, cookie_name: &str, new_value: &str) -> String {
    let mut found = false;
    // 预估新 Cookie 串的长度，防止 String 在追加时多次 resize
    let estimated_cap = cookie_header.len() + cookie_name.len() + new_value.len() + 2;
    let mut result = String::with_capacity(estimated_cap);
    let mut first = true;

    for s in cookie_header.split(';') {
        let trimmed = s.trim_start();
        if !first {
            result.push_str("; ");
        }
        if cookie_value(trimmed, cookie_name).is_some() {
            found = true;
            result.push_str(cookie_name);
            result.push('=');
            result.push_str(new_value);
        } else {
            result.push_str(trimmed);
        }
        first = false;
    }

    if !found {
        if !first {
            result.push_str("; ");
        }
        result.push_str(cookie_name);
        result.push('=');
        result.push_str(new_value);
    }
    result
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
