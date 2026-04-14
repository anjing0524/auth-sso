//! WASM-JavaScript API 桥接
//!
//! 导出 JavaScript 可调用的函数

use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use crate::data::{EdgeData, NodeData};
use crate::renderer::{GpuContext, InstanceManager, RenderPipeline, UniformBuffer};
use crate::simulation::{ForceSimulator, SimulationMode};
use crate::interaction::InteractionHandler;

/// 节点位置数据（用于返回给 JavaScript）
#[derive(Debug, Clone, serde::Serialize)]
pub struct NodePosition {
    pub id: u32,
    pub x: f32,
    pub y: f32,
}

/// 图引擎 WASM API
/// 提供给 JavaScript 调用的接口
#[wasm_bindgen]
pub struct GraphEngineWasm {
    /// GPU 上下文
    gpu_context: GpuContext,

    /// 节点数据
    nodes: Vec<NodeData>,

    /// 边数据
    edges: Vec<EdgeData>,

    /// 力导向模拟器
    simulator: ForceSimulator,

    /// 实例管理器
    instances: InstanceManager,

    /// 渲染管线
    pipeline: RenderPipeline,

    /// Uniform 缓冲区
    uniform_buffer: UniformBuffer,

    /// 交互处理器
    interaction: InteractionHandler,

    /// 是否已初始化
    initialized: bool,
}

#[wasm_bindgen]
impl GraphEngineWasm {
    /// 创建新的图引擎实例
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        // 初始化 panic hook
        #[cfg(target_arch = "wasm32")]
        console_error_panic_hook::set_once();

