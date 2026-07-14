/**
 * 服务健康检查端点 (GET /api/health)
 *
 * 供 Docker 健康检查、负载均衡器、监控系统使用。
 * 探测 DB 和 Redis 连通性，返回复合健康状态。
 *
 * @route GET /api/health
 */
import { NextResponse } from 'next/server';
import { db } from '@/infrastructure/db';
import { getRedis } from '@/infrastructure/redis';
import { sql } from 'drizzle-orm';
import type Redis from 'ioredis';

interface HealthCheck {
  status: 'ok' | 'fail';
  latencyMs: number;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: HealthCheck;
    redis: HealthCheck;
  };
}

async function checkDatabase(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch {
    return { status: 'fail', latencyMs: Date.now() - start };
  }
}

async function checkRedis(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const redis = getRedis() as unknown as Redis;
    const result = await redis.ping();
    if (result === 'PONG') {
      return { status: 'ok', latencyMs: Date.now() - start };
    }
    return { status: 'fail', latencyMs: Date.now() - start };
  } catch {
    return { status: 'fail', latencyMs: Date.now() - start };
  }
}

export async function GET() {
  const [dbCheck, redisCheck] = await Promise.all([checkDatabase(), checkRedis()]);

  const allOk = dbCheck.status === 'ok' && redisCheck.status === 'ok';
  const allFail = dbCheck.status === 'fail' && redisCheck.status === 'fail';

  const response: HealthResponse = {
    status: allOk ? 'healthy' : allFail ? 'unhealthy' : 'degraded',
    timestamp: new Date().toISOString(),
    checks: {
      database: dbCheck,
      redis: redisCheck,
    },
  };

  return NextResponse.json(response, {
    status: allOk ? 200 : 503,
  });
}
