/**
 * OAuth 错误页自助指引映射（PM-03）— 纯函数测试
 *
 * @req PM-03
 */
import { describe, it, expect } from 'vitest';
import { AUTH_ERRORS, COMMON_ERRORS } from '@auth-sso/contracts';
import { resolveErrorGuidance } from '@/app/oauth/error/error-guidance';

describe('resolveErrorGuidance（PM-03）', () => {
  it('AUTH_SSO_2033：给出规范入口 + 登记白名单两步指引', () => {
    const guidance = resolveErrorGuidance(AUTH_ERRORS.OAUTH_INVALID_REDIRECT_URI);

    expect(guidance.summary).toContain('回调地址');
    expect(guidance.selfHelp).toHaveLength(2);
    expect(guidance.selfHelp[0]).toContain('规范入口');
    expect(guidance.selfHelp[1]).toContain('白名单');
  });

  it('authorize 路由内联短码（session_expired / invalid_request）有针对性指引', () => {
    expect(resolveErrorGuidance('session_expired').summary).toContain('过期');
    expect(resolveErrorGuidance('invalid_request').summary).toContain('参数');
  });

  it('高频 AUTH_SSO 码：INVALID_CLIENT / INVALID_SCOPE / FORBIDDEN 均命中映射', () => {
    expect(resolveErrorGuidance(AUTH_ERRORS.INVALID_CLIENT).summary).toContain('应用');
    expect(resolveErrorGuidance(AUTH_ERRORS.INVALID_SCOPE).summary).toContain('授权范围');
    expect(resolveErrorGuidance(COMMON_ERRORS.FORBIDDEN).summary).toContain('无权访问');
  });

  it('unauthorized_client（页面既有分支）保留语义', () => {
    expect(resolveErrorGuidance('unauthorized_client').summary).toContain('无权访问');
    expect(resolveErrorGuidance('unauthorized_client').selfHelp[0]).toContain('管理员');
  });

  it('未知错误码与缺失错误码走通用兜底，不向用户暴露内部指代', () => {
    for (const input of [null, undefined, '', 'AUTH_SSO_9999', 'weird_code']) {
      const guidance = resolveErrorGuidance(input);
      expect(guidance.summary).toBe('授权流程中断');
      expect(guidance.selfHelp.length).toBeGreaterThan(0);
    }
  });

  it('指引文案不包含租户内部渠道硬编码（飞书/企业微信/@IT）', () => {
    const all = [
      AUTH_ERRORS.OAUTH_INVALID_REDIRECT_URI,
      AUTH_ERRORS.INVALID_CLIENT,
      AUTH_ERRORS.INVALID_SCOPE,
      COMMON_ERRORS.FORBIDDEN,
      'session_expired',
      'invalid_request',
      'unauthorized_client',
      'unknown_code',
    ].flatMap((code) => {
      const g = resolveErrorGuidance(code);
      return [g.summary, ...g.selfHelp];
    });

    for (const text of all) {
      expect(text).not.toMatch(/飞书|企业微信|@IT/);
    }
  });
});
