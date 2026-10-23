import 'server-only';

/**
 * 部门可用性守卫（H-23）—— 部门状态语义的**唯一消费点**。
 *
 * 语义（Lead 决策 D2，见 `docs/roadmap.md` 续九十六/续九十七 与 ADR-002 增补）：
 * `departments.status = DISABLED` 是**生命周期门禁**，不是追溯性吊销：
 * - 禁止在禁用部门下新建子部门；
 * - 禁止把用户/角色创建在或迁入禁用部门；
 * - 既有用户/角色的登录与数据范围**不因部门被禁用而改变**（不做级联撤销）。
 *
 * 为什么必须单点：创建用户、迁移用户、创建角色、迁移角色、创建子部门、迁移部门
 * 六条写路径若各写一遍 `status !== ACTIVE` 判断，任何一处漏写都会让禁用语义形同虚设
 * （审计实测：create 校验了、update 没校验）。顺序也统一：存在性(404) → 状态(422)，
 * 不能把"不存在"退化成"无权限/无状态"。
 *
 * @module lib/department-availability
 */
import { eq } from 'drizzle-orm';
import { schema } from '@/infrastructure/db';
import type { DbTxHandle } from '@/infrastructure/db';
import { EntityNotFoundError, BusinessRuleViolationError } from '@/domain/shared/errors';
import { ENTITY_ACTIVE } from '@auth-sso/contracts';

/**
 * 断言部门存在且为 ACTIVE。
 *
 * @param executor 事务/连接句柄（调用方必须已在事务内，避免校验与写入跨快照）
 * @param deptId   目标部门 ID
 * @param action   动作描述，用于可读错误消息（如「在该部门下创建用户」）
 * @throws EntityNotFoundError       部门不存在
 * @throws BusinessRuleViolationError 部门已禁用
 */
export async function assertDepartmentUsable(
  executor: DbTxHandle,
  deptId: string,
  action: string,
): Promise<void> {
  const dept = await executor.query.departments.findFirst({
    where: eq(schema.departments.id, deptId),
    columns: { id: true, status: true },
  });
  if (!dept) throw new EntityNotFoundError('Department', deptId);
  if (dept.status !== ENTITY_ACTIVE) {
    throw new BusinessRuleViolationError(`无法${action}：目标部门已被禁用`);
  }
}
