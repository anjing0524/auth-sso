/**
 * SCIM 2.0 配置端点骨架 (GET /api/scim)
 *
 * System for Cross-domain Identity Management — 企业 SSO 准入门槛。
 * 当前返回 Service Provider Config，完整实现需对接用户/组 CRUD。
 *
 * @route GET /api/scim/ServiceProviderConfig
 * @route GET /api/scim/Users (待实现)
 * @route GET /api/scim/Groups (待实现)
 */
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: '/docs/scim',
    patch: { supported: false },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{
      type: 'oauthbearertoken',
      name: 'Bearer Token',
      description: '使用 OIDC Access Token 认证',
    }],
  });
}
