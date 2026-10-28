import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * 字体改为 **本地文件**（此前 `next/font/google` 在构建时联网下载）：
 * 2026-10-21 实测 Docker build 因 Google Fonts 请求失败而中断（网络受限环境无法构建），
 * 本地字体让 `docker build` 完全离线可复现。
 */
const geistSans = localFont({
  src: "../../public/fonts/geist-sans.woff2",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "../../public/fonts/geist-mono.woff2",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Auth-SSO Portal",
  description: "统一身份认证 - 管理门户",
};

import Script from 'next/script';
import { Toaster } from 'sonner';


/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >

      <body className="min-h-full flex flex-col">
        {/*
          主题初始化：组件里到处是 `dark:` 工具类，但此前没有任何地方给 <html> 加 `.dark`
          ⇒ 暗色样式全是死配置（系统暗色下实测 body 背景仍为 oklch(1 0 0)）。
          beforeInteractive 让 Next 把它放进 <head> 并先于 hydration 执行。
        */}
        <Script id="theme-init" strategy="beforeInteractive">
          {"(function(){try{var m=window.matchMedia('(prefers-color-scheme: dark)');var a=function(){document.documentElement.classList.toggle('dark',m.matches);document.documentElement.style.colorScheme=m.matches?'dark':'light'};a();m.addEventListener('change',a)}catch(e){}})();"}
        </Script>
        {children}
        <Toaster position="top-right" richColors containerAriaLabel="通知" />
      </body>
    </html>
  );
}
