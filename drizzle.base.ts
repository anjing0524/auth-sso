/**
 * Workspace 通用 Drizzle ORM 配置工厂
 *
 * 提取所有 app 共享的 Drizzle 设置（postgresql 方言、verbose、strict 模式），
 * 参数化 schema 路径和输出目录。
 * 不导入 drizzle-kit，返回值由 app 端传入 defineConfig 获得类型安全。
 *
 * @module drizzle.base
 */

/**
 * 创建 Drizzle 配置（纯对象，零运行时依赖）
 * @param {{ schema: string; out: string }} opts
 * @returns {import('drizzle-kit').Config}
 */
export function createDrizzleConfig(opts: { schema: string; out: string }) {
  return {
    schema: opts.schema,
    out: opts.out,
    dialect: /** @type {'postgresql'} */ ('postgresql'),
    dbCredentials: {
      url: process.env.DATABASE_URL!,
    },
    verbose: true,
    strict: true,
  };
}
