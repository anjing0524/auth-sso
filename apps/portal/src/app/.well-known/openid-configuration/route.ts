/**
 * OIDC Discovery 端点 (GET /.well-known/openid-configuration)
 *
 * 返回 OpenID Connect Provider 元数据。
 *
 * @route GET /.well-known/openid-configuration
 */
import { NextResponse } from 'next/server';
import { getAppBaseURL } from '@/lib/env';
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
    // ADR-006：issuer 是体系级固定标识，与所有 JWT 签发/验签保持一致。
    issuer: 'auth-sso',
    authorization_endpoint: `${baseURL}/api/auth/oauth2/authorize`,
    token_endpoint: `${baseURL}/api/auth/oauth2/token`,
    userinfo_endpoint: `${baseURL}/api/auth/oauth2/userinfo`,
    introspection_endpoint: `${baseURL}/api/auth/oauth2/introspect`,
    revocation_endpoint: `${baseURL}/api/auth/oauth2/revoke`,
    jwks_uri: `${baseURL}/api/auth/jwks`,
    // OIDC RP-Initiated Logout 1.0：客户端发起登出的端点
    end_session_endpoint: `${baseURL}/api/auth/logout`,
    // 自定义字段：Cookie-based Token 静默续签端点（非标准 OIDC，供 Gateway 服务端续签使用）
    refresh_endpoint: `${baseURL}/api/auth/refresh`,
    // 自定义字段：Gateway 拦截 OAuth callback 的路径（非标准 OIDC，供 Gateway 动态发现）
    oauth_callback_path: '/api/auth/callback',
    scopes_supported: SCOPES_SUPPORTED,
    response_types_supported: RESPONSE_TYPES_SUPPORTED,
    grant_types_supported: GRANT_TYPES_SUPPORTED,
    subject_types_supported: SUBJECT_TYPES_SUPPORTED,
    id_token_signing_alg_values_supported: ID_TOKEN_SIGNING_ALG_VALUES_SUPPORTED,
    token_endpoint_auth_methods_supported: TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED,
    code_challenge_methods_supported: CODE_CHALLENGE_METHODS_SUPPORTED,
    claims_supported: CLAIMS_SUPPORTED,
  };

  return NextResponse.json(metadata);
}
