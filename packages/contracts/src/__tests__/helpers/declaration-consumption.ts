/**
 * "声明 ↔ 消费"守卫的共享脚手架。
 *
 * 两个守卫（`audit-operation-emission` / `gateway-header-emission`）是**同一条规则的两个实例**：
 * 「每个声明的值要么被生产代码消费、要么被显式列为保留」。2026-10-16 两轴评审指出两处
 * 各自复制了 `classify` 与"生产代码视图"，且口径还一度不一致（一个去注释、一个不去）
 * ⇒ 收到这里一份，避免同类规则再次分叉。
 */

/** 四分区由 (是否被生产代码消费, 是否声明为保留) 决定；只有两种组合合法 */
export function classify(
  consumed: boolean,
  reserved: boolean,
): 'consumed' | 'reserved' | 'gap' | 'stale-reservation' {
  if (consumed && reserved) return 'stale-reservation';
  if (reserved) return 'reserved';
  if (consumed) return 'consumed';
  return 'gap';
}

/**
 * TS/TSX 生产代码视图：去掉块注释（含 JSDoc）与行注释。
 *
 * 为什么必须去注释：直接 `src.includes(x)` 会让**注释里的提及**被算成消费/发射
 * （假红与假绿各一次，实测过）。
 */
export function productionTsText(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/**
 * Rust 生产代码视图：去掉 `//` 注释，并**只**截掉文件末尾的 `#[cfg(test)] mod tests { … }`。
 *
 * ## 为什么不能用 `raw.split('#[cfg(test)]')[0]`
 *
 * 那会在**首个**标记处截断。而 `#[cfg(test)]` 也可能出现在文件**中部**（仅标注测试专用
 * 辅助），例如 `apps/gateway/src/auth/verify.rs` 第 85 行的 `new_without_revocation_for_test`
 * —— 其后还有上百行生产代码，`split` 会把它们一并漏扫，于是"缝后真的消费了保留值"这种
 * 情况**静默放行**（2026-10-16 两轴评审发现）。
 *
 * 残留局限（已知、如实记录）：中部被 `#[cfg(test)]` 标注的辅助函数体仍会被扫到，理论上
 * 可能把"测试辅助里的提及"算成消费。当前网关无此形状；若将来出现，应改为按 item 剔除。
 */
export function productionRustText(raw: string): string {
  const withoutTrailingTestModule = raw.replace(
    /\n#\[cfg\(test\)\]\s*\nmod tests\s*\{[\s\S]*$/,
    '',
  );
  return withoutTrailingTestModule
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}
