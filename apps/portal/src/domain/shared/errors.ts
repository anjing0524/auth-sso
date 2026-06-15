/**
 * 领域错误类型体系
 * 所有领域异常的根类型，Controller 层据此映射 HTTP 状态码
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** 实体未找到错误 */
export class EntityNotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super('ENTITY_NOT_FOUND', `${entity} [${id}] 不存在`);
  }
}

/** 业务规则违反错误 */
export class BusinessRuleViolationError extends DomainError {
  constructor(rule: string) {
    super('BUSINESS_RULE_VIOLATION', rule);
  }
}

/** 唯一性冲突错误 */
export class DuplicateEntityError extends DomainError {
  constructor(entity: string, field: string) {
    super('DUPLICATE_ENTITY', `${entity} 的 ${field} 已存在`);
  }
}
