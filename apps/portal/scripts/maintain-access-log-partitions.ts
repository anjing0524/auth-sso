/**
 * access_logs 分区维护脚本
 *
 * 用法：
 *   cd apps/portal && DATABASE_URL=<url> tsx scripts/maintain-access-log-partitions.ts
 *
 * 建议 cron：每月 1 号执行。
 *
 * 职责：
 * 1. 预创建未来 2 个月的分区（确保写入不报错）
 * 2. 删除超过 180 天的过期分区（合规保留期）
 *
 * 幂等：CREATE TABLE IF NOT EXISTS + 检查 pg_inherits 避免重复。
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const RETENTION_DAYS = 180;

function monthRange(year: number, month: number): { start: string; end: string; name: string } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const name = `${year}_${String(month).padStart(2, '0')}`;
  return { start: fmt(start), end: fmt(end), name };
}

function getMonthsAhead(count: number): Array<{ start: string; end: string; name: string }> {
  const now = new Date();
  const result: Array<{ start: string; end: string; name: string }> = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    result.push(monthRange(d.getUTCFullYear(), d.getUTCMonth() + 1));
  }
  return result;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 未设置');
    process.exit(1);
  }

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  // 1. 预创建未来 2 个月分区
  const futureMonths = getMonthsAhead(2);
  console.log('▸ 预创建分区：', futureMonths.map((m) => m.name).join(', '));
  for (const m of futureMonths) {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS access_logs_${m.name}
         PARTITION OF access_logs
         FOR VALUES FROM ('${m.start}') TO ('${m.end}')`,
    );
    console.log(`  ✓ access_logs_${m.name}`);
  }

  // 2. 删除过期分区（created_at < now - 180 天）
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  console.log(`▸ 查找 ${RETENTION_DAYS} 天前（< ${cutoff.toISOString().slice(0, 10)}）的过期分区`);

  const expired = await db.execute<{ tablename: string }>(`
    SELECT inhrelid::regclass::text AS tablename
    FROM pg_inherits
    WHERE inhparent = 'access_logs'::regclass
      AND inhrelid::regclass::text < (
        SELECT 'access_logs_' || to_char('${cutoff.toISOString()}'::timestamptz, 'YYYY_MM')
      )
  `);

  for (const row of expired) {
    const table = row.tablename ?? (row as Record<string, string>).tablename;
    if (!table) continue;
    console.log(`  ✗ DROP ${table}`);
    await db.execute(`DROP TABLE IF EXISTS ${table}`);
  }

  if (expired.length === 0) {
    console.log('  （无过期分区）');
  }

  await client.end();
  console.log('\n✅ 分区维护完成');
}

main().catch((err) => {
  console.error('分区维护失败:', err);
  process.exit(1);
});
