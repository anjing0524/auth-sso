'use client';

/**
 * 登录页动态品牌背景（零依赖 Canvas 2D）
 *
 * ## 为什么不引入 PixiJS
 *
 * 用户建议"可以用 pixijs 优化背景"。评估后**不采用**，理由是"规范/方案本身也要被评估"：
 * 1. 本仓依赖环境离线（registry 不可达、pnpm store 只读），无法新增依赖；
 * 2. PixiJS 为一块**纯装饰背景**引入 ~150–400KB JS + WebGL 上下文 + 生命周期管理，
 *    收益（更炫的着色器）与成本（包体、首屏、移动端 GPU 功耗、SSR/hydration 复杂度）不成比例；
 * 3. 这里需要的是"深色品牌底 + 缓慢极光 + 微粒"三层慢动画，Canvas 2D 足够，
 *    且可精确控制帧率、暂停与降级。
 *
 * ## 设计目标（针对"登录页背景非常丑"）
 *
 * - 底色换成深海军蓝 → 品牌蓝的纵向渐变，而不是整屏高饱和亮蓝；
 * - 3 团低速漂移的极光（蓝/青/湖绿，`lighter` 叠加）制造纵深，不出现紫渐变（DESIGN 反模板规则）；
 * - 细网格 + 微粒星点提供"工程感"，透明度压到很低，不与登录卡片抢焦点；
 * - 四周暗角（vignette）让中心卡片自然成为视觉焦点。
 *
 * ## 性能与可访问性
 *
 * - DPR 上限 2、动画 30fps 节流；`document.hidden` 时暂停；卸载时取消 RAF 与监听；
 * - `prefers-reduced-motion: reduce` → 只画一帧静态背景（无动画）；
 * - `aria-hidden`，纯装饰；暗色/亮色共用同一背景（登录页是品牌入口，不随主题忽明忽暗）。
 */
import { useEffect, useRef } from 'react';

export function LoginBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let raf: number | null = null;
    let lastFrame = 0;
    const FRAME_MS = 1000 / 30;

    const particles = Array.from({ length: 64 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.6 + Math.random() * 1.6,
      speed: 0.006 + Math.random() * 0.02,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.12 + Math.random() * 0.5,
    }));

    /** 极光团：位置/相位/半径/颜色（全部走品牌蓝-青-湖绿，不用紫色） */
    const blobs = [
      { cx: 0.22, cy: 0.3, rx: 0.52, ry: 0.48, color: 'rgba(38, 122, 255, 0.42)', sx: 0.09, sy: 0.05, px: 0.0, py: 1.1 },
      { cx: 0.78, cy: 0.28, rx: 0.46, ry: 0.42, color: 'rgba(40, 216, 255, 0.22)', sx: 0.07, sy: 0.06, px: 2.2, py: 0.4 },
      { cx: 0.55, cy: 0.82, rx: 0.56, ry: 0.5, color: 'rgba(24, 92, 214, 0.34)', sx: 0.05, sy: 0.09, px: 4.1, py: 2.3 },
    ];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const drawBlob = (blob: (typeof blobs)[number], t: number) => {
      const cx = (blob.cx + Math.sin(t * blob.sx + blob.px) * 0.12) * width;
      const cy = (blob.cy + Math.cos(t * blob.sy + blob.py) * 0.1) * height;
      const radius = Math.max(blob.rx * width, blob.ry * height);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      g.addColorStop(0, blob.color);
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    };

    const draw = (t: number) => {
      // 1) 纵向品牌底：深海蓝 → 品牌蓝 → 深墨蓝
      const base = ctx.createLinearGradient(0, 0, 0, height);
      base.addColorStop(0, '#04122B');
      base.addColorStop(0.45, '#0A2E63');
      base.addColorStop(0.75, '#0B3C86');
      base.addColorStop(1, '#050D1F');
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, width, height);

      // 2) 极光（叠加混合）
      ctx.globalCompositeOperation = 'lighter';
      for (const blob of blobs) drawBlob(blob, t);
      ctx.globalCompositeOperation = 'source-over';

      // 3) 细网格（顶部渐隐，制造工程感）
      const gap = 56;
      const offset = (t * 4) % gap;
      ctx.strokeStyle = 'rgba(140, 190, 255, 0.055)';
      ctx.lineWidth = 1;
      for (let x = -gap; x < width + gap; x += gap) {
        ctx.beginPath();
        ctx.moveTo(x + offset, 0);
        ctx.lineTo(x + offset, height);
        ctx.stroke();
      }
      for (let y = -gap; y < height + gap; y += gap) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // 4) 微粒星点（慢速上升 + 呼吸闪烁）
      for (const p of particles) {
        const py = ((p.y - t * p.speed) % 1 + 1) % 1;
        const twinkle = 0.55 + 0.45 * Math.sin(t * 0.9 + p.phase);
        ctx.beginPath();
        ctx.arc(p.x * width, py * height, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(190, 225, 255, ${(p.alpha * twinkle).toFixed(3)})`;
        ctx.fill();
      }

      // 5) 暗角 + 顶部柔光，聚焦中心卡片
      const vignette = ctx.createRadialGradient(
        width / 2, height / 2, Math.min(width, height) * 0.2,
        width / 2, height / 2, Math.max(width, height) * 0.75,
      );
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, 'rgba(0, 6, 20, 0.62)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - lastFrame < FRAME_MS) return;
      lastFrame = now;
      draw(now / 1000);
    };

    const start = () => {
      resize();
      if (reduceMotion) {
        draw(0);
        return;
      }
      lastFrame = 0;
      raf = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      if (reduceMotion) return;
      if (document.hidden) {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
      } else if (raf === null) {
        lastFrame = 0;
        raf = requestAnimationFrame(tick);
      }
    };

    start();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="login-background"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
