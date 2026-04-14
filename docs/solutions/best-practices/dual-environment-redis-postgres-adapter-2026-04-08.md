---
title: Dual-Environment Redis and PostgreSQL Adapter Pattern
date: 2026-04-08
category: docs/solutions/best-practices/
module: infrastructure-adapter
problem_type: best_practice
component: database
severity: low
applies_when:
  - 部署应用到 Vercel 并使用 Vercel Storage 服务
  - 本地开发需要 Docker 容器化数据库服务
  - 需要统一 Redis 和 PostgreSQL 客户端接口
related_components:
  - idp
  - portal
tags: [neon-http, upstash-redis, ioredis, environment-adaptation, vercel-storage]
---

# Dual-Environment Redis and PostgreSQL Adapter Pattern

## Context

在 pnpm monorepo 架构下，IdP 和 Portal 应用需要同时支持本地开发（Docker 容器化 PostgreSQL 和 Redis）与 Vercel 生产部署（Neon PostgreSQL + Upstash KV）。

**问题场景：**
- 本地开发：`ioredis` + `postgres-js` 是标准选择
- Vercel serverless：需要 HTTP-based 客户端（`@upstash/redis` + `neon-http`）
- 两套客户端 API 不同，代码难以统一维护

## Guidance

**核心模式：通过 `NODE_ENV` 判断环境，动态选择客户端实现，同时暴露统一的 API 接口。**

### Redis 统一接口

```typescript
// 定义统一接口
interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ex?: number }): Promise<'OK' | null>;
  setex(key: string, seconds: number, value: string): Promise<'OK' | null>;
  del(key: string): Promise<number>;
  hset(key: string, field: string, value: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  quit(): Promise<void>;
}

// 环境判断
const isProduction = process.env.NODE_ENV === 'production';

// 动态创建客户端
export function getRedis(): RedisClient {
  if (!redisClient) {
    redisClient = isProduction ? createUpstashClient() : createIoredisClient();
  }
  return redisClient;
}
```

### PostgreSQL 统一方案

```typescript
// neon-http 同时支持本地 Docker PostgreSQL 和 Neon serverless
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

const connectionString = process.env.DATABASE_URL!;
const sql = neon(connectionString);
export const db = drizzle({ client: sql, schema });
```

**关键发现：`neon-http` 客户端只要配置 `DATABASE_URL`，即可同时用于本地和生产环境，无需环境判断。**

## Why This Matters

| 维度 | 影响 |
|------|------|
| **代码维护** | 单一接口定义，无需维护两套代码分支 |
| **部署简化** | 环境变量自动适配，无需修改代码 |
| **调试体验** | 本地开发使用熟悉的 `ioredis` CLI 工具 |
| **Serverless 优化** | Upstash/neon HTTP 客户端无连接池开销，适合 Vercel |

## When to Apply

- 新建 Next.js + Vercel 项目，需要 Redis/PostgreSQL 双环境支持
- 将现有项目迁移到 Vercel，本地开发仍需 Docker
- 统一 monorepo 中多个应用的数据库连接模式

## Examples

### IdP Redis 实现 (`apps/idp/src/lib/redis.ts`)

```typescript
function createIoredisClient(): RedisClient {
  const client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  // ioredis API 直接匹配 RedisClient 接口
  return {
    get: (key) => client.get(key),
    setex: (key, seconds, value) => client.setex(key, seconds, value),
    // ... 其他方法
  };
}

function createUpstashClient(): RedisClient {
  const client = new UpstashRedis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });

  // Upstash API 适配为统一接口
  return {
    get: async (key) => await client.get<string>(key) ?? null,
    setex: async (key, seconds, value) => {
      await client.set(key, value, { ex: seconds });
      return 'OK';
    },
    // Upstash 不支持 keys，返回空数组并警告
    keys: async () => {
      console.warn('[Redis] Upstash does not support keys command');
      return [];
    },
  };
}
```

### 环境变量配置

**本地开发 (`apps/idp/.env.example`)：**
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/auth_sso
REDIS_URL=redis://localhost:6379
NODE_ENV=development
```

**生产环境 (`apps/idp/.env.production.example`)：**
```bash
DATABASE_URL=${Neon pooler URL}
KV_REST_API_URL=${Upstash REST API URL}
KV_REST_API_TOKEN=${Upstash REST API Token}
NODE_ENV=production
```

## Upstash API 差异提示

| 命令 | ioredis | Upstash | 适配方案 |
|------|---------|---------|---------|
| `setex` | 直接支持 | 用 `set(key, value, { ex })` | 统一接口适配 |
| `keys` | 支持 | **不支持** | 返回空数组 + 警告 |
| `ttl` | 支持 | **不支持** | 返回 `-1` + 警告 |
| `expire` | 支持 | **不支持** | 通过 `set` 重写模拟 |

**生产环境最佳实践：避免使用 `keys` 命令，改用预知的 key pattern 或 scan。**

## Related

- Auto memory M6: Environment Config Architecture
- `docs/environment-variables.md` - 环境变量完整配置
- `docs/vercel-dashboard-deployment.md` - Vercel Storage 配置流程