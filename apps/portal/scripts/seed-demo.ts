/**
 * 可选的测试库演示数据（不进入默认 db:seed / db:seed:e2e）。
 *
 * 默认 E2E/视觉基线依赖确定性的最小夹具；本脚本只用于人工验收分页、筛选、
 * 部门树、角色/应用列表和审计日志。幂等：固定 ID + onConflictDoNothing。
 *
 * 用法：
 *   pnpm --filter @auth-sso/portal db:seed:demo
 * 测试栈：
 *   docker compose -f docker/compose/test.yml run --rm --no-deps db-init \
 *     pnpm --filter @auth-sso/portal db:seed:demo
 */
import './load-env';

import bcrypt from 'bcryptjs';
import { isNull } from 'drizzle-orm';
import { db, schema } from '@/infrastructure/db';

const demoId = (group: number, index: number) =>
  `10000000-0000-4000-8000-${String(group * 1000 + index).padStart(12, '0')}`;

async function main() {
  const root = await db.query.departments.findFirst({
    where: isNull(schema.departments.parentId),
    columns: { id: true },
  });
  if (!root) {
    console.error('❌ demo data 需要先执行 db:seed（缺少根部门）');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash('Demo@123456', 10);
  const departments = [
    { id: demoId(1, 1), name: '产品部', code: 'DEMO_PRODUCT' },
    { id: demoId(1, 2), name: '市场部', code: 'DEMO_MARKETING' },
    { id: demoId(1, 3), name: '客户成功部', code: 'DEMO_SUCCESS' },
    { id: demoId(1, 4), name: '财务部', code: 'DEMO_FINANCE' },
  ];
  const children = [
    { id: demoId(2, 1), parent: departments[0]!.id, name: '产品设计组', code: 'DEMO_PRODUCT_DESIGN' },
    { id: demoId(2, 2), parent: departments[0]!.id, name: '产品运营组', code: 'DEMO_PRODUCT_OPS' },
    { id: demoId(2, 3), parent: departments[1]!.id, name: '品牌组', code: 'DEMO_BRAND' },
    { id: demoId(2, 4), parent: departments[1]!.id, name: '增长组', code: 'DEMO_GROWTH' },
    { id: demoId(2, 5), parent: departments[2]!.id, name: '实施组', code: 'DEMO_DELIVERY' },
    { id: demoId(2, 6), parent: departments[3]!.id, name: '结算组', code: 'DEMO_SETTLEMENT' },
  ];

  await db.insert(schema.departments).values(
    departments.map((d, i) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      parentId: root.id,
      ancestors: root.id,
      sort: i + 10,
      status: 'ACTIVE' as const,
    })),
  ).onConflictDoNothing();

  await db.insert(schema.departments).values(
    children.map((d, i) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      parentId: d.parent,
      ancestors: `${root.id}/${d.parent}`,
      sort: i + 10,
      status: 'ACTIVE' as const,
    })),
  ).onConflictDoNothing();

  const allDepts = [...departments, ...children].map((d) => d.id);
  const users = Array.from({ length: 36 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    const status = i % 17 === 0 ? 'LOCKED' as const : i % 13 === 0 ? 'DISABLED' as const : 'ACTIVE' as const;
    return {
      id: demoId(3, i + 1),
      username: `demo_${n}`,
      email: `demo_${n}@example.com`,
      name: `演示用户 ${n}`,
      passwordHash,
      status,
      deptId: allDepts[i % allDepts.length]!,
      emailVerified: i % 3 === 0,
      lastLoginAt: i % 4 === 0 ? new Date(Date.now() - i * 86_400_000) : null,
    };
  });
  await db.insert(schema.users).values(users).onConflictDoNothing();

  const roles = Array.from({ length: 6 }, (_, i) => ({
    id: demoId(4, i + 1),
    name: `演示角色 ${String(i + 1).padStart(2, '0')}`,
    code: `DEMO_ROLE_${String(i + 1).padStart(2, '0')}`,
    description: '可选测试库演示角色',
    deptId: root.id,
    isSystem: false,
    status: i === 5 ? 'DISABLED' as const : 'ACTIVE' as const,
    sort: 100 + i,
  }));
  await db.insert(schema.roles).values(roles).onConflictDoNothing();
  await db.insert(schema.userRoles).values(
    users.slice(0, 18).map((u, i) => ({
      userId: u.id,
      roleId: roles[i % roles.length]!.id,
    })),
  ).onConflictDoNothing();

  await db.insert(schema.clients).values(
    Array.from({ length: 6 }, (_, i) => ({
      clientId: `demo-app-${String(i + 1).padStart(2, '0')}`,
      name: `演示应用 ${String(i + 1).padStart(2, '0')}`,
      clientSecret: null,
      redirectUris: [`https://demo-${i + 1}.example.com/api/auth/callback`],
      scopes: 'openid profile email offline_access',
      homepageUrl: `https://demo-${i + 1}.example.com`,
      status: i === 5 ? 'DISABLED' as const : 'ACTIVE' as const,
    })),
  ).onConflictDoNothing();

  const now = Date.now();
  const auditOps = ['USER_UPDATE', 'USER_CREATE', 'ROLE_UPDATE', 'DEPARTMENT_UPDATE'] as const;
  await db.insert(schema.auditLogs).values(
    Array.from({ length: 120 }, (_, i) => ({
      id: demoId(5, i + 1),
      userId: users[i % users.length]!.id,
      username: users[i % users.length]!.username,
      operation: auditOps[i % auditOps.length]!,
      method: 'POST',
      url: ['/users', '/roles', '/departments'][i % 3]!,
      ip: '127.0.0.1',
      userAgent: 'demo-seed',
      status: i % 11 === 0 ? 500 : 200,
      duration: 8 + (i % 40),
      createdAt: new Date(now - i * 3_600_000),
    })),
  ).onConflictDoNothing();

  await db.insert(schema.loginLogs).values(
    Array.from({ length: 80 }, (_, i) => ({
      id: demoId(6, i + 1),
      userId: users[i % users.length]!.id,
      username: users[i % users.length]!.username,
      eventType: i % 9 === 0 ? 'LOGIN_FAILED' as const : 'LOGIN_SUCCESS' as const,
      ip: '127.0.0.1',
      userAgent: 'demo-seed',
      failReason: i % 9 === 0 ? '演示失败记录' : null,
      createdAt: new Date(now - i * 1_800_000),
    })),
  ).onConflictDoNothing();

  await db.insert(schema.accessLogs).values(
    Array.from({ length: 80 }, (_, i) => ({
      id: demoId(7, i + 1),
      userId: users[i % users.length]!.id,
      username: users[i % users.length]!.username,
      method: 'GET',
      path: ['/api/users', '/api/roles', '/api/permissions'][i % 3]!,
      resourceType: ['user', 'role', 'permission'][i % 3]!,
      resourceId: users[i % users.length]!.id,
      ip: '127.0.0.1',
      userAgent: 'demo-seed',
      status: 200,
      duration: 5 + (i % 30),
      createdAt: new Date(now - i * 1_200_000),
    })),
  ).onConflictDoNothing();

  console.log('✅ demo data seeded: 10 departments, 36 users, 6 roles, 6 clients, 280 logs');
  process.exit(0);
}

main();
