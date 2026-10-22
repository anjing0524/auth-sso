#!/usr/bin/env node
/**
 * Auth-SSO API 性能基准测试
 *
 * 使用 Node.js 原生 http/https 进行并发性能测试，无需额外安装 k6。
 * 验证 NFR-PERF-01~05 性能目标。
 *
 * 用法:
 *   node tests/performance/api-benchmark.mjs
 *   node tests/performance/api-benchmark.mjs --concurrency 100 --duration 10
 *   node tests/performance/api-benchmark.mjs --quick  (快速冒烟)
 *
 * 基准目标:
 *   /api/health          — 10K RPS @ p99 < 10ms
 *   /api/me              — 500 RPS @ p99 < 200ms
 *   /.well-known/...     — 1K RPS @ p99 < 50ms
 *   /api/auth/login      — 100 req/s @ p99 < 500ms
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ── 配置 ──────────────────────────────────────────────

const BASE_URL = process.env.BENCH_BASE_URL || 'http://localhost:4100';
const DEFAULT_CONCURRENCY = 50;
const DEFAULT_DURATION = 5; // seconds
const QUICK_CONCURRENCY = 10;
const QUICK_DURATION = 2;

const ENDPOINTS = {
  health: { method: 'GET', path: '/api/health', expectedStatus: 200 },
  'well-known': { method: 'GET', path: '/.well-known/openid-configuration', expectedStatus: 200 },
  jwks: { method: 'GET', path: '/api/auth/jwks', expectedStatus: 200 },
  me: { method: 'GET', path: '/api/me', expectedStatus: 401 }, // 未认证返回 401 也计入成功
  login: { method: 'POST', path: '/api/auth/login', body: JSON.stringify({ email: 'bench@test.com', password: 'wrong' }), headers: { 'Content-Type': 'application/json' }, expectedStatus: [400, 401, 403] },
  users: { method: 'GET', path: '/api/users', expectedStatus: 401 },
};

// ── 工具 ──────────────────────────────────────────────

function makeRequest(opt) {
  return new Promise((resolve) => {
    const url = new URL(opt.path, BASE_URL);
    const client = url.protocol === 'https:' ? https : http;
    const start = process.hrtime.bigint();

    const reqOpts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: opt.method || 'GET',
      headers: opt.headers || {},
      timeout: 10000,
    };

    const req = client.request(reqOpts, (res) => {
      const end = process.hrtime.bigint();
      res.resume();
      res.on('end', () => {
        resolve({ status: res.statusCode, latencyNs: Number(end - start) });
      });
      res.on('error', () => {
        resolve({ status: 0, latencyNs: Number(end - start) });
      });
    });

    req.on('error', () => {
      const end = process.hrtime.bigint();
      resolve({ status: 0, latencyNs: Number(end - start) });
    });

    req.on('timeout', () => {
      req.destroy();
      const end = process.hrtime.bigint();
      resolve({ status: 0, latencyNs: Number(end - start) });
    });

    if (opt.body) req.write(opt.body);
    req.end();
  });
}

function percentile(sorted, p) {
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ── 基准执行 ──────────────────────────────────────────

async function runBenchmark(name, opts, concurrency, duration) {
  const results = [];
  const startTime = Date.now();
  let inFlight = 0;

  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      if (Date.now() - startTime > duration * 1000) {
        clearInterval(interval);
        // 等待正在进行的请求完成
        while (inFlight > 0) {
          await new Promise(r => setTimeout(r, 50));
        }
        return;
      }

      while (inFlight < concurrency) {
        inFlight++;
        makeRequest(opts).then((r) => {
          results.push(r);
          inFlight--;
        });
        // 避免在一帧内发送过多请求
        if (results.length % 10 === 0) await new Promise(r => setTimeout(r, 0));
      }
    }, 0);

    // 收集足够数据后停止
    const checkDone = setInterval(() => {
      if (results.length > concurrency * duration * 2 && Date.now() - startTime > duration * 1000 + 2000) {
        clearInterval(interval);
        clearInterval(checkDone);
        resolve(results);
      }
    }, 500);

    // 硬超时
    setTimeout(() => {
      clearInterval(interval);
      clearInterval(checkDone);
      resolve(results);
    }, (duration + 5) * 1000);
  });
}

async function runAll(concurrency, duration) {
  console.log(`\nAuth-SSO API 性能基准测试`);
  console.log(`${'='.repeat(60)}`);
  console.log(`BASE_URL: ${BASE_URL}`);
  console.log(`并发数: ${concurrency}, 持续时间: ${duration}s`);
  console.log(`${'='.repeat(60)}\n`);

  const summary = [];

  for (const [name, opts] of Object.entries(ENDPOINTS)) {
    process.stdout.write(`  [${name}] ${opts.method} ${opts.path} ... `);

    const start = Date.now();
    const results = await runBenchmark(name, opts, concurrency, duration);
    const elapsed = Date.now() - start;

    if (results.length === 0) {
      console.log(`0 请求 (服务不可达?)`);
      summary.push({ name, total: 0, rps: 0 });
      continue;
    }

    // 计算指标
    const total = results.length;
    const expected = Array.isArray(opts.expectedStatus) ? opts.expectedStatus : [opts.expectedStatus];
    const success = results.filter(r => expected.includes(r.status)).length;
    const failed = results.filter(r => r.status === 0 || r.status === 500).length;
    const latencies = results.map(r => r.latencyNs / 1e6).sort((a, b) => a - b);

    const rps = (total / (elapsed / 1000)).toFixed(1);
    const p50 = percentile(latencies, 50).toFixed(1);
    const p95 = percentile(latencies, 95).toFixed(1);
    const p99 = percentile(latencies, 99).toFixed(1);
    const min = latencies[0]?.toFixed(1) || '-';
    const max = latencies[latencies.length - 1]?.toFixed(1) || '-';
    const successRate = total > 0 ? ((success / total) * 100).toFixed(1) : '0.0';

    console.log(`${total} reqs, ${rps} rps, p50=${p50}ms p95=${p95}ms p99=${p99}ms success=${successRate}%`);

    if (failed > 0) {
      console.log(`           ⚠️  ${failed}/${total} 请求失败(500/err)`);
    }

    summary.push({ name, total, rps: parseFloat(rps), p50: parseFloat(p50), p95: parseFloat(p95), p99: parseFloat(p99), successRate: parseFloat(successRate), min: parseFloat(min), max: parseFloat(max) });
  }

  // ── 汇总 ──
  console.log(`\n${'='.repeat(60)}`);
  console.log('基准测试汇总');
  console.log(`${'='.repeat(60)}`);
  console.log(`${'端点'.padEnd(20)} ${'RPS'.padEnd(10)} ${'p50(ms)'.padEnd(10)} ${'p95(ms)'.padEnd(10)} ${'p99(ms)'.padEnd(10)} ${'成功率'.padEnd(10)}`);
  console.log('-'.repeat(60));

  for (const s of summary) {
    const flag = s.successRate < 90 ? ' ⚠️' : '';
    console.log(`${s.name.padEnd(20)} ${String(s.rps).padEnd(10)} ${String(s.p50).padEnd(10)} ${String(s.p95).padEnd(10)} ${String(s.p99).padEnd(10)} ${(s.successRate + '%').padEnd(10)}${flag}`);
  }

  // 保存 JSON 报告
  const fs = require('fs');
  const reportDir = `${__dirname}/../../bench-results`;
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = `${reportDir}/bench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), baseUrl: BASE_URL, concurrency, duration, endpoints: summary }, null, 2));
  console.log(`\n报告已保存: ${reportPath}`);
}

// ── 入口 ──────────────────────────────────────────────

const args = process.argv.slice(2);
let concurrency = DEFAULT_CONCURRENCY;
let duration = DEFAULT_DURATION;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--concurrency' && args[i + 1]) concurrency = parseInt(args[++i]);
  if (args[i] === '--duration' && args[i + 1]) duration = parseInt(args[++i]);
  if (args[i] === '--quick') { concurrency = QUICK_CONCURRENCY; duration = QUICK_DURATION; }
}

runAll(concurrency, duration).catch(console.error);