        Self {
            gpu_context: GpuContext::new(),
            nodes: Vec::new(),
            edges: Vec::new(),
            simulator: ForceSimulator::new(),
            instances: InstanceManager::new(),
            pipeline: RenderPipeline::new(),
            uniform_buffer: UniformBuffer::new(),
            interaction: InteractionHandler::new(),
            initialized: false,
        }
    }

    /// 初始化图引擎
    /// 必须在使用其他方法前调用
    pub async fn init(&mut self, canvas: HtmlCanvasElement) -> Result<(), JsValue> {
        // 初始化 GPU 上下文
        self.gpu_context
            .init(canvas)
            .await
            .map_err(|e| JsValue::from_str(&e))?;

        // 获取设备和队列
        let device = self
            .gpu_context
            .device()
            .ok_or_else(|| JsValue::from_str("GPU device not initialized"))?;

        // 初始化 Uniform 缓冲区
        self.uniform_buffer.init(device);
        self.uniform_buffer.set_viewport(800.0, 600.0, 1.0, 0.0, 0.0);

        // 初始化实例缓冲区
        self.instances.init_buffers(device, 100_000, 500_000);

        // 初始化渲染管线
        self.pipeline
            .init(&self.gpu_context)
            .map_err(|e| JsValue::from_str(&e))?;

        // 创建绑定组（只需创建一次）
        self.pipeline
            .create_bind_group(&self.gpu_context, &self.uniform_buffer)
            .map_err(|e| JsValue::from_str(&e))?;

        // 初始化力导向模拟器（使用 CPU 模式）
        self.simulator.set_mode(SimulationMode::Cpu);
        self.simulator
            .init_gpu(&self.gpu_context)
            .map_err(|e| JsValue::from_str(&e))?;

        self.initialized = true;
        Ok(())
    }

    /// 加载图数据
    /// nodes: 节点 JSON 数组
    /// edges: 边 JSON 数组
    pub fn load_data(&mut self, nodes: JsValue, edges: JsValue) -> Result<(), JsValue> {
        // 解析节点数据
        let parsed_nodes: Vec<NodeData> = serde_wasm_bindgen::from_value(nodes)?;
        let parsed_edges: Vec<EdgeData> = serde_wasm_bindgen::from_value(edges)?;

        // 存储数据
        self.nodes = parsed_nodes;
        self.edges = parsed_edges;

        // 更新实例数据
        self.instances.update_nodes(&self.nodes);
        self.instances.update_edges(&self.edges, &self.nodes);

        // 上传到 GPU
        if let Some(queue) = self.gpu_context.queue() {
            self.instances.upload(queue);
            self.uniform_buffer.upload(queue);
        }

        Ok(())
    }

    /// 执行一次力导向模拟步骤
    pub fn step_simulation(&mut self) {
        if !self.initialized {
            return;
        }

        // 执行模拟步骤
        self.simulator.step_cpu(&mut self.nodes, &self.edges);

        // 更新实例数据
        self.instances.update_nodes(&self.nodes);
        self.instances.update_edges(&self.edges, &self.nodes);

        // 上传到 GPU
        if let Some(queue) = self.gpu_context.queue() {
            self.instances.upload(queue);
        }
    }

    /// 渲染一帧
    pub fn render(&mut self) -> Result<(), JsValue> {
        if !self.initialized {
            return Err(JsValue::from_str("Engine not initialized"));
        }

        // 更新 Uniform 缓冲区
        let vp = self.interaction.viewport();
        self.uniform_buffer
            .set_viewport(vp.width, vp.height, vp.zoom, vp.pan_x, vp.pan_y);

        if let Some(queue) = self.gpu_context.queue() {
            self.uniform_buffer.upload(queue);
        }

        // 渲染（绑定组在 init 时已创建）
        self.pipeline
            .render(&self.gpu_context, &self.instances)
            .map_err(|e| JsValue::from_str(&e))?;

        Ok(())
    }

    /// 设置视口尺寸
    pub fn resize(&mut self, width: f32, height: f32) {
        self.interaction.set_canvas_size(width, height);
        self.gpu_context.resize(width as u32, height as u32);
    }

    /// 设置视口（缩放和平移）
    pub fn set_viewport(&mut self, zoom: f32, pan_x: f32, pan_y: f32) {
        let vp = self.interaction.viewport_mut();
        vp.zoom = zoom.clamp(0.1, 10.0);
        vp.pan_x = pan_x;
        vp.pan_y = pan_y;
    }

    /// 获取当前缩放
    pub fn get_zoom(&self) -> f32 {
        self.interaction.get_zoom()
    }

    /// 获取当前平移
    pub fn get_pan(&self) -> Vec<f32> {
        let (x, y) = self.interaction.get_pan();
        vec![x, y]
    }

    /// 处理鼠标按下
    pub fn on_mouse_down(&mut self, x: f32, y: f32, button: u32) {
        // button: 0 = 左键, 1 = 中键, 2 = 右键
        let is_pan = button != 0; // 中键或右键用于平移
        self.interaction.on_mouse_down(x, y, is_pan);

        // 左键用于选择和拖动
        if button == 0 {
            let (world_x, world_y) = self.interaction.screen_to_world(x, y);
            if let Some(node_id) = self.interaction.hit_test(&self.nodes, world_x, world_y) {
                // 找到节点并开始拖动
                if let Some(node) = self.nodes.iter().find(|n| n.node_id == node_id) {
                    self.interaction.start_drag(node_id, node.x, node.y, world_x, world_y);
                }
            }
        }
    }

    /// 处理鼠标移动
    pub fn on_mouse_move(&mut self, x: f32, y: f32) {
        self.interaction.on_mouse_move(x, y);

        // 更新拖动
        let (world_x, world_y) = self.interaction.screen_to_world(x, y);
        if let Some((node_id, new_x, new_y)) = self.interaction.update_drag(world_x, world_y) {
            // 更新节点位置
            for node in &mut self.nodes {
                if node.node_id == node_id {
                    node.x = new_x;
                    node.y = new_y;
                    break;
                }
            }
            // 更新实例
            self.instances.update_nodes(&self.nodes);
            if let Some(queue) = self.gpu_context.queue() {
                self.instances.upload(queue);
            }
        }
    }

    /// 处理鼠标释放
    pub fn on_mouse_up(&mut self) {
        self.interaction.on_mouse_up();
    }

    /// 处理滚轮
    pub fn on_wheel(&mut self, delta: f32, x: f32, y: f32) {
        self.interaction.on_wheel(delta, x, y);
    }

    /// 获取悬停的节点
    /// 返回节点 ID，如果没有则返回 -1
    pub fn get_hovered_node(&mut self, x: f32, y: f32) -> i32 {
        let (world_x, world_y) = self.interaction.screen_to_world(x, y);
        self.interaction
            .hit_test(&self.nodes, world_x, world_y)
            .map(|id| id as i32)
            .unwrap_or(-1)
    }

    /// 拖动节点到指定位置
    pub fn drag_node(&mut self, node_id: u32, x: f32, y: f32) {
        let (world_x, world_y) = self.interaction.screen_to_world(x, y);
        for node in &mut self.nodes {
            if node.node_id == node_id {
                node.x = world_x;
                node.y = world_y;
                node.vx = 0.0;
                node.vy = 0.0;
                break;
            }
        }
        self.instances.update_nodes(&self.nodes);
        if let Some(queue) = self.gpu_context.queue() {
            self.instances.upload(queue);
        }
    }

    /// 获取所有节点位置
    /// 返回 JSON 数组
    pub fn get_node_positions(&self) -> Result<JsValue, JsValue> {
        let positions: Vec<NodePosition> = self
            .nodes
            .iter()
            .map(|n| NodePosition {
                id: n.node_id,
                x: n.x,
                y: n.y,
            })
            .collect();

        serde_wasm_bindgen::to_value(&positions).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// 选中节点
    pub fn select_node(&mut self, node_id: Option<u32>) {
        self.interaction.select_node(node_id);
    }

    /// 获取选中的节点
    pub fn get_selected_node(&self) -> i32 {
        self.interaction
            .get_selected_node()
            .map(|id| id as i32)
            .unwrap_or(-1)
    }

    /// 适配所有节点到视口
    pub fn fit_to_view(&mut self, padding: f32) {
        let positions: Vec<(f32, f32)> = self.nodes.iter().map(|n| (n.x, n.y)).collect();
        self.interaction.viewport_mut().fit_nodes(&positions, padding);
    }

    /// 重置视口
    pub fn reset_viewport(&mut self) {
        self.interaction.viewport_mut().reset();
    }

    /// 获取节点数量
    pub fn get_node_count(&self) -> u32 {
        self.nodes.len() as u32
    }

    /// 获取边数量
    pub fn get_edge_count(&self) -> u32 {
        self.edges.len() as u32
    }

    /// 设置模拟参数
    pub fn set_simulation_params(
        &mut self,
        attraction: f32,
        repulsion: f32,
        gravity: f32,
        damping: f32,
    ) {
        let mut params = crate::simulation::ForceParams::default();
        params.attraction_strength = attraction;
        params.repulsion_strength = repulsion;
        params.gravity_strength = gravity;
        params.damping = damping;
        self.simulator.set_params(params);
    }

    /// 安全释放所有资源
    pub fn destroy(&mut self) {
        // 清空数据
        self.nodes.clear();
        self.edges.clear();

        // 销毁 GPU 资源
        self.gpu_context.destroy();
        self.instances.destroy();
        self.pipeline.destroy();
        self.simulator.destroy();

        self.initialized = false;
    }
}

impl Default for GraphEngineWasm {
    fn default() -> Self {
        Self::new()
    }
}

/// 检查 WebGPU 支持
#[wasm_bindgen]
pub fn is_webgpu_supported() -> bool {
    // 检查 navigator.gpu 是否存在且不为 undefined
    if let Some(window) = web_sys::window() {
        if let Ok(navigator) = js_sys::Reflect::get(&window, &JsValue::from_str("navigator")) {
            if let Ok(gpu) = js_sys::Reflect::get(&navigator, &JsValue::from_str("gpu")) {
                // 检查 gpu 是否不是 undefined 或 null
                return !gpu.is_undefined() && !gpu.is_null();
            }
        }
    }
    false
}

/// 获取引擎版本
#[wasm_bindgen]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}