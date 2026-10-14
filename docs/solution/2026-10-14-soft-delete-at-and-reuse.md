# 软删除的 `deleted_at` 从未被写入 —— 部分唯一索引因此静默失效（#86）

> 日期：2026-10-14
> 来源：**#86**（我在 R30 拆分用户查重时发现的"口径矛盾"）——**核实后诊断被改写**
> 关联 ADR：ADR-014（写路径门面）、#82（唯一违例 → 专属码）
> 词汇：module / interface / seam / leverage / locality

## 一、立案描述 vs 核实后的**真正**根因

立案时我写的是：

> 软删除用户的邮箱无法被新用户使用：**内联查重比 schema 的部分唯一索引更严格**。

**核实后这个描述只对了一半**——真实情况更严重：

| 层 | 事实 |
|---|---|
| 领域层 | `deleteUser`（`domain/user/user.ts:51`）返回 `{ ...user, status: 'DELETED', **deletedAt: Temporal.Now.instant()** }` ✅ 领域层算对了 |
| **写入层** | `deleteUserAction` 只写 `status`：`.set({ status: deleted.status })` ❌ **丢弃了 `deletedAt`** |
| 结果 | `deleted_at` **永远是 NULL** ⇒ `ux_users_email` / `ux_users_mobile`（`WHERE deleted_at IS NULL`）**永不释放任何行** ⇒ "软删除后可复用"的设计意图**完全失效** |
| 内联查重 | 无 `deletedAt` 过滤 ⇒ 与**这个坏状态**口径一致（两边都拒绝）——所以它不是"更严格"，而是**与一个坏实现一致** |

⇒ 部分唯一索引的**条件本身就是意图声明**（`WHERE deleted_at IS NULL` = 删除后释放）；
而实现从不写 `deleted_at`，于是索引静默失效。

## 二、修复（两处 + 为什么安全）

### 1. 删除动作写回**领域映射的整行**

```ts
const deleted = deleteUser(userFromPersistence(row));
await tx.update(schema.users)
  .set(userToUpdateRow(deleted))        // ← 而不是 .set({ status: deleted.status })
  .where(eq(schema.users.id, v.data.id));
```

`userToUpdateRow` 覆盖 name/email/avatarUrl/status/deptId/deletedAt/passwordChangedAt——
其余列取自**刚加载的行**（等值写入）✓，`passwordHash`/`passwordHistory` 不在其中 ✓（不会被误写）。

**安全性先验证再改**：`grep` 确认**没有任何查询按 `deletedAt` 过滤**
（只有 schema 索引与领域映射读它）⇒ 写入它的影响面**仅限那两个部分唯一索引** ✓ 精准。

### 2. 内联查重按**同一口径**过滤

```ts
where: and(
  or(eq(users.username, v.data.username), eq(users.email, v.data.email)),
  isNull(users.deletedAt),               // ← 与部分唯一索引同口径
)
```

**没有削弱用户名保护**：`username` 是**完整**唯一约束（非部分索引）⇒ 软删除用户的用户名
仍会被数据库挡住，并由 #82 接通的唯一违例映射返回 **`USERNAME_ALREADY_EXISTS`** ✓。
即：**内联查重负责"可复用的字段"，DB 约束负责"不可复用的字段"**——两者口径各自明确。

## 三、验证（三条新用例，覆盖两级事实）

| 用例 | 断言 |
|---|---|
| 删除动作**写入 `deletedAt`** | `status = DELETED` **且 `deletedAt !== null`**（此前恒为 NULL） |
| 软删除后**邮箱可被新用户复用** | 新用户创建**成功**（与部分唯一索引同口径） |
| 软删除后**用户名仍不可复用** | 落到 DB 完整唯一约束 ⇒ `USERNAME_ALREADY_EXISTS`（**同时验证 #82 的映射路径**） |

## 四、门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | **98 文件 / 815 用例全绿**（812 → +3） |
| `tsc --noEmit` | 0 错误 |
| `eslint` | 0 error（1 条 warning 既有：`DEPT_ID`） |

## 五、最佳实践（可复用）

1. **「领域层算出的字段被调用方丢弃」是静默缺陷。** `deleteUser` 返回了 `deletedAt`，
   action 只手写 `status`——两者都在类型上合法（更新行字段可选）⇒ **编译器不会提醒**。
   修法不是"记得多写一个字段"，而是**用映射器整行写回领域结果**（`userToUpdateRow(deleted)`）。
2. **部分索引/条件约束的条件就是意图声明。** `WHERE deleted_at IS NULL` 说明"删除后释放"；
   当写入路径从不写该列时，索引会**静默失效**——**看到条件索引，就要去找谁会写那个条件列。**
3. **立案描述也要在实现前复核。** 本票最初写的是"内联查重更严格"，核实时才发现根因在写入路径。
   **证伪自己的立案描述不丢人；带着错误描述去修才丢人。**
4. **改一个字段前先 grep "谁读它"。** 本轮确认无人按 `deletedAt` 过滤 ⇒ 写入它是**精准**变更；
   若有人按它过滤，这次修改就会顺带改变那些查询的行为（必须一并评估）。
