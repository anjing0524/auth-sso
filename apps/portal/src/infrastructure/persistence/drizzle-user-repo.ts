import { UserRepository } from '@/domain/user/repository';
import { User } from '@/domain/user/user';
import { UserId, toUserId, toDeptId } from '@/domain/user/types';
import { db, schema } from '@/lib/db';
import { eq, or } from 'drizzle-orm';
import { generateId } from '@/lib/crypto';

/**
 * 基础设施层：基于 Drizzle ORM 的 UserRepository 实现
 */
export class DrizzleUserRepository implements UserRepository {
  
  async getById(id: UserId): Promise<User | null> {
    const [row] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));

    if (!row) return null;

    return {
      id: toUserId(row.id),
      publicId: row.publicId,
      username: row.username,
      email: row.email || '',
      name: row.name || row.username,
      status: row.status as any,
      deptId: row.deptId ? toDeptId(row.deptId) : null,
      deptName: null,
      createdAt: row.createdAt
    };
  }

  async existsByUsernameOrEmail(username: string, email: string): Promise<boolean> {
    const result = await db
      .select()
      .from(schema.users)
      .where(or(eq(schema.users.username, username), eq(schema.users.email, email)));
    return result.length > 0;
  }

  async create(user: User, passwordHash: string): Promise<void> {
    await db.transaction(async (tx) => {
      // 写入基础用户表
      await tx.insert(schema.users).values({
        id: user.id,
        publicId: user.publicId,
        username: user.username,
        email: user.email,
        name: user.name,
        passwordHash: passwordHash,
        status: user.status as any,
        deptId: user.deptId,
        createdAt: user.createdAt,
        updatedAt: new Date()
      });

      // 初始化对应的凭证账号
      await tx.insert(schema.accounts).values({
        id: generateId(20),
        userId: user.id,
        accountId: user.email,
        providerId: 'credential',
        password: passwordHash,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });
  }

  async save(user: User): Promise<void> {
    await db
      .update(schema.users)
      .set({
        status: user.status as any,
        updatedAt: new Date()
      })
      .where(eq(schema.users.id, user.id));
  }
}
