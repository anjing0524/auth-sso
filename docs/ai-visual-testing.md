# AI 视觉探索性测试（Midscene 试点）

## 定位

**非阻断、探索性、补充性。** 现有 `tests/e2e/` 的确定性测试仍是发布门禁；Midscene 不替代：

- 权限/认证状态机、API 契约、数据库写入；
- 已能用稳定 locator 表达的核心回归；
- 任何安全边界。

AI 视觉测试只回答一个问题：**用户看到的界面是否仍然语义正确、布局可读。**

## 技术基线

- `@midscene/web@1.17.6`（devDependency）
- Playwright `PlaywrightAiFixture`
- 模型：DSH 配置的 DeepSeek `deepseek-flash`（视觉）
- 桌面 1440×900，Docker 验收栈
- 配置：`tests/e2e-ai/playwright.config.ts`

## 运行

先启动验收栈：

```bash
docker compose -f docker/compose/test.yml up -d --wait --wait-timeout 600 \
  postgres redis cert-init db-init portal gateway
```

运行：

```bash
pnpm test:ai
```

运行脚本 `scripts/e2e-ai/run.sh` 会：

1. 优先使用 `MIDSCENE_MODEL_API_KEY`；
2. 未设置时从本机 DSH 的 `~/.dsh/.credentials.yaml` 读取 `DEEPSEEK_API_KEY`；
3. 默认模型：

```text
MIDSCENE_MODEL_BASE_URL=https://api.deepseek.com
MIDSCENE_MODEL_NAME=deepseek-flash
MIDSCENE_MODEL_FAMILY=deepseek
```

没有密钥时直接 skip，exit 0。

## 三个试点

| 文件 | 覆盖 |
|---|---|
| `tests/e2e-ai/login-dashboard.spec.ts` | 登录后的工作台语义/主要区域 |
| `tests/e2e-ai/users-list.spec.ts` | 用户列表、新建用户页面字段完整性 |
| `tests/e2e-ai/audit-layout.spec.ts` | 审计日志页签、筛选和表格层级 |

确定性登录/导航作为场景准备；AI 只负责视觉断言，避免把已确定的交互变成概率测试。

## 本地结果（2026-11-06）

- 首次修 prompt 后连续 3 次：**3/3 passed**
- 单次约 **13–17s**
- 使用 DSH DeepSeek key；报告/日志在 `midscene_run/`（已 gitignore）
- 未发现密钥写入报告

## 隐私与成本

Midscene 会把截图发送到配置的模型服务商。当前只对 **Docker 验收栈的合成测试数据**运行；
禁止把真实客户页面/数据接到外部模型。报告含截图，只作为本地调试产物，不提交、不默认上传 CI artifact。

## CI 边界

当前**不进入** `main.yml` / 验收 workflow：

- 模型服务波动不应阻塞发布；
- 需要 API Key、费用预算与数据合规确认；
- 需要更多稳定性样本后才能评估 nightly。

试点晋级条件：

- 连续 20 次通过率 ≥ 90%；
- p95 ≤ 2 分钟/次；
- 至少发现 1 个现有确定性测试未覆盖的真实 UI 问题；
- 无敏感数据外发；
- 仍不阻断 PR，最多 nightly。
