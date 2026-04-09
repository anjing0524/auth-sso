//! 拖动处理模块
//!
//! 实现节点拖动交互

use crate::data::NodeData;

/// 拖动状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DragState {
    /// 未拖动
    None,
    /// 正在拖动节点
    Dragging { node_id: u32 },
}

/// 拖动处理器
pub struct DragHandler {
    /// 当前拖动状态
    state: DragState,

    /// 拖动偏移量（鼠标点击位置与节点中心的偏移）
    offset_x: f32,
    offset_y: f32,
}

impl Default for DragHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl DragHandler {
    /// 创建新的拖动处理器
    pub fn new() -> Self {
        Self {
            state: DragState::None,
            offset_x: 0.0,
            offset_y: 0.0,
        }
    }

    /// 开始拖动节点
    pub fn start_drag(&mut self, node_id: u32, node_x: f32, node_y: f32, mouse_x: f32, mouse_y: f32) {
        self.state = DragState::Dragging { node_id };
        // 计算偏移量：节点中心 - 鼠标位置
        self.offset_x = node_x - mouse_x;
        self.offset_y = node_y - mouse_y;
    }

    /// 更新拖动位置
    /// 返回 Some((node_id, new_x, new_y)) 如果正在拖动
    pub fn update_drag(&mut self, mouse_x: f32, mouse_y: f32) -> Option<(u32, f32, f32)> {
        match self.state {
            DragState::Dragging { node_id } => {
                let new_x = mouse_x + self.offset_x;
                let new_y = mouse_y + self.offset_y;
                Some((node_id, new_x, new_y))
            }
            DragState::None => None,
        }
    }

    /// 结束拖动
    pub fn end_drag(&mut self) {
        self.state = DragState::None;
        self.offset_x = 0.0;
        self.offset_y = 0.0;
    }

    /// 获取当前拖动状态
    pub fn state(&self) -> DragState {
        self.state
    }

    /// 检查是否正在拖动
    pub fn is_dragging(&self) -> bool {
        matches!(self.state, DragState::Dragging { .. })
    }

    /// 更新节点位置
    pub fn update_node_position(&self, nodes: &mut [NodeData], node_id: u32, x: f32, y: f32) -> bool {
        if let Some(node) = nodes.iter_mut().find(|n| n.node_id == node_id) {
            node.x = x;
            node.y = y;
            // 固定被拖动的节点
            node.vx = 0.0;
            node.vy = 0.0;
            true
        } else {
            false
        }
    }
}