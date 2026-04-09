//! 力计算模块
//!
//! 实现引力和斥力计算

use crate::data::{EdgeData, NodeData};

/// 力计算参数
#[derive(Debug, Clone, Copy)]
pub struct ForceParams {
    /// 引力强度（边连接的节点互相吸引）
    pub attraction_strength: f32,

    /// 斥力强度（所有节点互相排斥）
    pub repulsion_strength: f32,

    /// 理想边长度
    pub ideal_edge_length: f32,

    /// 重力强度（向中心吸引）
    pub gravity_strength: f32,

    /// 阻尼系数（速度衰减）
    pub damping: f32,

    /// 最大速度限制
    pub max_velocity: f32,
}

impl Default for ForceParams {
    fn default() -> Self {
        Self {
            attraction_strength: 0.01,
            repulsion_strength: 100.0,
            ideal_edge_length: 50.0,
            gravity_strength: 0.1,
            damping: 0.9,
            max_velocity: 10.0,
        }
    }
}

/// CPU 端力计算（用于调试和小规模图）
pub struct ForceCalculator {
    params: ForceParams,
}

impl Default for ForceCalculator {
    fn default() -> Self {
        Self::new()
    }
}

impl ForceCalculator {
    /// 创建新的力计算器
    pub fn new() -> Self {
        Self {
            params: ForceParams::default(),
        }
    }

    /// 设置参数
    pub fn set_params(&mut self, params: ForceParams) {
        self.params = params;
    }

    /// 计算引力（边连接的节点）
    /// F = k * (distance - ideal_length) * direction
    #[inline]
    pub fn calculate_attraction(
        &self,
        node1: &NodeData,
        node2: &NodeData,
        distance: f32,
    ) -> (f32, f32) {
        if distance < 0.001 {
            return (0.0, 0.0);
        }

        let dx = node2.x - node1.x;
        let dy = node2.y - node1.y;

        // 胡克定律：F = k * (d - d0)
        let force_magnitude =
            self.params.attraction_strength * (distance - self.params.ideal_edge_length);

        let fx = force_magnitude * dx / distance;
        let fy = force_magnitude * dy / distance;

        (fx, fy)
    }

    /// 计算斥力（所有节点对）
    /// F = k / distance^2
    #[inline]
    pub fn calculate_repulsion(&self, node1: &NodeData, node2: &NodeData) -> (f32, f32) {
        let dx = node1.x - node2.x;
        let dy = node1.y - node2.y;
        let distance_sq = dx * dx + dy * dy;

        // 避免除零
        if distance_sq < 1.0 {
            return (
                self.params.repulsion_strength * (dx.signum() * 1.0 - dx),
                self.params.repulsion_strength * (dy.signum() * 1.0 - dy),
            );
        }

        // 库仑定律：F = k / r^2
        let distance = distance_sq.sqrt();
        let force_magnitude = self.params.repulsion_strength / distance_sq;

        let fx = force_magnitude * dx / distance;
        let fy = force_magnitude * dy / distance;

        (fx, fy)
    }

    /// 计算重力（向中心）
    #[inline]
    pub fn calculate_gravity(&self, node: &NodeData, center_x: f32, center_y: f32) -> (f32, f32) {
        let dx = center_x - node.x;
        let dy = center_y - node.y;

        (
            self.params.gravity_strength * dx,
            self.params.gravity_strength * dy,
        )
    }

    /// 应用阻尼
    #[inline]
    pub fn apply_damping(&self, vx: f32, vy: f32) -> (f32, f32) {
        let damped_vx = vx * self.params.damping;
        let damped_vy = vy * self.params.damping;

        // 限制最大速度
        let speed = (damped_vx * damped_vx + damped_vy * damped_vy).sqrt();
        if speed > self.params.max_velocity {
            let scale = self.params.max_velocity / speed;
            (damped_vx * scale, damped_vy * scale)
        } else {
            (damped_vx, damped_vy)
        }
    }

    /// 执行一次 CPU 端力导向模拟步骤
    /// 返回更新后的节点位置
    pub fn step(&self, nodes: &mut [NodeData], edges: &[EdgeData]) {
        let n = nodes.len();
        if n == 0 {
            return;
        }

        // 计算中心点
        let (center_x, center_y) = {
            let mut sum_x = 0.0f32;
            let mut sum_y = 0.0f32;
            for node in nodes.iter() {
                sum_x += node.x;
                sum_y += node.y;
            }
            (sum_x / n as f32, sum_y / n as f32)
        };

        // 存储力的累积
        let mut forces = vec![(0.0f32, 0.0f32); n];

        // 1. 计算所有节点对的斥力 O(n^2) - GPU 会优化为 O(n)
        for i in 0..n {
            for j in (i + 1)..n {
                let (fx, fy) = self.calculate_repulsion(&nodes[i], &nodes[j]);
                forces[i].0 += fx;
                forces[i].1 += fy;
                forces[j].0 -= fx;
                forces[j].1 -= fy;
            }
        }

        // 2. 计算边的引力 O(m)
        for edge in edges.iter() {
            let src = edge.source_id as usize;
            let dst = edge.target_id as usize;

            if src < n && dst < n {
                let dx = nodes[dst].x - nodes[src].x;
                let dy = nodes[dst].y - nodes[src].y;
                let distance = (dx * dx + dy * dy).sqrt().max(0.001);

                let (fx, fy) =
                    self.calculate_attraction(&nodes[src], &nodes[dst], distance);
                forces[src].0 += fx;
                forces[src].1 += fy;
                forces[dst].0 -= fx;
                forces[dst].1 -= fy;
            }
        }

        // 3. 计算重力
        for i in 0..n {
            let (gx, gy) = self.calculate_gravity(&nodes[i], center_x, center_y);
            forces[i].0 += gx;
            forces[i].1 += gy;
        }

        // 4. 更新速度和位置
        for i in 0..n {
            // 更新速度
            nodes[i].vx += forces[i].0;
            nodes[i].vy += forces[i].1;

            // 应用阻尼
            let (vx, vy) = self.apply_damping(nodes[i].vx, nodes[i].vy);
            nodes[i].vx = vx;
            nodes[i].vy = vy;

            // 更新位置
            nodes[i].x += nodes[i].vx;
            nodes[i].y += nodes[i].vy;
        }
    }
}