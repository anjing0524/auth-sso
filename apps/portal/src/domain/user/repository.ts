import { User } from './user';
import { UserId } from './types';

/**
 * 仓储层契约接口，定义数据库与外部通讯标准 (Repository Interface)
 */
export interface UserRepository {
  /**
   * 依据 ID 获取用户
   */
  getById(id: UserId): Promise<User | null>;

  /**
   * 检查用户名或邮箱是否已存在
   */
  existsByUsernameOrEmail(username: string, email: string): Promise<boolean>;

  /**
   * 创建用户项并初始化凭证
   */
  create(user: User, passwordHash: string): Promise<void>;

  /**
   * 保存现有用户实体变更
   */
  save(user: User): Promise<void>;
}
