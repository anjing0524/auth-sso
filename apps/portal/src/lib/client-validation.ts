/**
 * OAuth 客户端基础字段的前端校验（创建页与详情编辑共用）。
 *
 * 与服务端 Zod 同口径的快速反馈；只做“形状”校验，不复制服务端业务规则。
 */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export interface ClientBasicsInput {
  name: string;
  redirectUris: string;
  logoUrl?: string;
}

export interface ClientBasicsErrors {
  name?: string;
  redirectUris?: string;
  logoUrl?: string;
}

export function validateClientBasics(input: ClientBasicsInput): ClientBasicsErrors {
  const errors: ClientBasicsErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = '应用名称不能为空';
  else if (name.length > 100) errors.name = '应用名称最多 100 个字符';

  const uris = input.redirectUris.split('\n').map((u) => u.trim()).filter(Boolean);
  if (uris.length === 0) {
    errors.redirectUris = '至少需要一个回调地址';
  } else {
    const invalid = uris.find((u) => !isHttpUrl(u) || u.length > 500);
    if (invalid) errors.redirectUris = `回调地址格式不合法：${invalid.slice(0, 80)}`;
  }

  const logo = (input.logoUrl ?? '').trim();
  if (logo && (!isHttpUrl(logo) || logo.length > 500)) {
    errors.logoUrl = 'Logo 地址必须是合法的 http(s) URL';
  }

  return errors;
}
