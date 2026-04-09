---
title: Customer Relationship Graph Visualization Engine
type: feat
status: complete
date: 2026-04-08
origin: docs/brainstorms/2026-04-08-customer-graph-visualization-requirements.md
deepened: 2026-04-08
---

# Customer Relationship Graph Visualization Engine

## Overview

Build a GPU-accelerated customer relationship graph visualization engine using Rust + wgpu + WebGPU + WASM. The system renders 10,000+ nodes and edges with force-directed layout computed on GPU via Compute Shaders. A new Next.js app (`apps/customer-graph`) provides the frontend, integrating with existing IdP SSO for authentication.

## Problem Frame

企业需要直观展示客户之间的关联关系图谱。大图可视化的核心挑战不是渲染性能，而是**可理解性**——需要聚类、过滤、渐进式披露来辅助理解。选择 Rust/WASM/WebGPU 方案是为了 GPU Compute Shader 的真正并行计算能力，以及未来扩展到 100K+ 节点的可能性。

## Requirements Trace

- R1-R4: 核心可视化（GPU 力导向布局）
- R5-R8: 可理解性（聚类、渐进式披露、视觉编码）
- R9-R13: 交互功能（拖动、缩放、搜索、过滤）
- R14-R17: 性能约束（GPU 计算、O(n) 加速、60 FPS）
- R18-R20: 数据与认证（外部 API、IdP SSO）
- R21-R24: 状态处理（加载、错误、空状态）
- R25-R27: 部署（Next.js + WASM + Vercel）

## Scope Boundaries

- 不实现边的动态样式或权重可视化
- 不支持实时数据推送更新
- 不实现图编辑功能
- 不支持移动端触摸交互
- 不实现 WebGL 降级（WebGPU 浏览器仅支持 Chrome/Edge）
- 不实现键盘无障碍导航（后续迭代）

## Context & Research

### Relevant Code and Patterns

**IdP Trusted Client Pattern** (`apps/idp/src/lib/auth.ts`):
```typescript
trustedClients: [
  { clientId: 'portal', clientSecret: process.env.PORTAL_CLIENT_SECRET, ... },
  { clientId: 'demo-app', clientSecret: process.env.DEMO_APP_CLIENT_SECRET, ... },
]
```
需要添加 `customer-graph` 作为新的 trusted client。

**OAuth Client Pattern** (`apps/portal/src/lib/auth-client.ts`):
- PKCE flow with `generateCodeVerifier()`, `generateCodeChallenge()`, `generateState()`, `generateNonce()`
- Session management in Redis

**Next.js 16 Route Handler Pattern**:
- `params` must be `Promise<{ id: string }>` and awaited
- `vercel.json` with `installCommand: "cd ../.. && pnpm install --no-frozen-lockfile"`

### External References

- wgpu Compute Pipeline: https://sotrh.github.io/learn-wgpu/compute/introduction
- wasm-pack Build: `wasm-pack build --target web`
- Vercel Rust Support: Requires custom build configuration (no built-in Rust toolchain)

### Institutional Learnings

- **Vercel Deployment**: Deploy from workspace root, use `installCommand` in vercel.json
- **Environment Variables**: Always `.trim()` URL/ID env vars to remove hidden newlines
- **SSO Integration**: Full PKCE flow with state/nonce/code_verifier validation

## Key Technical Decisions

