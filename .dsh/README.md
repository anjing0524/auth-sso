# `.dsh` — DSH 运行时资产

本目录只放 **DSH（DeepSeek Harness）原生发现**的资产，不放项目事实与架构决策：

| 路径 | 用途 |
|---|---|
| `skills/<name>/SKILL.md` | 任务级技能，DSH 项目级发现目录（rank 100）；会话目录只展示名称与描述，正文按需加载 |
| `skills/<name>/references/` | 技能参考材料（渐进披露，正文只留执行所需） |
| `skills/<name>/scripts/` | 技能附带脚本（如只读审计编排） |

治理规范：**技能格式、路由、生命周期与守卫台账标准**唯一出处是 `docs/agent-governance.md`；项目事实在 `AGENTS.md`，架构决策在 `docs/adr/`。技能正文不复制这些内容。

新增、修改或删除技能后，验证命令与门槛见 `docs/agent-governance.md` §七。
