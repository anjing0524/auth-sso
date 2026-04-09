//! GPU-accelerated customer relationship graph visualization engine
//!
//! 使用 Rust + wgpu + WebGPU 实现高性能图可视化：
//! - GPU Compute Shader 力导向布局
//! - Instanced Rendering 渲染
//! - 空间网格加速 O(n) 斥力计算

pub mod api;
pub mod data;
pub mod interaction;
pub mod renderer;
pub mod simulation;

use wasm_bindgen::prelude::*;

/// 初始化 WASM 模块
/// 设置 panic hook 以便在控制台显示错误信息
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// 图引擎主结构体
/// 管理 GPU 资源、图数据和交互状态
pub struct GraphEngine {
    /// GPU 上下文（设备、队列、表面）
    gpu_context: Option<renderer::context::GpuContext>,

    /// CPU 端图数据存储
    graph_store: data::graph_store::GraphStore,

    /// 渲染管线
    render_pipeline: Option<renderer::pipeline::RenderPipeline>,

    /// 力导向模拟器
    simulator: Option<simulation::physics::ForceSimulator>,

    /// 交互处理器
    interaction: interaction::InteractionHandler,

    /// 是否已初始化
    initialized: bool,
}

impl Default for GraphEngine {
    fn default() -> Self {
        Self {
            gpu_context: None,
            graph_store: data::graph_store::GraphStore::new(),
            render_pipeline: None,
            simulator: None,
            interaction: interaction::InteractionHandler::new(),
            initialized: false,
        }
    }
}

impl GraphEngine {
    /// 创建新的图引擎实例
    pub fn new() -> Self {
        Self::default()
    }
}