1. **Rust crate location**: `wasm-engine/` at repo root (not in `apps/`) — separates Rust toolchain from Node.js workspace
2. **WASM-JS Bridge**: `wasm-bindgen` with `--target web` for direct ES module import
3. **GPU Architecture**: Compute Shader for force-directed layout + Instanced Rendering for node/edge drawing
4. **Vercel Build**: Pre-compile WASM in CI, include in Next.js `public/wasm/` — avoids Rust toolchain in Vercel
5. **SSO Integration**: Register as new trusted client, reuse Portal's OAuth patterns
6. **Graph Data Structure**: Dual-layer approach — `petgraph::Graph` for CPU-side operations (neighbor queries, search/filter), GPU-aligned `NodeData`/`EdgeData` structs for Storage Buffer transfer

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (WebGPU)                          │
├─────────────────────────────────────────────────────────────────┤
│  Next.js App (apps/customer-graph)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ React UI    │  │ API Routes  │  │ WASM Loader            │ │
│  │ - Canvas    │  │ /api/graph  │  │ graph_engine.js        │ │
│  │ - Search    │  │ /api/auth   │  │ graph_engine_bg.wasm   │ │
│  │ - Filter    │  └─────────────┘  └───────────┬─────────────┘ │
│  └──────┬──────┘                                          │       │
│         │                                                 │       │
│         ▼                                                 ▼       │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │              WASM Engine (Rust + wgpu)                      │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │ │
│  │  │ Simulation  │  │ Renderer    │  │ Interaction        │ │ │
│  │  │ - Force     │  │ - Pipeline  │  │ - Hit Testing     │ │ │
│  │  │ - Collision │  │ - Shader    │  │ - Drag/Zoom       │ │ │
│  │  │ - Grid      │  │ - Instance  │  │                   │ │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  WebGPU Device  │
                    │  - Compute Pass │
                    │  - Render Pass  │
                    └─────────────────┘
