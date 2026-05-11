# UI 自动化测试与完整性分析 Skill

该 Skill 旨在通过真实浏览器驱动，按需求编号执行端到端 UI 测试，自动保留截图，并最终利用大模型的视觉能力对系统功能的完整性进行客观评价。

## 核心价值
- **所见即所得**：不只是断言 API，而是验证真实用户看到的界面。
- **需求对齐**：每一张截图都与 `docs/test-cases.md` 中的 ID 一一对应。
- **自动分析**：利用 Vision 能力自动识别 UI 遗漏，减少人工核对成本。

## 工作流程

### 1. 任务解析
- 读取 `docs/test-cases.md`。
- 提取测试编号（如 `AUTH-001`, `PERM-010`）及其对应的测试步骤和预期结果。

### 2. 自动化执行 (Act)
- 使用 `agent-browser` 或 `chrome-devtools` 相关工具。
- **导航**：进入目标 URL（如 http://localhost:4000）。
- **交互**：模拟登录、点击菜单、勾选权限、保存等操作。
- **截图**：在每个测试项的关键预期结果达成点，调用 `mcp_chrome-devtools_take_screenshot`。
- **存储**：将截图保存至 `tests/screenshots/{ID}_{TIMESTAMP}.png`。

### 3. 功能完整性分析 (Analyze)
- 在所有测试执行完毕后，聚合所有截图。
- 采用以下 Prompt 范式进行视觉分析：
  > "请作为一名资深 QA 审计员。对比需求描述 {REQUIREMENT_DESC} 和这张实际系统截图 {SCREENSHOT_PATH}。
  > 请指出：
  > 1. 界面元素是否完整（如按钮、标签、颜色是否符合 DESIGN.md）。
  > 2. 功能逻辑是否通过视觉反馈得以证实。
  > 3. 是否存在任何 AI 模板痕迹或未对齐的设计规范。"

### 4. 报告生成
- 生成 `tests/verification/completeness-report.md`。
- 包含：测试项汇总表、截图缩略图引用、每个项的通过/失败结论、总体功能完整性评分 (0-100)。

## 工具链要求
- **Browser**: 需要 headless 或 headed 浏览器环境。
- **Vision Model**: 需要具备识别中文字符、布局结构和视觉规范的能力。

## 使用示例
> "调用 ui-tester 技能，执行 PERM 开头的所有测试，并生成完整性报告。"
