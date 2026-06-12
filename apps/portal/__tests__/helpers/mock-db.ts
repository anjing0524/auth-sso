/**
 * Drizzle ORM DB Mock 工厂
 * 使用 Proxy + 闭包引用实现 db.select().from().where() 等查询构建器模式
 * 所有配置变量通过闭包共享——set 方法更新闭包变量，chain/query 方法通过引用访问最新值
 *
 * 使用方式：
 *   const mockDb = createMockDb();
 *   mockDb.setQueryResult([{ id: '1', name: 'test' }]);
 *   // 被测代码中调用 db.select().from(schema.users).where(eq(...)) 将返回上述数据
 */

export function createMockDb(options: { schema?: Record<string, any> } = {}) {
  const schema = options.schema ?? {};
  let _queryResult: any[] = [];
  let _returningResult: any[] = [];
  let _rowCountResult = 1;
  let _executeResult: any[] = [];
  let _shouldThrow: Error | null = null;

  /** 创建链式查询构建器——所有方法返回自身，then() 返回配置数据 */
  function createChain(): any {
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

  /** 创建事务内 tx 代理——接口与 db 一致，通过闭包读取最新配置 */
  function createTx(): any {
    return new Proxy({} as any, {
      get(_t, prop: string) {
        if (prop === 'select' || prop === 'selectDistinct') return () => createChain();
        if (prop === 'insert') {
          return () => ({
            values: (data: any) => ({
              returning: () => Promise.resolve(_returningResult.length > 0 ? _returningResult : [{ ...data, id: 'mock-id' }]),
              then: (resolve: Function) => resolve(_rowCountResult),
            }),
          });
        }
        if (prop === 'update') {
          return () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) }) });
        }
        if (prop === 'delete') {
          return () => ({ where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) });
        }
        if (prop === 'execute') {
          return () => { if (_shouldThrow) throw _shouldThrow; return Promise.resolve(_executeResult); };
        }
        return undefined;
      },
    });
  }

  const db = new Proxy({} as any, {
    get(_t, prop: string) {
      if (prop === 'select' || prop === 'selectDistinct') return () => createChain();
      if (prop === 'insert') {
        return () => ({
          values: (data: any) => ({
            returning: () => Promise.resolve(_returningResult.length > 0 ? _returningResult : [{ ...data, id: 'mock-id' }]),
            then: (resolve: Function) => resolve(_rowCountResult),
          }),
        });
      }
      if (prop === 'update') {
        return () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) }) });
      }
      if (prop === 'delete') {
        return () => ({ where: () => ({ returning: () => Promise.resolve(_returningResult), then: (r: Function) => r(_rowCountResult) }) });
      }
      if (prop === 'execute') {
        return () => { if (_shouldThrow) throw _shouldThrow; return Promise.resolve(_executeResult); };
      }
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
    setQueryResult(r: any[]) { _queryResult = r; },
    setInsertResult(r: any[]) { _returningResult = r; },
    setReturningResult(r: any[]) { _returningResult = r; },
    setRowCountResult(n: number) { _rowCountResult = n; },
    setExecuteResult(r: any[]) { _executeResult = r; },
    setThrowError(e: Error) { _shouldThrow = e; },
    clearThrowError() { _shouldThrow = null; },
    reset() {
      _queryResult = [];
      _returningResult = [];
      _rowCountResult = 1;
      _executeResult = [];
      _shouldThrow = null;
    },
  };
}
