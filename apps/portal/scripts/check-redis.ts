import { getRedis } from '../src/lib/redis';

async function check() {
  console.log('Connecting to Redis...');
  const redis = getRedis();
  try {
    const keys = await redis.keys('portal:session:*');
    console.log('Session keys:', keys);
    if (keys.length > 0) {
      const data = await redis.get(keys[0]!);
      console.log('First session data:', data);
    }
  } catch (err) {
    console.error('Redis error:', err);
  } finally {
    await redis.quit();
    process.exit(0);
  }
}

check();
