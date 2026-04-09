//! 点击检测模块
//!
//! 实现节点点击和悬停检测

use crate::data::NodeData;

/// 点击检测器
pub struct HitTester {
    /// 悬停的节点 ID
    hovered_node: Option<u32>,

    /// 选中的节点 ID
    selected_node: Option<u32>,

    /// 检测容差（像素）
    tolerance: f32,
}

impl Default for HitTester {
    fn default() -> Self {
        Self::new()
    }
}

impl HitTester {
    /// 创建新的点击检测器
    pub fn new() -> Self {
        Self {
            hovered_node: None,
            selected_node: None,
            tolerance: 5.0,
        }
    }

    /// 设置检测容差
    pub fn set_tolerance(&mut self, tolerance: f32) {
        self.tolerance = tolerance;
    }

    /// 检测点击的节点
    /// 返回被点击的节点 ID，如果没有则返回 None
    pub fn hit_test(
        &mut self,
        nodes: &[NodeData],
        world_x: f32,
        world_y: f32,
    ) -> Option<u32> {
        let mut closest: Option<(u32, f32)> = None;

        for node in nodes {
            let dx = world_x - node.x;
            let dy = world_y - node.y;
            let distance = (dx * dx + dy * dy).sqrt();

            // 检查是否在节点半径内（加上容差）
            if distance <= node.radius + self.tolerance {
                // 选择最近的节点
                match closest {
                    Some((_, closest_dist)) if distance < closest_dist => {
                        closest = Some((node.node_id, distance));
                    }
                    None => {
                        closest = Some((node.node_id, distance));
                    }
                    _ => {}
                }
            }
        }

        self.hovered_node = closest.map(|(id, _)| id);
        self.hovered_node
    }

    /// 检测点击的节点（使用屏幕坐标）
    pub fn hit_test_screen(
        &mut self,
        nodes: &[NodeData],
        screen_x: f32,
        screen_y: f32,
        zoom: f32,
        pan_x: f32,
        pan_y: f32,
        viewport_width: f32,
        viewport_height: f32,
    ) -> Option<u32> {
        // 转换屏幕坐标到世界坐标
        let world_x = (screen_x - viewport_width / 2.0) / zoom - pan_x;
        let world_y = (viewport_height / 2.0 - screen_y) / zoom - pan_y;

        self.hit_test(nodes, world_x, world_y)
    }

    /// 获取当前悬停的节点
    pub fn hovered_node(&self) -> Option<u32> {
        self.hovered_node
    }

    /// 清除悬停状态
    pub fn clear_hover(&mut self) {
        self.hovered_node = None;
    }

    /// 选中节点
    pub fn select_node(&mut self, node_id: Option<u32>) {
        self.selected_node = node_id;
    }

    /// 获取当前选中的节点
    pub fn selected_node(&self) -> Option<u32> {
        self.selected_node
    }

    /// 清除选中状态
    pub fn clear_selection(&mut self) {
        self.selected_node = None;
    }

    /// 检查节点是否被选中
    pub fn is_selected(&self, node_id: u32) -> bool {
        self.selected_node == Some(node_id)
    }

    /// 检查节点是否被悬停
    pub fn is_hovered(&self, node_id: u32) -> bool {
        self.hovered_node == Some(node_id)
    }

    /// 获取节点在世界坐标中的边界框
    pub fn get_node_bounds(node: &NodeData) -> (f32, f32, f32, f32) {
        (
            node.x - node.radius,
            node.y - node.radius,
            node.x + node.radius,
            node.y + node.radius,
        )
    }

    /// 获取节点在屏幕坐标中的边界框
    pub fn get_node_screen_bounds(
        node: &NodeData,
        zoom: f32,
        pan_x: f32,
        pan_y: f32,
        viewport_width: f32,
        viewport_height: f32,
    ) -> (f32, f32, f32, f32) {
        let screen_radius = node.radius * zoom;
        let screen_center_x = (node.x + pan_x) * zoom + viewport_width / 2.0;
        let screen_center_y = viewport_height / 2.0 - (node.y + pan_y) * zoom;

        (
            screen_center_x - screen_radius,
            screen_center_y - screen_radius,
            screen_center_x + screen_radius,
            screen_center_y + screen_radius,
        )
    }
}