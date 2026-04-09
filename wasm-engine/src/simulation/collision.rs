//! 碰撞检测模块
//!
//! 实现球体碰撞检测和推开算法

use crate::data::NodeData;

/// 碰撞检测器
/// 处理节点重叠检测和推开
pub struct CollisionDetector {
    /// 碰撞半径倍数（相对于节点半径）
    radius_multiplier: f32,

    /// 碰撞推力强度
    push_strength: f32,
}

impl Default for CollisionDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl CollisionDetector {
    /// 创建新的碰撞检测器
    pub fn new() -> Self {
        Self {
            radius_multiplier: 1.2,
            push_strength: 0.5,
        }
    }

    /// 设置参数
    pub fn set_params(&mut self, radius_multiplier: f32, push_strength: f32) {
        self.radius_multiplier = radius_multiplier;
        self.push_strength = push_strength;
    }

    /// 检测两个节点是否碰撞
    #[inline]
    pub fn check_collision(&self, node1: &NodeData, node2: &NodeData) -> bool {
        let dx = node2.x - node1.x;
        let dy = node2.y - node1.y;
        let distance_sq = dx * dx + dy * dy;

        let combined_radius =
            (node1.radius + node2.radius) * self.radius_multiplier;
        let radius_sq = combined_radius * combined_radius;

        distance_sq < radius_sq
    }

    /// 计算碰撞推开力
    /// 返回 (fx, fy) 作用于 node1 的力
    #[inline]
    pub fn calculate_push_force(&self, node1: &NodeData, node2: &NodeData) -> (f32, f32) {
        let dx = node1.x - node2.x;
        let dy = node1.y - node2.y;
        let distance = (dx * dx + dy * dy).sqrt();

        let combined_radius =
            (node1.radius + node2.radius) * self.radius_multiplier;

        // 如果重叠，计算推开力
        if distance < combined_radius && distance > 0.001 {
            let overlap = combined_radius - distance;
            let force_magnitude = overlap * self.push_strength;

            (
                force_magnitude * dx / distance,
                force_magnitude * dy / distance,
            )
        } else {
            (0.0, 0.0)
        }
    }

    /// 解决所有碰撞（CPU 端，O(n^2)）
    pub fn resolve_collisions(&self, nodes: &mut [NodeData]) {
        let n = nodes.len();

        for i in 0..n {
            for j in (i + 1)..n {
                if self.check_collision(&nodes[i], &nodes[j]) {
                    let (fx, fy) = self.calculate_push_force(&nodes[i], &nodes[j]);

                    // 应用力到速度
                    nodes[i].vx += fx;
                    nodes[i].vy += fy;
                    nodes[j].vx -= fx;
                    nodes[j].vy -= fy;
                }
            }
        }
    }
}