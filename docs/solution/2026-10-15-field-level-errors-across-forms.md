# 字段级错误铺到四个实体表单 —— 以及我上一轮接线里的一处静默失败（#92 余下）

> 日期：2026-10-15
> 来源：**#92**（"用新错误码做 UI 字段级提示"的余下部分：角色 / 权限 / 部门 / 客户端）
> 关联：#82（接通专属码）、`2026-10-14-consumed-error-codes-and-doc-alignment.md`（create-user 路径）
> 词汇：module / interface / seam / leverage / locality

## 一、这一轮做了什么

1. **共享 hook** `src/hooks/use-field-failure.ts`（+ 4 条直测）：四处实体表单的失败处置完全同形
   （"有字段映射 ⇒ 就地显示；否则 ⇒ toast"），写四遍等于把判定复制四份。
2. **接线三处表格**：`RolesTable` / `PermissionsTable` / `DepartmentTree`
   —— 冲突码（`ROLE_ALREADY_EXISTS` / `PERMISSION_ALREADY_EXISTS` / `DEPARTMENT_ALREADY_EXISTS`）
   落到各自表单的**编码输入框**下方，并标 `aria-invalid`；未命中的码仍走 toast。
3. **客户端（clients）不接线**，并给出分类理由：`client_id` 由服务端生成、创建表单不采集它
   ⇒ `CLIENT_ALREADY_EXISTS` 无法归属到任何输入框（见 §二）。

## 二、⚠️ 找到并修掉我自己上一轮引入的**静默失败**

上一轮（create-user 路径）我写了"有映射就就地显示、否则 toast"：
`if (!fieldForErrorCode(code)) toast.error(...)`。

问题：`MOBILE_ALREADY_EXISTS` **有**映射（`mobile`），但**创建用户表单没有 mobile 输入框**
（实测：该表单只有 name/username/email/password）⇒ 内联无处渲染、toast 又被跳过 ⇒
**这个错误对用户完全不可见**。这与"服务端给了可判别的原因、客户端却不显示"一样糟。

**两层修复**：

1. **hook 接受"本表单渲染了哪些字段"**：`useFieldFailure(['username', 'email', 'password'])`。
   映射存在但**本表单没有那个字段**时，自动回落 toast。
   —— 这是防这类静默失败的**通用**机制（新增表单/新增字段时不会重犯）。
2. **把"无对应字段"变成显式分类**：`CONFLICT_CODES_WITHOUT_FIELD`（每条**必须写理由**）：
   - `MOBILE_ALREADY_EXISTS`：UI 没有任何表单采集 mobile（用户创建/编辑表单都没有该输入框）；
   - `CLIENT_ALREADY_EXISTS`：`client_id` 由服务端生成，创建表单不采集。
   自维护测试随之升级：**每个 `*_ALREADY_EXISTS` 码必须"要么有字段映射、要么在分类表里写明理由"**
   —— 分类必须**完整**，不留"忘了映射"的空档；理由太短也会失败。

## 三、门禁又一次抓到我（这次是 mock 形态）

新增 `use-field-failure.test.ts` 里我写了 `vi.mock('sonner', () => ({ … }))`（**字符串形态**）
⇒ `module-mock-guard` 的全量扫描**当场变红** ✓（它要求类型化 `import()` 形态 + 理由注解）。

正确处置不是"加注解绕开"，而是按既有分类判断：`sonner` 是**外部 UI 原语**
（与已豁免的 `cmdk` 同类）⇒ 加入**两份**豁免清单：
守卫的 `EXEMPT_PREFIXES` + ADR-022 §1 的清单（`docs-claims.test.ts` 断言两份**相等** ✓）。

## 四、顺带的两次自我纠正

- **lint 提醒我加重了既有的行长告警**（`PermissionsTable` 192 → 201、`RolesTable` 159 → 165）——
  把字段级错误从 3 行 JSX 压成 **1 行**，把增长压回 197 / 163（仍属 ADR-019 早已承认的"长度软兜底"类）。
- **`useCallback` 依赖必须是简单表达式**：我第一版写 `[renderedFields.join(',')]` ⇒
  `react-hooks/exhaustive-deps` **报错**（不是告警）⇒ 提到 `fieldsKey` 变量并用它，
  回调内部也改用 `fieldsKey`（否则又报 missing dependency）。

## 五、验证

| 项 | 结果 |
|---|---|
| `pnpm test` | **104 文件 / 856 用例全绿**（+1 文件 4 用例：`use-field-failure`） |
| 新增直测 | hook 4 · error-fields 5（含二分类完整性 + 理由长度）· dashboard-user 3 · permission-sync 10 |
| `pnpm -r typecheck` / `lint` | 4/4 · **0 error**（行长告警为既有类别） |
| 守卫 | `module-mock-guard` 15 用例 + `docs-claims` 3 用例全绿（含两份豁免清单相等） |

## 六、最佳实践（可复用）

1. **"有映射"不等于"本表单有那个字段"。** 前者是全局知识，后者是**局部事实**；
   把局部事实作为参数（`renderedFields`）传进共享逻辑，才不会有"无处渲染、也不弹提示"的静默失败。
2. **分类要么完整、要么由测试强制完整。** "无对应字段"不是例外而是一类；
   让测试断言"每个码都被分类"，漏一个就变红——比"记得加映射"可靠。
3. **新 mock 先问"它属于哪一类"，不要先写注解。** 外部 UI 原语（`sonner`/`cmdk`）走豁免清单；
   生产业务模块走类型化工厂 + 理由注解。分类错了，注解只会把错误固化。
4. **门禁抓住自己时，改的是代码而不是门禁。** 本轮 `module-mock-guard` 拦下我的字符串形态 mock ✓——
   正确反应是把它归入既有豁免类别（并同步两份清单），而不是放宽规则或加豁免注解。
