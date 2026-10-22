# 认知复杂度：一手阈值、独立实证与「弱预测器不能做硬门禁」（#89 结案）

> 日期：2026-10-14
> 来源：**#89**（ADR-019 的"待评估项"）
> 关联 ADR：**ADR-019**（本轮把两处"待评估"改为明确结论）
> 词汇：module / interface / seam / leverage / locality

## 一、ADR-019 原本挂着什么

两处"待评估项"（同一件事的两种表述）：

> **刻意不引入认知复杂度**：需新增 `eslint-plugin-sonarjs`，而其 `recommended` 预设会把
> 几乎所有规则设为 `error`（存量爆噪音），必须逐个手动开启；**且该度量的独立学术验证不完整**。
>
> **改用认知复杂度阈值**：……在**缺一手来源核实推荐阈值前不引数字**，故记为待评估项。

⇒ 两个待答问题：①**阈值的一手来源**是什么？②**独立验证**到底怎么说？

## 二、①一手来源：阈值 15（SonarSource 自己的规则文档）

> Cognitive Complexity is a measure of how hard the control flow of a function is to understand.
> Functions with high Cognitive Complexity will be difficult to maintain.
> **The maximum authorized complexity can be provided. Default is 15.**

来源（一手）：[SonarSource `eslint-plugin-sonarjs` 规则文档](https://raw.githubusercontent.com/SonarSource/eslint-plugin-sonarjs/master/docs/rules/cognitive-complexity.md)

⇒ 数字可引用；**但"默认值"是工具的默认配置，不是"该阈值能区分好坏代码"的证据**。

## 三、②独立验证：**不支持把硬阈值当门禁**

Esposito / Janes / Kilamo / Lenarduzzi，[arXiv:2303.07722](https://arxiv.org/abs/2303.07722)
（216 名 1–4 年经验开发者、12 个不同复杂度水平的 Java 类，盲评可读性）：

> while … McCabe Cyclomatic Complexity and … Cognitive Complexity are **modest predictors**
> for code understandability … they are **not** [predictors] for problem severity.
> … **low complexity measures indicate good understandability, but having either CoC or CyC
> high makes understandability unpredictable.** … there is **no evidence** that CyC or CoC are
> indicators of early-career perceived severity.

⇒ 三条结论直接决定本决策：

1. 两个指标**都只是"中等预测器"**；
2. **任一指标偏高时，可读性反而"不可预测"** —— 也就是说高值并不稳定地对应难读；
3. 对"问题的严重程度"，两者都**没有证据**。

**用一个不可靠的预测器做阻断性门禁，得到的是随机性拦截。**
（另有一篇同题的 JSS 实证论文被付费墙/403 挡住，未能取全文；上面这篇是**开放且直接相关**的独立研究。）

## 四、本仓实测：现有信号里已有"真信号"与"噪音"两类

portal 当时共 **19 条**复杂度类告警（`eslint . -f json` 精确清单），逐条分类：

| 规则 | 条数 | 性质 |
|---|---|---|
| `complexity` | 5 | **多为并列分支的产物**：`seedTestData` 的 21 来自 10 余个并列 `if (data.x?.length)`；`register/route.ts` 的 29 来自一串参数校验 |
| `max-depth` | 4 | **真信号**：`vitest.globalSetup` 5–6 层嵌套、`signing-keys.ts`、`migrate.ts` |
| `max-lines-per-function` | 10 | **长度≠控制流**：几乎全是 JSX 组件（`UserTable` 170、`ClientsTable` 178、`audit-logs/page` 210…） |

**对照点**：`src/lib/auth/guard.ts` 的 `withAuth` —— 嵌套 `try/catch` + 两处**重复的错误映射**，
现有规则**零告警**（`complexity` < 15、`max-depth` ≤ 4）。它说明现有规则确有盲点；
但按认知复杂度的规则估算其分值约 **8**（< 15）⇒ **阈值 15 也不会标出它**，
即"引入后本仓大概率**零告警**"。

⇒ 现有组合已覆盖"嵌套"（`max-depth`）与"分支总量"（`complexity`）；
再叠一个**弱预测力**的指标，**噪音增量大于信息增量**。

## 五、环境限制（如实记录）

本机 `pnpm add eslint-plugin-sonarjs` **失败**：

```
ERR_PNPM_EROFS  Failed to add tarball … to store: EROFS: read-only file system
```

（沙箱把 pnpm store 挂为只读，且该包不在本地 store 中。）⇒ 即便要引入，
也**无法在本环境证明"它会失败"**——而本仓库对每个门禁的要求恰恰是**先证明它会红**。
**无法验证的引入不该做。**

## 六、决策（ADR-019 已改为明确结论）

| 项 | 结论 |
|---|---|
| 引入 `sonarjs/cognitive-complexity` 作为**门禁** | **不引入**（弱预测器 + 噪音增量 + 无法验证） |
| 采纳其**判据**用于**人工评审** | **采纳**：嵌套、流程中断、嵌套中的逻辑运算符——低值说明易读（这一半有证据），**高值只作为提问起点** |
| 重新评估的**触发条件** | 出现 **≥3 层嵌套且混杂多分支**的函数，或出现归因于"难读"的线上事故；届时验收判据是**先证明该规则在本仓真会红** |

⇒ ADR-019 中两处"待评估项"均**结案**（不再挂账），并保留原文让读者看到演进。

## 七、最佳实践（可复用）

1. **一手来源给你数字，独立实证给你可信度。** 厂商文档说"默认 15"是**配置事实**；
   能不能把它当门禁，要问独立研究（本例：**不能**）。**两者缺一不可。**
2. **弱预测器不能做硬门禁。** 当"高值 ⇒ 结果不可预测"时，阈值拦截近似随机——
   这比没有门禁更消耗信任（人们会开始绕过它）。
3. **结案要写"重新评估的触发条件"，而不是"待评估"永久挂账。** 后者会让文档看起来
   永远有未决事项，且没人认领（与 #88 的"另立 effort"同一课题）。
4. **本仓实测要分类，而不是只数条数。** "19 条告警"没有信息量；
   "其中 4 条是真嵌套、10 条是 JSX 长度、5 条是并列分支"才能支撑决策。
5. **无法验证的引入不做。** 与"每个门禁都要证明会失败"一致：
   装不上、验不了的规则，即使理论上有价值，也不该进配置。