```

**Data Flow:**
1. Next.js fetches data from external API (server-side proxy)
2. Data passed to WASM engine via `wasm-bindgen` functions
3. WASM uploads node/edge data to GPU Storage Buffers
4. Compute Shader runs force simulation in parallel
5. Render Pass draws nodes/edges via Instanced Rendering
6. User interactions (drag/zoom) update GPU buffers and trigger re-render

## Implementation Units

### Phase 0: Prerequisites

- [ ] **Unit 0.1: Add Permission Codes to Contracts**

**Goal:** Define permission codes for customer graph access in shared contracts package.

**Requirements:** R19 (RBAC permissions)

**Dependencies:** None

**Files:**
- Modify: `packages/contracts/src/permissions.ts`

**Approach:**
- Add `CUSTOMER_GRAPH_VIEW = 'customer_graph:view'` permission code
- Add `CUSTOMER_GRAPH_EXPORT = 'customer_graph:export'` permission code
- Export from package index

**Test scenarios:**
- Happy path: Permission codes are importable from `@auth-sso/contracts`
- Integration: IdP and Portal can reference new codes

**Verification:**
- `pnpm --filter @auth-sso/contracts build` succeeds
- Types available to dependent apps

---

### Phase 1: WASM Engine Core

- [ ] **Unit 1.1: Rust Project Scaffolding**

**Goal:** Initialize Rust crate with wgpu and wasm-bindgen dependencies.

**Requirements:** R25, R26

**Dependencies:** None

**Files:**
- Create: `wasm-engine/Cargo.toml`
- Create: `wasm-engine/src/lib.rs`
- Create: `wasm-engine/src/data/node.rs` (GPU-aligned `NodeData` struct)
- Create: `wasm-engine/src/data/edge.rs` (GPU-aligned `EdgeData` struct)
- Create: `wasm-engine/src/data/graph_store.rs` (CPU-side `petgraph::Graph` wrapper)

**Approach:**
- Use `cargo new --lib wasm-engine`
- Add dependencies: `wgpu`, `wasm-bindgen`, `serde`, `serde-wasm-bindgen`, `petgraph`
- Configure `crate-type = ["cdylib"]` for WASM output
- Use `petgraph::Graph` for CPU-side graph structure (neighbor queries, data loading, search/filter)
- Define GPU-aligned structs (`NodeData`, `EdgeData`) for Storage Buffer transfer, separate from petgraph types

**Test scenarios:**
- Happy path: `cargo build --target wasm32-unknown-unknown` succeeds
- Happy path: petgraph neighbor query returns correct nodes
- Edge case: Struct size verification with `std::mem::size_of`

**Verification:**
- Cargo.toml includes all required dependencies including `petgraph`
- `cargo check` passes without errors
- GPU-aligned structs have no padding issues
- petgraph integration compiles correctly

---

- [ ] **Unit 1.2: GPU Context Initialization**

**Goal:** Initialize WebGPU device, queue, and canvas surface.

**Requirements:** R14

**Dependencies:** Unit 1.1

**Files:**
- Create: `wasm-engine/src/renderer/context.rs`
- Create: `wasm-engine/src/renderer/buffer.rs`

**Approach:**
- Create `GpuContext` struct holding device, queue, surface
- Implement `GpuContext::new(canvas: HtmlCanvasElement)` for WASM
- Enable `wgpu::Features::all_webgpu_mask()` for compute shaders
- Create Storage Buffers for nodes and edges

**Test scenarios:**
- Happy path: GPU context initializes successfully on WebGPU browser
- Error path: Graceful error when WebGPU unavailable
- Edge case: Handle device loss with re-initialization path

**Verification:**
- GPU context can be created from JavaScript
- Storage buffers are allocated with correct sizes

---

- [ ] **Unit 1.3: Force-Directed Layout (Compute Shader)**

**Goal:** Implement GPU compute shader for force-directed graph layout.

**Requirements:** R2, R3, R14, R15

**Dependencies:** Unit 1.2

**Files:**
- Create: `wasm-engine/src/simulation/force.rs`
- Create: `wasm-engine/src/simulation/collision.rs`
- Create: `wasm-engine/src/simulation/grid.rs`
- Create: `wasm-engine/src/simulation/physics.rs`
- Create: `wasm-engine/shaders/force.wgsl`

**Approach:**
- Implement spatial grid acceleration in WGSL compute shader
- Attraction force: edges pull connected nodes
- Repulsion force: spatial grid O(n) calculation
- Collision: sphere-based push-out when overlapping
- Damping: velocity decay each iteration

**Technical design (WGSL pseudocode):**
```wgsl
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let node_idx = id.x;
  // 1. Calculate attraction from edges
  // 2. Calculate repulsion from spatial grid neighbors
  // 3. Calculate collision push-out
  // 4. Update velocity with damping
  // 5. Update position
}
```

**Test scenarios:**
- Happy path: 10K nodes converge to stable layout in <5s
- Edge case: Sparse graph (few edges) spreads evenly
- Edge case: Dense graph (many edges) clusters correctly
- Performance: GPU timing shows <1ms per iteration

**Verification:**
- Layout simulation runs at 60 FPS
- Nodes do not overlap after convergence
- Spatial grid correctly partitions space

---

- [ ] **Unit 1.4: Instanced Rendering Pipeline**

**Goal:** Render all nodes and edges with minimal draw calls.

**Requirements:** R1, R7, R16

**Dependencies:** Unit 1.2, Unit 1.3

**Files:**
- Create: `wasm-engine/src/renderer/pipeline.rs`
- Create: `wasm-engine/src/renderer/shader.wgsl`
- Create: `wasm-engine/src/renderer/instance.rs`

**Approach:**
- Create render pipeline with vertex/fragment shaders
- Use instanced drawing: one draw call for all nodes
- Instance data: position, size, color (derived from degree/type)
- Edges: Line List or separate instance buffer

**Test scenarios:**
- Happy path: 10K nodes render in single draw call
- Happy path: 10K edges render correctly
- Edge case: Node colors match degree/type encoding
- Performance: Frame time <16ms for 20K total primitives

**Verification:**
- Canvas displays nodes with correct visual encoding
- Performance metrics show 60 FPS
- GPU profiler confirms single draw call per frame

---

- [ ] **Unit 1.5: Interaction Handling (Drag, Zoom, Hit Testing)**

**Goal:** Enable user interactions with GPU-rendered graph.

**Requirements:** R9, R10, R11

**Dependencies:** Unit 1.3, Unit 1.4

**Files:**
- Create: `wasm-engine/src/interaction/drag.rs`
- Create: `wasm-engine/src/interaction/zoom.rs`
- Create: `wasm-engine/src/interaction/hit.rs`

**Approach:**
- Hit testing: transform mouse coords to world space, check node bounds
- Drag: update single node position, re-run partial simulation
- Zoom/pan: modify camera uniform buffer, no re-simulation needed
- Hover detection: return node ID for detail panel

**Test scenarios:**
- Happy path: Click on node returns correct node ID
- Happy path: Drag node moves it and updates layout
- Happy path: Zoom/pan works smoothly
- Edge case: Click on empty space returns null

**Verification:**
- Mouse interactions respond in <16ms
- Dragged node moves smoothly
- Zoom/pan preserves node positions

---

- [ ] **Unit 1.6: WASM-JavaScript Bridge**

**Goal:** Export clean JavaScript API from WASM module with secure memory management.

**Requirements:** R9, R13

**Dependencies:** Unit 1.1 - 1.5

**Files:**
- Modify: `wasm-engine/src/lib.rs`
- Create: `wasm-engine/src/api.rs`

**Approach:**
- Export functions: `init_graph(canvas, nodes, edges)`, `step_simulation()`, `render()`, `set_viewport()`, `get_hovered_node(x, y)`, `drag_node(id, x, y)`, `destroy()`
- Use `serde-wasm-bindgen` for efficient data transfer
- Return node positions for search/highlight integration
- **Security**: Implement `destroy()` to securely clear WASM memory and free GPU resources

**Technical design (memory cleanup):**
```rust
#[wasm_bindgen]
impl GraphEngine {
    /// 安全释放所有资源，防止数据残留
    pub fn destroy(&mut self) {
        // 1. 清零敏感数据
        for node in &mut self.data.nodes {
            node.label.zero_out();
        }
        // 2. 释放 GPU 资源
        self.gpu_context.destroy();
        // 3. 清空集合
        self.data.nodes.clear();
        self.data.edges.clear();
    }
}
```

**Test scenarios:**
- Happy path: JavaScript can initialize graph with 10K nodes
- Happy path: JavaScript can call simulation step
- Happy path: JavaScript can query hovered node
- **Security**: Memory is zeroed after `destroy()` call
- Performance: Data transfer overhead <1ms

**Verification:**
- TypeScript type definitions generated
- JavaScript can call all exported functions
- `destroy()` properly cleans up all resources
- No memory leaks after multiple init/destroy cycles

---

### Phase 2: Next.js Frontend

- [ ] **Unit 2.1: Next.js App Scaffolding**

**Goal:** Create new Next.js app in monorepo with Tailwind and shared packages.

**Requirements:** R25

**Dependencies:** None

**Files:**
- Create: `apps/customer-graph/package.json`
- Create: `apps/customer-graph/next.config.ts`
- Create: `apps/customer-graph/tsconfig.json`
- Create: `apps/customer-graph/tailwind.config.ts`
- Create: `apps/customer-graph/src/app/layout.tsx`
- Create: `apps/customer-graph/src/app/globals.css`
- Create: `apps/customer-graph/.env.example`

**Approach:**
- Follow `apps/portal` structure
- Extend `@auth-sso/config/typescript`
- Configure Tailwind 4.x
- Set up environment variable templates
- **Security**: Configure CSP headers to allow WASM loading (`script-src: 'self' blob:; worker-src: 'self' blob:; connect-src: 'self'`)

**Test scenarios:**
- Happy path: `pnpm dev` starts app on port 4003
- Happy path: Shared types from `@auth-sso/contracts` are accessible
- **Security**: CSP headers allow WASM blob URLs
- Edge case: Build succeeds with no TypeScript errors

**Verification:**
- App runs locally with `pnpm --filter @auth-sso/customer-graph dev`
- Tailwind classes work correctly
- TypeScript strict mode passes
- CSP headers correctly configured in `next.config.ts`

---

- [ ] **Unit 2.2: WASM Loader Component**

**Goal:** Load and initialize WASM engine with progress indication.

**Requirements:** R21, R22

**Dependencies:** Unit 1.6, Unit 2.1

**Files:**
- Create: `apps/customer-graph/src/lib/wasm-loader.ts`
- Create: `apps/customer-graph/src/lib/webgpu-check.ts`
- Create: `apps/customer-graph/src/components/WasmLoader.tsx`
- Create: `apps/customer-graph/src/components/WebGPUNotSupported.tsx`

**Approach:**
- Check WebGPU support first, show fallback if unsupported
- Dynamic import of WASM module
- Progress tracking for loading states
- Error boundary for WASM load failures

**Test scenarios:**
- Happy path: WASM loads successfully on WebGPU browser
- Error path: Shows fallback when WebGPU unavailable
- Error path: Shows error when WASM fails to load
- Edge case: Handles slow WASM load with progress indicator

**Verification:**
- WebGPU check correctly identifies supported browsers
- WASM loader shows progress during initialization
- Error states are user-friendly

---

- [ ] **Unit 2.3: Graph Canvas Component**

**Goal:** React component that hosts WASM-powered WebGPU canvas.

**Requirements:** R1, R9, R10

**Dependencies:** Unit 2.2

**Files:**
- Create: `apps/customer-graph/src/components/GraphCanvas.tsx`
- Create: `apps/customer-graph/src/hooks/useGraphEngine.ts`

**Approach:**
- Canvas element passed to WASM for rendering
- Event listeners for mouse/keyboard input
- Resize observer for responsive canvas sizing
- Request animation frame loop

**Test scenarios:**
- Happy path: Canvas renders graph correctly
- Happy path: Mouse events trigger WASM interactions
- Edge case: Canvas resizes correctly on window resize
- Performance: 60 FPS maintained during interactions

**Verification:**
- Canvas displays graph visualization
- Mouse interactions work correctly
- No memory leaks on component unmount

---

- [ ] **Unit 2.4: Node Detail Panel**

**Goal:** Display node information on hover/click.

**Requirements:** R11

**Dependencies:** Unit 2.3

**Files:**
- Create: `apps/customer-graph/src/components/NodeDetailPanel.tsx`

**Approach:**
- Floating panel positioned near cursor
- Display: customer name, ID, relationship count
- "View Profile" button (URL configurable, currently placeholder)
- Highlight selected node in canvas

**Test scenarios:**
- Happy path: Panel shows correct node details
- Happy path: "View Profile" button is clickable
- Edge case: Panel hides when clicking elsewhere
- Edge case: Panel stays in viewport bounds

**Verification:**
- Panel displays correct data for hovered node
- UI is responsive and accessible

---

- [ ] **Unit 2.5: Search and Filter Components**

**Goal:** Enable node search and subset filtering.

**Requirements:** R12, R13, R24

**Dependencies:** Unit 2.3

**Files:**
- Create: `apps/customer-graph/src/components/SearchFilter.tsx`
- Create: `apps/customer-graph/src/hooks/useSearchFilter.ts`

**Approach:**
- Search input with debounce
- Filter dropdowns for type, relationship count, source
- Pass filtered subset to WASM engine
- Show "no results" state when empty

**Test scenarios:**
- Happy path: Search highlights matching nodes
- Happy path: Filters reduce visible nodes
- Edge case: "No results" shows when no matches
- Edge case: Clear filters restores full graph

**Verification:**
- Search works with fuzzy matching
- Filters correctly subset the graph
- Empty state is clear and actionable

---

### Phase 3: Integration and Authentication

- [ ] **Unit 3.1: IdP Trusted Client Registration**

**Goal:** Register customer-graph as OAuth client in IdP.

**Requirements:** R19

**Dependencies:** None

**Files:**
- Modify: `apps/idp/src/lib/auth.ts`
- Modify: `apps/idp/.env.example`
- Modify: `apps/idp/.env.production.example`

**Approach:**
- Add `customer-graph` to `trustedClients` array
- Set `skipConsent: true` for seamless SSO
- Configure redirect URLs for local and production

**Test scenarios:**
- Happy path: OAuth flow redirects to customer-graph correctly
- Happy path: Session created in IdP for customer-graph
- Edge case: Multiple tabs share same session

**Verification:**
- IdP accepts customer-graph as trusted client
- OAuth callback succeeds

---

- [ ] **Unit 3.2: OAuth Client Implementation**

**Goal:** Implement PKCE OAuth flow in customer-graph.

**Requirements:** R19

**Dependencies:** Unit 2.1, Unit 3.1

**Files:**
- Create: `apps/customer-graph/src/lib/oauth.ts`
- Create: `apps/customer-graph/src/lib/session.ts`
- Create: `apps/customer-graph/src/app/api/auth/callback/route.ts`

**Approach:**
- Follow `apps/portal/src/lib/auth-client.ts` pattern
- Implement `generateCodeVerifier`, `generateCodeChallenge`, `generateState`, `generateNonce`
- Create callback route to exchange code for token
- Validate nonce in id_token
- **Session Key Prefix**: Use `customer_graph:session:` prefix and `customer_graph_session_id` cookie to avoid collision with Portal sessions

**Test scenarios:**
- Happy path: User redirected to IdP for login
- Happy path: Callback exchanges code for token
- Happy path: Session created and stored
- Error path: Invalid state returns error
- Security: Nonce mismatch rejected

**Verification:**
- Full OAuth flow works end-to-end
- Session persists across page reloads
- Security validations pass

---

- [ ] **Unit 3.3: External API Proxy with RBAC**

**Goal:** Proxy external API calls through Next.js with permission and data scope validation.

**Requirements:** R18, R19, R20

**Dependencies:** Unit 3.2, Unit 0.1

**Prerequisite:** Verify external API supports `department_ids` parameter for server-side filtering before implementation. If unsupported, implement client-side filtering (may impact performance for large datasets).

**Files:**
- Create: `apps/customer-graph/src/app/api/graph/route.ts`
- Create: `apps/customer-graph/src/lib/api-proxy.ts`

**Approach:**
- **Permission Check**: Validate user has `customer_graph:view` permission
- **Data Scope**: Apply department-level filtering via `getDataScopeFilter(userId)`
- Server-side fetch to external API with API key
- Transform response to match frontend contract
- **Rate Limiting**: Max 10 requests per minute per user
- **Response Size Limit**: Max 5MB response

**Technical design (RBAC integration):**
```typescript
// apps/customer-graph/src/app/api/graph/route.ts
export async function GET(request: NextRequest) {
  // 1. 验证权限
  const check = await checkPermission(request, { permissions: ['customer_graph:view'] });
  if (!check.authorized) {
    return NextResponse.json({ error: check.error }, { status: check.statusCode });
  }
  
  // 2. 获取数据范围
  const dataScope = await getDataScopeFilter(check.userId!);
  
  // 3. 构建带数据范围限制的请求
  const filterParams = dataScope.type === 'ALL' 
    ? {} 
    : { department_ids: dataScope.deptIds!.join(',') };
  
  // 4. 调用外部 API
  const response = await fetchExternalApi(filterParams);
  return NextResponse.json(await response.json());
}
```

**Test scenarios:**
- Happy path: API data returned to frontend with data scope filtering
- **Security**: User without permission receives 403
- **Security**: Data scope limits returned nodes to user's department
- Error path: API failure shows retry option
- Error path: Unauthenticated request returns 401
- Error path: Rate limit exceeded returns 429
- Edge case: Large response (>5MB) returns error

**Verification:**
- API credentials never exposed to client
- Permission check enforced on every request
- Data scope filtering applied correctly
- Rate limiting prevents abuse

---

- [ ] **Unit 3.4: Dashboard Layout Integration**

**Goal:** Provide consistent layout with Portal navigation.

**Requirements:** R19

**Dependencies:** Unit 2.1

**Files:**
- Create: `apps/customer-graph/src/components/layout/DashboardLayout.tsx`
- Modify: `apps/customer-graph/src/app/layout.tsx`

**Approach:**
- Copy/adapt Portal's DashboardLayout
- Add graph-specific navigation items
- Handle session state for user info display

**Test scenarios:**
- Happy path: Layout displays correctly
- Happy path: User info shows in header
- Edge case: Logout redirects to IdP

**Verification:**
- Layout matches Portal styling
- Navigation works correctly

---

### Phase 4: Deployment Configuration

- [ ] **Unit 4.1: Vercel Build Configuration**

**Goal:** Configure Vercel deployment with WASM assets.

**Requirements:** R27

**Dependencies:** Unit 1.6

**Files:**
- Create: `apps/customer-graph/vercel.json`
- Create: `scripts/build-wasm.sh`
- Modify: `package.json` (add build:wasm script)

**Approach:**
- Pre-build WASM in CI before Vercel deploy
- Include compiled WASM in `apps/customer-graph/public/wasm/`
- Configure vercel.json with correct installCommand
- Set MIME type for `.wasm` files

**Test scenarios:**
- Happy path: WASM files served with correct MIME type
- Happy path: Deployment succeeds
- Edge case: Cache invalidation on WASM update

**Verification:**
- `vercel --prod` deploys successfully
- WASM module loads in production

---

- [ ] **Unit 4.2: Environment Configuration**

**Goal:** Set up environment variables for all deployment targets.

**Requirements:** R18, R19, R20

**Dependencies:** Unit 3.1, Unit 3.3

**Files:**
- Create: `apps/customer-graph/.env.example`
- Create: `apps/customer-graph/.env.production.example`
- Modify: `apps/idp/.env.example` (add CUSTOMER_GRAPH_CLIENT_SECRET)

**Approach:**
- Required vars: NEXT_PUBLIC_IDP_URL, NEXT_PUBLIC_APP_URL, IDP_CLIENT_SECRET, EXTERNAL_API_URL, EXTERNAL_API_KEY
- Use `.trim()` on all URL/ID values
- Document in README

**Test scenarios:**
- Happy path: Local dev works with .env.local
- Happy path: Production build uses correct URLs
- Edge case: Missing required var shows clear error

**Verification:**
- All environment variables documented
- Vercel environment configured

---

## System-Wide Impact

**Interaction graph:**
- IdP: New trusted client registration
- Portal: None (customer-graph is standalone)
- External API: New consumer

**Error propagation:**
- WASM errors → JavaScript error boundary → user-friendly message
- API errors → retry button with exponential backoff
- WebGPU unavailability → browser compatibility prompt

**State lifecycle risks:**
- WASM memory: Must free GPU buffers on unmount
- Session: 30min idle timeout, 7-day absolute (same as Portal)

**Unchanged invariants:**
- IdP authentication flow remains unchanged
- Portal and demo-app continue to work independently

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| WebGPU browser support limited | Medium | High | Clear browser compatibility prompt; document supported browsers |
| WASM package size exceeds 500KB | Medium | Medium | Use `wasm-opt` for optimization; enable LTO in Cargo.toml |
| Force simulation doesn't converge | Low | High | Tune parameters; implement adaptive time stepping |
| Vercel build fails without Rust | Medium | High | Pre-compile WASM in CI; include in repository if needed |
| External API unavailable | Medium | Medium | Implement retry logic; show cached data if available |
| WASM memory data leakage | Medium | High | Implement `secure_clear()` for sensitive data; explicit cleanup on unmount |
| WASM memory data leakage | Medium | High | Implement `secure_clear()` for sensitive data; explicit cleanup on unmount |
| GPU device loss not handled | Low | Medium | Add GPU error handling with re-initialization path (Unit 1.2) |

**Dependencies:**
- Rust toolchain installed locally for development
- wasm-pack installed globally
- WebGPU-capable browser for testing
- External API endpoint and credentials
- External API must support department-level data filtering (for RBAC data scope)

## Documentation / Operational Notes

- **Browser Support**: Document Chrome 113+, Edge 113+ requirement in user guide
- **Performance Monitoring**: Add GPU timing metrics to devtools
- **Error Tracking**: Integrate error boundary with logging service

## Open Questions

### Resolved During Planning

- **WASM crate location**: Decided on `wasm-engine/` at repo root (not in `apps/`)
- **Vercel Rust support**: Pre-compile WASM externally, include in deployment

### Deferred to Implementation

- [R11] Customer profile page URL — business decision pending
- [R5] Clustering algorithm choice — evaluate Louvain vs K-Means during implementation
- [R16] Edge rendering strategy — benchmark Line List vs Storage Buffer during implementation

## Sources & References

- **Origin document:** docs/brainstorms/2026-04-08-customer-graph-visualization-requirements.md
- **wgpu Compute Tutorial:** https://sotrh.github.io/learn-wgpu/compute/introduction
- **wasm-pack Documentation:** https://github.com/drager/wasm-pack
- **Portal OAuth Pattern:** apps/portal/src/lib/auth-client.ts
- **IdP Trusted Client Config:** apps/idp/src/lib/auth.ts