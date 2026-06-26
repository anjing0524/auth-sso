/**
 * 内存 Redis Mock
 * 实现 RedisClient 接口，使用 Map 替代真实 Redis 连接
 * 用于 API 单元测试中隔离外部依赖
 */

/**
 * Pipeline Mock：链式调用收集命令，exec() 统一执行
 */
class MockPipeline {
  private commands: Array<{ method: string; args: any[] }> = [];

  del(key: string): this {
    this.commands.push({ method: 'del', args: [key] });
    return this;
  }

  setex(key: string, seconds: number, value: string): this {
    this.commands.push({ method: 'setex', args: [key, seconds, value] });
    return this;
  }

  sadd(key: string, member: string): this {
    this.commands.push({ method: 'sadd', args: [key, member] });
    return this;
  }

  srem(key: string, member: string): this {
    this.commands.push({ method: 'srem', args: [key, member] });
    return this;
  }

  get(key: string): this {
    this.commands.push({ method: 'get', args: [key] });
    return this;
  }

  /**
   * 执行 Pipeline 中累积的全部命令
   * @param store 引用底层 MockRedisStore 实例
   */
  async exec(store: MockRedisStore): Promise<any[]> {
    const results: any[] = [];
    for (const cmd of this.commands) {
      const fn = (store as any)[cmd.method];
      if (typeof fn === 'function') {
        results.push(await fn.apply(store, cmd.args));
      }
    }
    this.commands = [];
    return results;
  }
}

/**
 * 内存 Redis 存储实现
 * 使用 Map 模拟 string 操作，Map<key, Set<string>> 模拟 set 操作
 */
export class MockRedisStore {
  private store = new Map<string, string>();
  private sets = new Map<string, Set<string>>();
  private hashes = new Map<string, Map<string, string>>();
  private expiries = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    if (this.isExpired(key)) {
      this.store.delete(key);
      return null;
    }
    return this.store.get(key) ?? null;
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK' | null> {
    this.store.set(key, value);
    this.expiries.set(key, Date.now() + seconds * 1000);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.store.has(key);
    this.store.delete(key);
    this.expiries.delete(key);
    return existed ? 1 : 0;
  }

  async keys(pattern: string): Promise<string[]> {
    // 简单的通配符实现：仅支持 * 后缀匹配
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return Array.from(this.store.keys()).filter(k => k.startsWith(prefix));
    }
    return this.store.has(pattern) ? [pattern] : [];
  }

  async quit(): Promise<void> {
    // 无操作
  }

  async sadd(key: string, member: string): Promise<number> {
    if (!this.sets.has(key)) {
      this.sets.set(key, new Set());
    }
    const set = this.sets.get(key)!;
    const isNew = !set.has(member);
    set.add(member);
    return isNew ? 1 : 0;
  }

  async srem(key: string, member: string): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    const existed = set.has(member);
    set.delete(member);
    return existed ? 1 : 0;
  }

  async smembers(key: string): Promise<string[]> {
    const set = this.sets.get(key);
    return set ? Array.from(set) : [];
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.store.has(key) && !this.sets.has(key) && !this.hashes.has(key)) return 0;
    this.expiries.set(key, Date.now() + seconds * 1000);
    return 1;
  }

  async incr(key: string): Promise<number> {
    const current = this.store.has(key) && !this.isExpired(key) ? parseInt(this.store.get(key)!, 10) : 0;
    if (isNaN(current)) {
      this.store.set(key, '1');
      return 1;
    }
    const next = current + 1;
    this.store.set(key, String(next));
    return next;
  }

  async exists(key: string): Promise<number> {
    if (this.isExpired(key)) {
      this.store.delete(key);
      return 0;
    }
    return this.store.has(key) ? 1 : 0;
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    if (!this.hashes.has(key)) {
      this.hashes.set(key, new Map());
    }
    const hash = this.hashes.get(key)!;
    const isNew = !hash.has(field);
    hash.set(field, value);
    return isNew ? 1 : 0;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    const result: Record<string, string> = {};
    for (const [k, v] of hash) {
      result[k] = v;
    }
    return result;
  }

  pipeline(): any {
    const store = this;
    // 返回一个绑定到当前 store 的 pipeline 实例
    const pipeline = new MockPipeline();
    return new Proxy(pipeline, {
      get(target, prop) {
        if (prop === 'exec') {
          return () => target.exec(store);
        }
        return (target as any)[prop];
      },
    });
  }

  // === 测试辅助方法 ===

  /**
   * 检查 key 是否已过期
   */
  private isExpired(key: string): boolean {
    const expiry = this.expiries.get(key);
    if (!expiry) return false;
    return Date.now() >= expiry;
  }

  /**
   * 清空全部数据（每个测试之间调用）
   */
  clear(): void {
    this.store.clear();
    this.sets.clear();
    this.hashes.clear();
    this.expiries.clear();
  }

  /**
   * 获取当前存储的 key 数量（用于断言）
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * 直接设置值（不经过 TTL，用于 setup）
   */
  set(key: string, value: string): void {
    this.store.set(key, value);
  }
}

/**
 * 创建 mock 版本的 getRedis 函数
 * 返回使用 MockRedisStore 实现的 RedisClient 接口
 *
 * @param store 可选的 MockRedisStore 实例（用于跨 mock 共享状态）
 * @returns { getRedis: Function, store: MockRedisStore }
 */
export function createMockRedis(store?: MockRedisStore) {
  const mockStore = store ?? new MockRedisStore();

  const getRedis = () => mockStore;

  return { getRedis, store: mockStore };
}
