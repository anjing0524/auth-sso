//! 边数据结构
//!
//! 定义 GPU 对齐的边数据结构，用于 Storage Buffer 传输

use serde::{Deserialize, Serialize};

/// GPU 对齐的边数据
/// 用于传输到 GPU Storage Buffer
#[repr(C)]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, bytemuck::Pod, bytemuck::Zeroable)]
pub struct EdgeData {
    /// 源节点 ID
    pub source_id: u32,

    /// 目标节点 ID
    pub target_id: u32,

    /// 边颜色 R 分量
    pub color_r: f32,

    /// 边颜色 G 分量
    pub color_g: f32,

    /// 边颜色 B 分量
    pub color_b: f32,

    /// 边颜色 A 分量
    pub color_a: f32,

    /// 边权重（用于引力计算）
    pub weight: f32,

    /// 边类型（0: 默认, 1: 合作, 2: 投资, 3: 供应等）
    pub edge_type: u32,
}

impl Default for EdgeData {
    fn default() -> Self {
        Self {
            source_id: 0,
            target_id: 0,
            color_r: 0.5,
            color_g: 0.5,
            color_b: 0.5,
            color_a: 0.6,
            weight: 1.0,
            edge_type: 0,
        }
    }
}

impl EdgeData {
    /// 创建新边
    pub fn new(source_id: u32, target_id: u32) -> Self {
        Self {
            source_id,
            target_id,
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

    /// 设置权重
    pub fn with_weight(mut self, weight: f32) -> Self {
        self.weight = weight;
        self
    }

    /// 设置边类型
    pub fn with_type(mut self, edge_type: u32) -> Self {
        self.edge_type = edge_type;
        self
    }
}

/// 边类型枚举
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u32)]
pub enum EdgeType {
    /// 默认类型
    Default = 0,
    /// 合作关系
    Partnership = 1,
    /// 投资关系
    Investment = 2,
    /// 供应关系
    Supply = 3,
}

impl From<EdgeType> for u32 {
    fn from(edge_type: EdgeType) -> Self {
        edge_type as u32
    }
}

/// 验证结构体大小和对齐
#[cfg(test)]
mod tests {
    use super::*;
    use std::mem;

    #[test]
    fn test_edge_data_size() {
        // 确保结构体大小是 32 字节
        assert_eq!(mem::size_of::<EdgeData>(), 32);
    }

    #[test]
    fn test_edge_data_alignment() {
        // 确保对齐到 4 字节
        assert_eq!(mem::align_of::<EdgeData>(), 4);
    }
}