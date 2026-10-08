/**
 * OIDC Discovery 端点 (GET /.well-known/openid-configuration)
 *
 * 返回 OpenID Connect Provider 元数据。
 *
 * @route GET /.well-known/openid-configuration
 */
import { NextResponse } from 'next/server';
import { getAppBaseURL, getIssuer } from '@/lib/env';
import {
  SCOPES_SUPPORTED,
  RESPONSE_TYPES_SUPPORTED,
  GRANT_TYPES_SUPPORTED,
  SUBJECT_TYPES_SUPPORTED,
  ID_TOKEN_SIGNING_ALG_VALUES_SUPPORTED,
  TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED,
  CODE_CHALLENGE_METHODS_SUPPORTED,
  CLAIMS_SUPPORTED,
} from '@auth-sso/contracts';


export async function GET() {
  const baseURL = getAppBaseURL();

  const metadata = {
    // OIDC Discovery §4.3：issuer 必须与 discovery URL 同源（env 驱动，
    // PORTAL_ISSUER 覆写，默认 NEXT_PUBLIC_APP_URL）。历史值 'auth-sso' 非 URL，
    // 违反规范导致标准 RP 无法接入（audit 2026-09-28），过渡期验签双接受。
    issuer: getIssuer(),
    authorization_endpoint: `${baseURL}/api/auth/oauth2/authorize`,
    token_endpoint: `${baseURL}/api/auth/oauth2/token`,
    userinfo_endpoint: `${baseURL}/api/auth/oauth2/userinfo`,
    introspection_endpoint: `${baseURL}/api/auth/oauth2/introspect`,
    revocation_endpoint: `${baseURL}/api/auth/oauth2/revoke`,
    jwks_uri: `${baseURL}/api/auth/jwks`,
    // OIDC RP-Initiated Logout 1.0：客户端发起登出的端点
    end_session_endpoint: `${baseURL}/api/auth/logout`,
    // 自定义扩展字段（RFC 8414 §2）：非标准 OIDC 元数据必须用带命名空间的名字，
    // 否则会与注册字段名冲突，且外部 RP 会误以为可获得标准的 refresh_token grant
    // 支持——本端点只认 HttpOnly Cookie，第三方客户端照此调用必然失败。
    // 消费方仅 Gateway（jwks.rs 探测，容忍 com_authsso_* 与旧名）。
    com_authsso_refresh_endpoint: `${baseURL}/api/auth/refresh`,
    com_authsso_callback_path: '/api/auth/callback',
    scopes_supported: SCOPES_SUPPORTED,
    response_types_supported: RESPONSE_TYPES_SUPPORTED,
    grant_types_supported: GRANT_TYPES_SUPPORTED,
    subject_types_supported: SUBJECT_TYPES_SUPPORTED,
    id_token_signing_alg_values_supported: ID_TOKEN_SIGNING_ALG_VALUES_SUPPORTED,
    token_endpoint_auth_methods_supported: TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED,
    code_challenge_methods_supported: CODE_CHALLENGE_METHODS_SUPPORTED,
    claims_supported: CLAIMS_SUPPORTED,
    // RFC 9207：authorize 响应携带 iss 参数（mix-up 防御），元数据声明支持
    authorization_response_iss_parameter_supported: true,
  };

  return NextResponse.json(metadata);
}
