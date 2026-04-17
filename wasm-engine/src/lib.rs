//! GPU-accelerated futures orderbook visualization engine
//!
//! 使用 Rust + wgpu + WebGPU 实现高性能订单簿可视化：
//! - Instanced Rendering 渲染独立订单方块和价格轴
//! - 直接绝对坐标映射，O(1) 复杂度布局

pub mod api;
pub mod data;
pub mod interaction;
pub mod renderer;

use wasm_bindgen::prelude::*;

/// 初始化 WASM 模块
/// 设置 panic hook 以便在控制台显示错误信息
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// 订单簿引擎主结构体
/// 管理 GPU 资源、订单簿数据和交互状态
pub struct OrderbookEngine {
    /// GPU 上下文（设备、队列、表面）
    gpu_context: Option<renderer::context::GpuContext>,

    /// 渲染管线
    render_pipeline: Option<renderer::pipeline::RenderPipeline>,

    /// 交互处理器
    interaction: interaction::InteractionHandler,

    /// 实例数据（预先计算好位置）
    instances: Vec<data::orderbook::InstanceData>,

    /// 当前的 tick_size
    tick_size: f32,

    /// 是否已初始化
    initialized: bool,
}

impl Default for OrderbookEngine {
    fn default() -> Self {
        Self {
            gpu_context: None,
            render_pipeline: None,
            interaction: interaction::InteractionHandler::new(),
            instances: Vec::new(),
            tick_size: 0.2, // 默认值
            initialized: false,
        }
    }
}

impl OrderbookEngine {
    /// 创建新的引擎实例
    pub fn new() -> Self {
        Self::default()
    }
}
