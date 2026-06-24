/**
 * OIDC Discovery 端点 (GET /.well-known/openid-configuration)
 *
 * 返回 OpenID Connect Provider 元数据。
 *
 * @route GET /.well-known/openid-configuration
 */
import { NextResponse } from 'next/server';
import { getAppBaseURL } from '@/lib/env';


export async function GET() {
  const baseURL = getAppBaseURL();

  const metadata = {
    issuer: baseURL,
    authorization_endpoint: `${baseURL}/api/auth/oauth2/authorize`,
    token_endpoint: `${baseURL}/api/auth/oauth2/token`,
    userinfo_endpoint: `${baseURL}/api/auth/oauth2/userinfo`,
    introspection_endpoint: `${baseURL}/api/auth/oauth2/introspect`,
    revocation_endpoint: `${baseURL}/api/auth/oauth2/revoke`,
    jwks_uri: `${baseURL}/api/auth/jwks`,
    // 自定义字段：Cookie-based Token 静默续签端点（非标准 OIDC，供 Gateway 服务端续签使用）
    refresh_endpoint: `${baseURL}/api/auth/refresh`,
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['ES256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256'],
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'name', 'email', 'email_verified', 'picture'],
  };

  return NextResponse.json(metadata);
}
