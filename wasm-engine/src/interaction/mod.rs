//! 交互处理模块
//!
//! 处理鼠标拖动、缩放、点击检测等交互

pub mod drag;
pub mod hit;
pub mod zoom;

pub use drag::{DragHandler, DragState};
pub use hit::HitTester;
pub use zoom::{Viewport, ZoomHandler};

use crate::data::NodeData;

/// 交互处理器
/// 管理用户与图的交互状态
pub struct InteractionHandler {
    /// 拖动处理器
    drag: DragHandler,

    /// 缩放处理器
    zoom: ZoomHandler,

    /// 点击检测器
    hit: HitTester,
}

impl Default for InteractionHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl InteractionHandler {
    /// 创建新的交互处理器
    pub fn new() -> Self {
        Self {
            drag: DragHandler::new(),
            zoom: ZoomHandler::new(),
            hit: HitTester::new(),
        }
    }

    /// 处理鼠标按下
    pub fn on_mouse_down(&mut self, screen_x: f32, screen_y: f32, is_pan: bool) {
        if is_pan {
            self.zoom.start_pan(screen_x, screen_y);
        }
    }

    /// 处理鼠标移动
    pub fn on_mouse_move(&mut self, screen_x: f32, screen_y: f32) {
        // 更新平移
        self.zoom.update_pan(screen_x, screen_y);
    }

    /// 处理鼠标释放
    pub fn on_mouse_up(&mut self) {
        self.drag.end_drag();
        self.zoom.end_pan();
    }

    /// 处理滚轮缩放
    pub fn on_wheel(&mut self, delta: f32, screen_x: f32, screen_y: f32) {
        self.zoom.wheel_zoom(delta, screen_x, screen_y);
    }

    /// 开始拖动节点
    pub fn start_drag(&mut self, node_id: u32, node_x: f32, node_y: f32, mouse_x: f32, mouse_y: f32) {
        self.drag.start_drag(node_id, node_x, node_y, mouse_x, mouse_y);
    }

    /// 更新拖动位置
    pub fn update_drag(&mut self, mouse_x: f32, mouse_y: f32) -> Option<(u32, f32, f32)> {
        self.drag.update_drag(mouse_x, mouse_y)
    }

    /// 结束拖动
    pub fn end_drag(&mut self) {
        self.drag.end_drag();
    }

    /// 检查是否正在拖动
    pub fn is_dragging(&self) -> bool {
        self.drag.is_dragging()
    }

    /// 点击检测
    pub fn hit_test(&mut self, nodes: &[NodeData], world_x: f32, world_y: f32) -> Option<u32> {
        self.hit.hit_test(nodes, world_x, world_y)
    }

    /// 获取悬停节点
    pub fn get_hovered_node(&self) -> Option<u32> {
        self.hit.hovered_node()
    }

    /// 清除悬停
    pub fn clear_hover(&mut self) {
        self.hit.clear_hover();
    }

    /// 选中节点
    pub fn select_node(&mut self, node_id: Option<u32>) {
        self.hit.select_node(node_id);
    }

    /// 获取选中节点
    pub fn get_selected_node(&self) -> Option<u32> {
        self.hit.selected_node()
    }

    /// 获取视口
    pub fn viewport(&self) -> &Viewport {
        self.zoom.viewport()
    }

    /// 获取可变视口
    pub fn viewport_mut(&mut self) -> &mut Viewport {
        self.zoom.viewport_mut()
    }

    /// 获取缩放级别
    pub fn get_zoom(&self) -> f32 {
        self.viewport().zoom
    }

    /// 获取平移
    pub fn get_pan(&self) -> (f32, f32) {
        let vp = self.viewport();
        (vp.pan_x, vp.pan_y)
    }

    /// 屏幕坐标转世界坐标
    pub fn screen_to_world(&self, screen_x: f32, screen_y: f32) -> (f32, f32) {
        let vp = self.viewport();
        vp.screen_to_world(screen_x, screen_y)
    }

    /// 世界坐标转屏幕坐标
    pub fn world_to_screen(&self, world_x: f32, world_y: f32) -> (f32, f32) {
        let vp = self.viewport();
        vp.world_to_screen(world_x, world_y)
    }

    /// 设置画布尺寸
    pub fn set_canvas_size(&mut self, width: f32, height: f32) {
        self.zoom.viewport_mut().set_size(width, height);
    }
}