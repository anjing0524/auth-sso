#!/usr/bin/env node
/**
 * Gateway 基准测试（无第三方依赖，Node 18+ 内置 fetch）
 *
 * 用途：用可复现的数字回答"网关是否拖慢入口/静态资源"，而不是凭感觉优化。
 * 覆盖三类真实路径：
 *   /healthz               网关自身存活探针（新，不访问 Portal）
 *   /login                 流式 HTML 页面（经 Portal + Gateway）
 *   /_next/static/*.js     静态资源（网关 Static 分类直接放行 + immutable 缓存）
 *
 * 用法：
 *   node scripts/bench-gateway.mjs [--url https://127.0.0.1:19443] [--n 200] [--c 20]
 *
 * 说明：Node fetch 走 HTTP/1.1；网关对浏览器协商 HTTP/2 已在 curl 验收中确认。
 * 自签证书环境脚本内部关闭证书校验（仅基准用途）。
 */
import { performance } from 'node:perf_hooks';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = getArg('url', process.env.BENCH_URL || 'https://127.0.0.1:19443').replace(/\/$/, '');
const N = Number.parseInt(getArg('n', '200'), 10);
const C = Math.max(1, Number.parseInt(getArg('c', '20'), 10));

async function discoverAsset() {
  try {
    const html = await (await fetch(`${BASE}/login`)).text();
    return /\/_next\/static\/[^"']+\.js/.exec(html)?.[0] ?? null;
  } catch {
    return null;
  }
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function bench(path) {
  const latencies = [];
  let ok = 0;
  let failed = 0;
  const total = N;

  const runOne = async () => {
    const started = performance.now();
    try {
      const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
      await res.arrayBuffer();
      if (res.status >= 200 && res.status < 400) ok += 1;
      else failed += 1;
      latencies.push(performance.now() - started);
    } catch {
      failed += 1;
      latencies.push(performance.now() - started);
    }
  };

  const startedAll = performance.now();
  await new Promise((resolve) => {
    // 在途窗口：started-finished < C；以 finished 达到 total 作为完成条件
    // （早期版本以 started 达到 total 就 resolve，最后 C-1 个请求未被计入）。
    let started = 0;
    let finished = 0;
    const pump = () => {
      if (finished >= total) { resolve(); return; }
      while (started < total && started - finished < C) {
        started += 1;
        void runOne().then(() => {
          finished += 1;
          pump();
        });
      }
    };
    pump();
  });
  const elapsed = performance.now() - startedAll;
  const sorted = [...latencies].sort((a, b) => a - b);
  const avg = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
  return {
    path,
    requests: total,
    ok,
    failed,
    rps: Math.round((total / elapsed) * 1000),
    avgMs: Number(avg.toFixed(2)),
    p50Ms: Number(pct(sorted, 50).toFixed(2)),
    p95Ms: Number(pct(sorted, 95).toFixed(2)),
    maxMs: Number(Math.max(...sorted, 0).toFixed(2)),
  };
}

const asset = await discoverAsset();
const targets = ['/healthz', '/login', ...(asset ? [asset] : [])];
const rows = [];
for (const target of targets) rows.push(await bench(target));

console.log(`Gateway bench url=${BASE} n=${N} concurrency=${C}`);
console.table(rows.map((r) => ({
  path: r.path.length > 42 ? `${r.path.slice(0, 39)}…` : r.path,
  ok: r.ok,
  failed: r.failed,
  rps: r.rps,
  avg: `${r.avgMs}ms`,
  p50: `${r.p50Ms}ms`,
  p95: `${r.p95Ms}ms`,
  max: `${r.maxMs}ms`,
})));
const totalFailed = rows.reduce((a, r) => a + r.failed, 0);
process.exitCode = totalFailed > 0 ? 1 : 0;
