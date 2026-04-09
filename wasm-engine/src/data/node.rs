//! 节点数据结构
//!
//! 定义 GPU 对齐的节点数据结构，用于 Storage Buffer 传输

use serde::{Deserialize, Serialize};

/// GPU 对齐的节点数据
/// 用于传输到 GPU Storage Buffer
#[repr(C)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct NodeData {
    /// 节点位置 X 坐标
    pub x: f32,

    /// 节点位置 Y 坐标
    pub y: f32,

    /// 节点速度 X 分量（用于力导向模拟）
    pub vx: f32,

    /// 节点速度 Y 分量（用于力导向模拟）
    pub vy: f32,

    /// 节点半径（基于度数计算）
    pub radius: f32,

    /// 节点颜色 R 分量
    pub color_r: f32,

    /// 节点颜色 G 分量
    pub color_g: f32,

    /// 节点颜色 B 分量
    pub color_b: f32,

    /// 节点颜色 A 分量
    pub color_a: f32,

    /// 内部节点 ID（用于查找）
    pub node_id: u32,

    /// 度数（关联边数量）
    pub degree: u32,

    /// 填充字段，确保 64 字节对齐
    _padding: [f32; 2],
}

impl Default for NodeData {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            vx: 0.0,
            vy: 0.0,
            radius: 10.0,
            color_r: 0.4,
            color_g: 0.6,
            color_b: 0.9,
            color_a: 1.0,
            node_id: 0,
            degree: 0,
            _padding: [0.0; 2],
        }
    }
}

impl NodeData {
    /// 创建新节点
    pub fn new(id: u32, x: f32, y: f32) -> Self {
        Self {
            node_id: id,
            x,
            y,
            ..Default::default()
        }
    }

    /// 设置颜色
    pub fn with_color(mut self, r: f32, g: f32, b: f32, a: f32) -> Self {
        self.color_r = r;
        self.color_g = g;
        self.color_b = b;
        self.color_a = a;
        self
    }

    /// 设置半径
    pub fn with_radius(mut self, radius: f32) -> Self {
        self.radius = radius;
        self
    }

    /// 设置度数
    pub fn with_degree(mut self, degree: u32) -> Self {
        self.degree = degree;
        self
    }

    /// 清零敏感数据
    pub fn zero_out(&mut self) {
        self.x = 0.0;
        self.y = 0.0;
        self.vx = 0.0;
        self.vy = 0.0;
    }
}

/// 验证结构体大小和对齐
#[cfg(test)]
mod tests {
    use super::*;
    use std::mem;

    #[test]
    fn test_node_data_size() {
        // 确保结构体大小是 64 字节（适合 GPU 缓存行）
        assert_eq!(mem::size_of::<NodeData>(), 64);
    }

    #[test]
    fn test_node_data_alignment() {
        // 确保对齐到 4 字节
        assert_eq!(mem::align_of::<NodeData>(), 4);
    }
}