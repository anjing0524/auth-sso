//! WASM-JavaScript API 桥接
//!
//! 导出 JavaScript 可调用的函数

use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use crate::data::{EdgeData, NodeData};
use crate::GraphEngine;

/// 图引擎 WASM API
/// 提供给 JavaScript 调用的接口
#[wasm_bindgen]
pub struct GraphEngineWasm {
    engine: GraphEngine,
}

#[wasm_bindgen]
impl GraphEngineWasm {
    /// 创建新的图引擎实例
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            engine: GraphEngine::new(),
        }
    }

    /// 初始化图引擎
    /// 必须在使用其他方法前调用
    pub async fn init(&mut self, _canvas: HtmlCanvasElement) -> Result<(), JsValue> {
        // TODO: 实现 GPU 上下文初始化
        Ok(())
    }

    /// 加载图数据
    /// nodes: 节点 JSON 数组
    /// edges: 边 JSON 数组
    pub fn load_data(&mut self, nodes: JsValue, edges: JsValue) -> Result<(), JsValue> {
        // 解析节点数据
        let _nodes: Vec<NodeData> = serde_wasm_bindgen::from_value(nodes)?;
        let _edges: Vec<EdgeData> = serde_wasm_bindgen::from_value(edges)?;

        // TODO: 加载数据到图存储和 GPU 缓冲区

        Ok(())
    }

    /// 执行一次力导向模拟步骤
    pub fn step_simulation(&mut self) {
        // TODO: 调用力导向模拟器
    }

    /// 渲染一帧
    pub fn render(&self) -> Result<(), JsValue> {
        // TODO: 调用渲染管线
        Ok(())
    }

    /// 设置视口
    pub fn set_viewport(&mut self, _zoom: f32, _pan_x: f32, _pan_y: f32) {
        // TODO: 更新视口参数
    }

    /// 获取悬停的节点
    /// 返回节点索引，如果没有则返回 -1
    pub fn get_hovered_node(&self, _x: f32, _y: f32) -> i32 {
        // TODO: 实现点击检测
        -1
    }

    /// 拖动节点
    pub fn drag_node(&mut self, _node_id: u32, _x: f32, _y: f32) {
        // TODO: 更新节点位置
    }

    /// 获取所有节点位置
    /// 返回 JSON 数组 [{x, y}, ...]
    pub fn get_node_positions(&self) -> Result<JsValue, JsValue> {
        // TODO: 返回节点位置数据
        Ok(JsValue::NULL)
    }

    /// 高亮节点及其邻居
    pub fn highlight_node(&mut self, _node_id: u32) {
        // TODO: 实现节点高亮
    }

    /// 清除高亮
    pub fn clear_highlight(&mut self) {
        // TODO: 清除高亮状态
    }

    /// 搜索节点
    /// 返回匹配节点 ID 的 JSON 数组
    pub fn search_nodes(&self, _query: &str) -> Result<JsValue, JsValue> {
        // TODO: 实现节点搜索
        Ok(JsValue::NULL)
    }

    /// 过滤节点 - 按客户类型
    pub fn filter_by_type(&mut self, filter_type: Option<String>) {
        // TODO: 实现按类型过滤
        let _ = filter_type;
    }

    /// 过滤节点 - 按最小关联数量
    pub fn filter_by_degree(&mut self, min_degree: Option<u32>) {
        // TODO: 实现按度数过滤
        let _ = min_degree;
    }

    /// 重置过滤
    pub fn reset_filter(&mut self) {
        // TODO: 重置过滤状态
    }

    /// 获取节点详情
    /// 返回节点信息的 JSON 对象
    pub fn get_node_detail(&self, _node_id: u32) -> Result<JsValue, JsValue> {
        // TODO: 返回节点详情
        Ok(JsValue::NULL)
    }

    /// 安全释放所有资源
    /// 防止数据残留
    pub fn destroy(&mut self) {
        // 清零敏感数据
        // 释放 GPU 资源
        // 清空集合
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
    // 检查 navigator.gpu 是否存在
    if let Some(window) = web_sys::window() {
        if let Ok(navigator) = js_sys::Reflect::get(&window, &JsValue::from_str("navigator")) {
            return js_sys::Reflect::get(&navigator, &JsValue::from_str("gpu")).is_ok();
        }
    }
    false
}

/// 获取引擎版本
#[wasm_bindgen]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}