import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Demo App - SSO 测试',
  description: 'SSO 接入演示应用',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}