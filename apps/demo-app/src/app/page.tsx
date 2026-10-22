import { headers } from 'next/headers';
import { getUserPermissions } from '@/lib/permissions';

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || 'http://localhost:18443';

export default async function HomePage() {
  const headersList = await headers();
  const userId = headersList.get('x-user-id');

  if (!userId) {
    return (
      <div style={{ textAlign: 'center', marginTop: 120 }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Demo App</h1>
        <p style={{ color: '#666', marginBottom: 32 }}>Gateway 代理模式 — 哑服务</p>
        <a
          href={`${PORTAL_URL}/login`}
          style={{
            display: 'inline-block', padding: '12px 32px', fontSize: 16,
            background: '#1a1a2e', color: '#fff', border: 'none',
            borderRadius: 8, textDecoration: 'none',
          }}
        >
          通过 Portal 登录
        </a>
        <p style={{ color: '#999', fontSize: 13, marginTop: 24 }}>
          预期流程：未登录 → Gateway 302 到 Portal → 登录 → 返回本页（Gateway 注入 X-User-Id）
        </p>
      </div>
    );
  }

  const ctx = await getUserPermissions(userId);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Demo App — 已认证</h2>

      <div style={{ background: '#f0f9ff', borderRadius: 8, padding: 16, marginBottom: 24, border: '1px solid #bae6fd' }}>
        <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
          <tbody>
            <tr><td style={{ padding: '4px 8px', color: '#666', width: 140 }}>X-User-Id</td>
              <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{userId}</td></tr>
            <tr><td style={{ padding: '4px 8px', color: '#666' }}>Authorization</td>
              <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: 12 }}>
                {headersList.get('authorization')?.substring(0, 60) || '(无)'}...</td></tr>
          </tbody>
        </table>
      </div>

      {ctx ? (
        <div style={{ background: '#fff', borderRadius: 8, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h4 style={{ margin: '0 0 12px 0' }}>Redis 权限 (portal:user_perms:{`{${userId}}`})</h4>
          <p style={{ color: '#16a34a', fontSize: 13 }}>角色: {ctx.roles.map(r => r.name).join(', ') || '无'}</p>
          <p style={{ color: '#16a34a', fontSize: 13 }}>权限码 ({ctx.permissions.length}):</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
            {ctx.permissions.length === 0
              ? <span style={{ color: '#999', fontSize: 13 }}>无</span>
              : ctx.permissions.map(p => (
                <code key={p} style={{ background: '#f0f9ff', padding: '1px 6px', borderRadius: 4, fontSize: 12, border: '1px solid #bae6fd' }}>{p}</code>
              ))}
          </div>
          <p style={{ color: '#16a34a', fontSize: 13 }}>数据范围部门: {ctx.deptIds.join(', ') || '无'}</p>
        </div>
      ) : (
        <div style={{ background: '#fef3c7', borderRadius: 8, padding: 16, border: '1px solid #f59e0b' }}>
          <p style={{ margin: 0, fontSize: 14, color: '#92400e' }}>
            Redis 中无权限缓存。请先通过 Portal 登录触发权限写入（Token 签发时自动写 Redis）。
          </p>
        </div>
      )}

      <div style={{ marginTop: 24, padding: 16, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
        <h4 style={{ margin: '0 0 8px 0', fontSize: 14 }}>架构验证</h4>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 2 }}>
          <li>子应用零 OIDC 逻辑 ✅</li>
          <li>子应用零 Session 管理 ✅</li>
          <li>子应用零 Token 验签 ✅</li>
          <li>仅读 X-User-Id Header 识别用户 ✅</li>
          <li>仅查 Redis 获取权限 ✅</li>
        </ul>
      </div>
    </div>
  );
}
