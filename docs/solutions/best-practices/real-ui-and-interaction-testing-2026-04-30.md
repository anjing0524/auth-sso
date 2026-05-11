---
title: Real UI and Interaction Testing and Asset Update
date: 2026-04-30
category: best-practices
module: testing
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - Establishing a new UI testing suite
  - Defining interaction test patterns
  - Verifying complex user flows
tags:
  - ui-testing
  - interaction-tests
  - rbac
  - chrome-devtools-mcp
---

# Real UI and Interaction Testing and Asset Update

## Context
There is a critical need for real UI verification to ensure alignment with the Requirements Traceability Matrix (RTM). Relying solely on unit or backend integration tests is insufficient for visual and interaction validation, and existing screenshots or visual assets can easily become outdated as the application evolves.

## Guidance
To effectively test real UI interactions and update visual assets:
- **Environment Setup:** Ensure backend services and frontends are running reliably, often by backgrounding services before initiating tests.
- **Tooling:** Utilize `chrome-devtools-mcp` to perform real browser interactions, such as clicking, typing, navigating, and evaluating page state.
- **Asset Collection:** Systematically capture screenshots at key interaction points and assertion states to document the UI accurately.
- **Handling Complex UI:** For elements that are difficult to interact with via standard automation (e.g., hidden elements, complex DOM structures, or custom overlays), use `evaluate_script` to trigger events or state changes directly in the browser context.

## Why This Matters
- **Visual Evidence:** Provides concrete visual evidence of RTM compliance and feature completeness.
- **Reliable Verification:** Catches UI/UX regressions, layout shifts, and client-side interaction bugs that non-visual tests might miss.
- **Up-to-date Documentation:** Ensures that visual documentation and PR assets accurately reflect the current state of the application.

## When to Apply
- After significant UI/UX changes or frontend refactoring.
- When implementing new user-facing features that require visual validation.
- Before major releases to ensure visual quality and RTM compliance.

## Examples
- **Screenshot Naming Convention:** Save screenshots systematically using the format `[ID]_[TIMESTAMP].png` (e.g., `REQ-001_1679054321.png`) to map them directly to specific requirements and time of execution.
- **Complex Interactions:** 
  ```javascript
  // Using evaluate_script for tricky clicks
  await mcp_chrome_devtools_evaluate_script({
    function: "() => { document.querySelector('.custom-dropdown-item').click(); }"
  });
  ```

## Related
- **RTM Reference:** `docs/spec/REQUIREMENTS_MATRIX.md` (canonical requirement IDs)
- **Technical Protocol:** `.gemini/skills/ui-tester/SKILL.md` (Browser/Vision audit protocol)
- **Implementation Plan:** `conductor/2026-04-24-001-execute-ui-tests.md` (task context for asset update)
