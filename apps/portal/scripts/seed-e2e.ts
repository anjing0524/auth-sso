/**
 * E2E 专用夹具（只由测试栈 db-init 调用）。
 *
 * 与生产/开发 `seed.ts` 完全分离：即使误在非测试环境执行，也只增加无角色的
 * QA 用户、空权限 QA 角色和三条夹具日志，不触碰 admin/系统角色。
 */
import './load-env';

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { eq, isNull } from 'drizzle-orm';
import { db, schema } from '@/infrastructure/db';

async function main() {
  const root = await db.query.departments.findFirst({
    where: isNull(schema.departments.parentId),
    columns: { id: true },
  });
  const admin = await db.query.users.findFirst({
    where: eq(schema.users.username, 'admin'),
    columns: { id: true },
  });
  if (!root || !admin) {
    console.error('❌ E2E fixtures 需要先执行 db:seed（缺少根部门或 admin）');
    process.exit(1);
  }

  const rdDeptId = crypto.randomUUID();
  await db.insert(schema.departments).values({
    id: rdDeptId,
    name: '研发部',
    code: 'E2E_RD',
    parentId: root.id,
    ancestors: root.id,
    status: 'ACTIVE',
  });

  // 夹具不需要可登录凭据；随机密码避免已知口令进入任何环境
  await db.insert(schema.users).values({
    id: crypto.randomUUID(),
    username: 'qa_lin',
    email: 'qa_lin@example.com',
    name: 'QA 林',
    status: 'ACTIVE',
    passwordHash: await bcrypt.hash(crypto.randomUUID(), 10),
    deptId: rdDeptId,
  });

  // 基线 0 权限，供角色权限保存 e2e 使用；非系统角色可修改
  await db.insert(schema.roles).values({
    id: crypto.randomUUID(),
    name: '质量测试角色',
    code: 'QA_TEST',
    description: 'E2E fixture，默认无权限',
    deptId: root.id,
    isSystem: false,
    status: 'ACTIVE',
    sort: 99,
  });

  const now = new Date();
  await db.insert(schema.auditLogs).values({
    id: crypto.randomUUID(), userId: admin.id, username: 'admin',
    operation: 'USER_UPDATE', method: 'POST', url: '/users', ip: '127.0.0.1',
    userAgent: 'E2E', status: 200, duration: 12, createdAt: now,
  });
  await db.insert(schema.accessLogs).values({
    id: crypto.randomUUID(), userId: admin.id, username: 'admin', method: 'GET',
    path: '/api/users', resourceType: 'user', resourceId: admin.id,
    ip: '127.0.0.1', userAgent: 'E2E', status: 200, duration: 8, createdAt: now,
  });
  await db.insert(schema.loginLogs).values({
    id: crypto.randomUUID(), userId: admin.id, username: 'admin',
    eventType: 'LOGIN_SUCCESS', ip: '127.0.0.1', userAgent: 'E2E', createdAt: now,
  });

  console.log('✅ E2E fixtures seeded');
  process.exit(0);
}

main();
