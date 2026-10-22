/**
 * OAuth 端点请求体解析 (OAuth Endpoint Body Parsing)
 *
 * RFC 6749 §2.3 / RFC 7662 §2.1 / RFC 7009 §2.1 规定 token / introspect /
 * revoke 端点必须接受 `application/x-www-form-urlencoded`。
 *
 * 为兼容标准客户端（默认发 form 编码）与既有内部调用（发 JSON），
 * 本 helper 优先尝试 JSON，失败则回退 form 解析，统一输出扁平键值对象。
 *
 * @module lib/auth/oauth-body
 */

/**
 * 解析 OAuth 端点请求体，兼容 JSON 与 form-urlencoded
 *
 * @param request NextRequest 实例
 * @returns 扁平化的键值对象（值统一转为 string，符合 OAuth 表单语义）
 */
export async function parseOAuthBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') || '';

  // form-urlencoded：按 Content-Type 直接走 form 解析（标准 OAuth 客户端）
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return parseFormData(await request.formData());
  }

  // JSON 或未声明：尝试 JSON 解析，失败则回退 form
  try {
    const text = await request.text();
    if (!text) return {};
    // 尝试 JSON
    try {
      const json = JSON.parse(text);
      return flattenToStringRecord(json);
    } catch {
      // 非 JSON，尝试按 form 解析
      const params = new URLSearchParams(text);
      const result: Record<string, string> = {};
      params.forEach((value, key) => { result[key] = value; });
      return result;
    }
  } catch {
    return {};
  }
}

/** 将 FormData 转为扁平 string 记录 */
function parseFormData(formData: FormData): Record<string, string> {
  const result: Record<string, string> = {};
  formData.forEach((value, key) => {
    result[key] = typeof value === 'string' ? value : String(value);
  });
  return result;
}

/** 将 JSON 对象的标量值转为 string 记录（跳过嵌套对象/数组） */
function flattenToStringRecord(json: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      result[key] = typeof value === 'string' ? value : String(value);
    }
  }
  return result;
}
