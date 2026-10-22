import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Demo App — Auth-SSO 集成演示',
  description: 'OIDC 单应用接入验证',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f5f5f5' }}>
        <header style={{ background: '#1a1a2e', color: '#fff', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 18 }}>Demo App</span>
          <span style={{ fontSize: 13, opacity: 0.7 }}>Auth-SSO OIDC 集成验证</span>
        </header>
        <main style={{ maxWidth: 800, margin: '40px auto', padding: '0 24px' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
