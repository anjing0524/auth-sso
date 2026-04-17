---
title: Futures Contract Full-Level Order Book Visualization Engine
type: feat
status: complete
date: 2026-04-08
origin: docs/brainstorms/2026-04-08-customer-graph-visualization-requirements.md
deepened: 2026-04-08
---

# Futures Contract Full-Level Order Book Visualization Engine

## Overview

Build a GPU-accelerated visualization engine for futures contract full-level order books (Market-by-Order) using Rust + wgpu + WebGPU + WASM. The system renders a Left-Center-Right layout: the center column displays price node blocks, the left column displays individual ask (sell) order blocks at each price, and the right column displays individual bid (buy) order blocks. All blocks have fixed dimensions, with the order volume rendered as numeric text inside the block. Layout is calculated via direct mapping, without physics/force simulations.

## Problem Frame

金融交易领域需要直观展示期货合约的全档位订单簿（MBO数据）。核心挑战在于要在左中右布局中渲染可能高达数万个独立的订单方块并显示内部数字，这对传统 DOM/Canvas 是巨大的性能挑战。采用 WebGPU Instanced Rendering 是唯一能确保 60 FPS 流畅滚动和高频刷新的技术方案。

## Requirements Trace

- R1-R2: 核心可视化布局（左侧卖单、中间价格、右侧买单）与海量渲染能力。
- R3: 视觉编码（固定尺寸，内部文本显示数量，颜色映射挂单时间）。
- R4-R7: 交互功能（核心：垂直滚动、横向平移/缩放、悬停高亮详情、价格定位）。
- R8-R9: 性能约束（Instanced Rendering 处理方块和位图文字）。
- R10-R11: 数据与认证（API 获取，SSO 认证）。
- R12-R13: 状态处理（WebGPU降级，空数据状态）。

## Scope Boundaries

- 当前不接入真实 WebSocket 高频流，先使用静态 API 快照。
- 纯展示视图，不包含交易操作。
- 不实现 WebGL 降级（仅支持 WebGPU 浏览器）。

## Context & Research

### Relevant Code and Patterns

**IdP Trusted Client Pattern** (`apps/idp/src/lib/auth.ts`):
```typescript
trustedClients: [
  { clientId: 'portal', clientSecret: process.env.PORTAL_CLIENT_SECRET, ... },
  { clientId: 'customer-graph', clientSecret: process.env.CUSTOMER_GRAPH_CLIENT_SECRET, ... },
]
```

**Next.js 16 Route Handler Pattern**:
- `params` must be `Promise<{ id: string }>` and awaited

### External References

- wgpu Instanced Drawing: https://sotrh.github.io/learn-wgpu/beginner/tutorial7-instancing/
- Bitmap Font Rendering in wgpu for instanced numbers.

## Key Technical Decisions

1. **Rust crate location**: `wasm-engine/` at repo root.
2. **Data Structure & Direct Layout**: No force simulation. `X` and `Y` positions are computed directly based on price tick and order queue index.
3. **Fixed Size & Text Rendering**: Order blocks are fixed in size. Volume numbers are rendered using a Texture Atlas (Bitmap Font) within the shader or via an additional instanced text quad pass.
4. **Layout Logic**:
   - Y-axis represents Price (continuous ticks).
   - Center column holds price blocks (X = 0).
   - Left column (Asks) blocks grow towards -X direction based on queue index.
   - Right column (Bids) blocks grow towards +X direction based on queue index.

## High-Level Technical Design

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (WebGPU)                          │
├─────────────────────────────────────────────────────────────────┤
│  Next.js App (apps/customer-graph)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ React UI    │  │ API Routes  │  │ WASM Loader            │ │
│  │ - Canvas    │  │ /api/orderbk│  │ orderbook_engine.js    │ │
│  │ - Controls  │  │ /api/auth   │  │ orderbook_engine_bg.w..│ │
│  └──────┬──────┘  └─────────────┘  └───────────┬─────────────┘ │
│         │                                                 │       │
│         ▼                                                 ▼       │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │              WASM Engine (Rust + wgpu)                      │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │ │
│  │  │ Layout Calc │  │ Renderer    │  │ Interaction        │ │ │
│  │  │ - Direct Map│  │ - Block Quad│  │ - Vertical Scroll │ │ │
│  │  │ - X/Y Offset│  │ - Text Atlas│  │ - Hit Testing     │ │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Units

### Phase 1: WASM Engine Core (Order Book)

- [ ] **Unit 1.1: Rust Data Structures & Direct Layout Algorithm**
**Goal:** Define efficient data structures and direct coordinate mapping.
**Approach:** Define `OrderBlock { id, price_tick, queue_index, volume, timestamp, is_ask }`. Provide function `compute_layout()` that traverses the MBO data and directly maps `price_tick` to `y` coordinate, and `queue_index` to `x` coordinate using fixed block widths and padding.

- [ ] **Unit 1.2: GPU Instanced Rendering for Blocks**
**Goal:** Implement wgpu render pipeline for fixed-size rectangles.
**Approach:** Single vertex buffer for a quad. Instance buffer containing `[pos_x, pos_y, color]`. Shader translates the quad per instance.

- [ ] **Unit 1.3: GPU Text Rendering for Order Volume**
**Goal:** Render the numeric volume inside each block.
**Approach:** Load a sprite sheet / texture atlas containing digits 0-9. Create an instanced pipeline for text. Each digit is rendered as an instanced quad mapped to the appropriate texture UV coordinates.

- [ ] **Unit 1.4: Interaction Handling (Scroll & Hit Testing)**
**Goal:** Allow vertical scrolling (Y-axis panning) and hovering.
**Approach:** Update camera uniform buffer on mouse wheel (pan Y). Map mouse coords to world space and use direct arithmetic (since positions are grid-based) to identify the hovered block in O(1) or O(log N) time.

- [ ] **Unit 1.5: WASM-JavaScript Bridge**
**Goal:** Export API for React.
**Approach:** Export `load_orderbook(data)`, `on_scroll(dy)`, `get_hovered_order(x, y)`.

### Phase 2: Next.js Frontend

- [ ] **Unit 2.1: Adjust App Components for Order Book**
**Goal:** Refactor components from "graph" to "order book".
**Approach:** Update canvas wrapper. Map scroll events to WASM pan functions. Update layout controls.

- [ ] **Unit 2.2: Order Detail Panel**
**Goal:** Show order details on hover.
**Approach:** Display Order ID, Price, Volume, Time, Side.

- [ ] **Unit 2.3: Data Proxy API**
**Goal:** Serve MBO mock data.
**Approach:** Endpoint `/api/futures/orderbook` returning structured JSON with tick size, prices, asks, and bids.
