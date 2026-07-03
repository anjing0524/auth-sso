import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
  }
  return redis;
}

interface PermissionContext {
  roles: { id: string; code: string; name: string }[];
  permissions: string[];
  deptIds: string[];
}

export async function getUserPermissions(userId: string): Promise<PermissionContext | null> {
  const r = getRedis();
  const key = `portal:user_perms:${userId}`;
  try {
    const raw = await r.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as PermissionContext;
  } catch {
    return null;
  }
}
