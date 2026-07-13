/**
 * Drizzle ORM DB Mock 工厂
 *
 * 使用 Proxy + 闭包引用实现 db.select().from().where() 等查询构建器模式。
 * 所有配置变量通过闭包共享——set 方法更新闭包变量，chain/query 方法通过引用访问最新值。
 *
 * 支持的操作：
 * - db.select() / db.selectDistinct() → 链式调用，then() 返回 _queryResult
 * - db.insert().values() → returning() 或 then() 返回 _returningResult / _rowCountResult
 * - db.update().set().where() → returning() 或 then() 返回 _returningResult / _rowCountResult
 * - db.delete().where() → 同上
 * - db.query.{table}.findFirst() / findMany() → 返回 _queryResult / _queryResult[0]
 * - db.query.{table}.findFirst({ with: {...} }) → 嵌套关联查询，通过 _findFirstNestedResult 配置
 * - db.transaction(cb) → 传入 createTx() 代理（支持 select/insert/update/delete/query）
 * - db.execute() → 返回 _executeResult（支持 throw 模拟）
 *
 * @module __tests__/helpers/mock-db
 */

export function createMockDb(options: { schema?: Record<string, unknown> } = {}) {
  const schema = options.schema ?? {};
  let _queryResult: unknown[] = [];
  let _returningResult: unknown[] = [];
  let _rowCountResult = 1;
  let _executeResult: unknown[] = [];
  let _shouldThrow: Error | null = null;
  /** Drizzle relational query findFirst 的嵌套关联结果 */
  let _findFirstNestedResult: unknown = undefined;
  /** 捕获的写入操作列表（insert.values / update.set），测试用断言验证 */
  let _writes: Array<{ type: 'insert' | 'update', data: Record<string, unknown> }> = [];

  /** 创建链式查询构建器——所有方法返回自身，then() 返回配置数据 */
  function createChain(): unknown {
    const chain: any = () => {};
    chain.then = (resolve: Function) => resolve(_queryResult);
    chain.catch = () => ({ then: (r: Function) => r([]) });

    return new Proxy(chain, {
      get(_t, prop: string) {
        if (prop === 'then' || prop === 'catch') return chain[prop as keyof typeof chain];
        return () => createChain();
      },
    });
  }

  /** 创建 Drizzle relational query proxy（db.query.xxx.findFirst / findMany） */
  function createQueryProxy(): unknown {
    return new Proxy({} as any, {
      get(_t2, _p2: string) {
        return {
          findFirst: (args?: unknown) => {
            // 如果传了 with 嵌套查询且配置了 _findFirstNestedResult，返回配置的结果
            if (args && _findFirstNestedResult !== undefined) {
              const c: any = () => {};
              c.then = (resolve: Function) => resolve(_findFirstNestedResult);
              return c;
            }
            const c: any = () => {};
            c.then = (resolve: Function) => resolve(_queryResult[0] ?? null);
            return c;
          },
          findMany: () => createChain(),
        };
      },
    });
  }

  /** 创建事务内 tx 代理——接口与 db 一致，通过闭包读取最新配置 */
  function createTx(): unknown {
    return new Proxy({} as any, {
      get(_t, prop: string) {
        if (prop === 'select' || prop === 'selectDistinct') return () => createChain();
        if (prop === 'insert') {
          return () => ({
            values: (data: any) => {
              _writes.push({ type: 'insert', data });
              return {
                returning: () => Promise.resolve(_returningResult.length > 0 ? _returningResult : [{ ...data, id: 'mock-id' }]),
                then: (resolve: Function) => resolve(_rowCountResult),
              };
            },
          });
        }
        if (prop === 'update') {
          return () => ({
            set: (data: any) => {
              _writes.push({ type: 'update', data });
              return { where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) };
            },
          });
        }
        if (prop === 'delete') {
          return () => ({ where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) });
        }
        if (prop === 'execute') {
          return () => { if (_shouldThrow) throw _shouldThrow; return Promise.resolve(_executeResult); };
        }
        if (prop === 'query') return createQueryProxy();
        return undefined;
      },
    });
  }

  const db = new Proxy({} as any, {
    get(_t, prop: string) {
      if (prop === 'select' || prop === 'selectDistinct') return () => createChain();
      if (prop === 'insert') {
        return () => ({
          values: (data: any) => {
            _writes.push({ type: 'insert', data });
            return {
              returning: () => Promise.resolve(_returningResult.length > 0 ? _returningResult : [{ ...data, id: 'mock-id' }]),
              then: (resolve: Function) => resolve(_rowCountResult),
            };
          },
        });
      }
      if (prop === 'update') {
        return () => ({
          set: (data: any) => {
            _writes.push({ type: 'update', data });
            return { where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) };
          },
        });
      }
      if (prop === 'delete') {
        return () => ({ where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) });
      }
      if (prop === 'execute') {
        return () => { if (_shouldThrow) throw _shouldThrow; return Promise.resolve(_executeResult); };
      }
      if (prop === 'query') return createQueryProxy();
      if (prop === 'transaction') {
        return async (cb: (tx: any) => Promise<any>) => cb(createTx());
      }
      return undefined;
    },
  });

  return {
    db,
    dbProxy: db,
    schema,
    /** 设置 db.select() / findMany() 返回的行数据 */
    setQueryResult(r: unknown[]) { _queryResult = r; },
    /** 设置 insert().values().returning() 返回的行数据 */
    setInsertResult(r: unknown[]) { _returningResult = r; },
    /** setInsertResult 的别名 */
    setReturningResult(r: unknown[]) { _returningResult = r; },
    /** 设置 insert/update/delete 的受影响行数（then() 路径） */
    setRowCountResult(n: number) { _rowCountResult = n; },
    setExecuteResult(r: unknown[]) { _executeResult = r; },
    /** 设置 db.query.{table}.findFirst({ with: {...} }) 嵌套查询的返回结果 */
    setFindFirstNestedResult(r: unknown) { _findFirstNestedResult = r; },
    setThrowError(e: Error) { _shouldThrow = e; },
    clearThrowError() { _shouldThrow = null; },
    /** 获取自上次 reset 以来捕获的所有 insert.values / update.set 写入数据 */
    getWrites() { return [..._writes]; },
    /** 清除写入记录（通常 beforeEach 中与 reset 一起调用） */
    clearWrites() { _writes = []; },
    reset() {
      _queryResult = [];
      _returningResult = [];
      _rowCountResult = 1;
      _executeResult = [];
      _shouldThrow = null;
      _findFirstNestedResult = undefined;
      _writes = [];
    },
  };
}
