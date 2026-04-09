//! 实例化渲染数据
//!
//! 管理节点和边的实例数据

use crate::data::{EdgeData, NodeData};

/// 节点实例数据
/// 用于实例化渲染，每个实例一个节点
#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct NodeInstance {
    /// 实例位置 X
    pub position: [f32; 2],

    /// 实例大小（半径）
    pub size: f32,

    /// 填充
    pub _padding: f32,

    /// 实例颜色 RGBA
    pub color: [f32; 4],
}

impl Default for NodeInstance {
    fn default() -> Self {
        Self {
            position: [0.0, 0.0],
            size: 10.0,
            _padding: 0.0,
            color: [0.4, 0.6, 0.9, 1.0],
        }
    }
}

impl NodeInstance {
    /// 从 NodeData 创建实例
    pub fn from_node_data(node: &NodeData) -> Self {
        Self {
            position: [node.x, node.y],
            size: node.radius,
            _padding: 0.0,
            color: [node.color_r, node.color_g, node.color_b, node.color_a],
        }
    }

    /// 设置位置
    pub fn with_position(mut self, x: f32, y: f32) -> Self {
        self.position = [x, y];
        self
    }

    /// 设置大小
    pub fn with_size(mut self, size: f32) -> Self {
        self.size = size;
        self
    }

    /// 设置颜色
    pub fn with_color(mut self, r: f32, g: f32, b: f32, a: f32) -> Self {
        self.color = [r, g, b, a];
        self
    }
}

/// 边实例数据
/// 用于实例化渲染，每个实例一条边
#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct EdgeInstance {
    /// 源节点位置
    pub source: [f32; 2],

    /// 目标节点位置
    pub target: [f32; 2],

    /// 边颜色 RGBA
    pub color: [f32; 4],
}

impl Default for EdgeInstance {
    fn default() -> Self {
        Self {
            source: [0.0, 0.0],
            target: [0.0, 0.0],
            color: [0.5, 0.5, 0.5, 0.6],
        }
    }
}

impl EdgeInstance {
    /// 从 EdgeData 和节点位置创建实例
    pub fn from_edge_data(edge: &EdgeData, nodes: &[NodeData]) -> Self {
        let src_idx = edge.source_id as usize;
        let dst_idx = edge.target_id as usize;

        let (src_pos, dst_pos) = if src_idx < nodes.len() && dst_idx < nodes.len() {
            (
                [nodes[src_idx].x, nodes[src_idx].y],
                [nodes[dst_idx].x, nodes[dst_idx].y],
            )
        } else {
            ([0.0, 0.0], [0.0, 0.0])
        };

        Self {
            source: src_pos,
            target: dst_pos,
            color: [edge.color_r, edge.color_g, edge.color_b, edge.color_a],
        }
    }

    /// 设置源位置
    pub fn with_source(mut self, x: f32, y: f32) -> Self {
        self.source = [x, y];
        self
    }

    /// 设置目标位置
    pub fn with_target(mut self, x: f32, y: f32) -> Self {
        self.target = [x, y];
        self
    }

    /// 设置颜色
    pub fn with_color(mut self, r: f32, g: f32, b: f32, a: f32) -> Self {
        self.color = [r, g, b, a];
        self
    }
}

/// 实例缓冲区管理器
/// 管理节点和边的实例数据
pub struct InstanceManager {
    /// 节点实例数据
    node_instances: Vec<NodeInstance>,

    /// 边实例数据
    edge_instances: Vec<EdgeInstance>,

    /// 节点实例缓冲区
    node_buffer: Option<wgpu::Buffer>,

    /// 边实例缓冲区
    edge_buffer: Option<wgpu::Buffer>,
}

impl Default for InstanceManager {
    fn default() -> Self {
        Self::new()
    }
}

impl InstanceManager {
    /// 创建新的实例管理器
    pub fn new() -> Self {
        Self {
            node_instances: Vec::new(),
            edge_instances: Vec::new(),
            node_buffer: None,
            edge_buffer: None,
        }
    }

    /// 从节点数据更新实例
    pub fn update_nodes(&mut self, nodes: &[NodeData]) {
        self.node_instances.clear();
        self.node_instances
            .extend(nodes.iter().map(NodeInstance::from_node_data));
    }

    /// 从边数据更新实例
    pub fn update_edges(&mut self, edges: &[EdgeData], nodes: &[NodeData]) {
        self.edge_instances.clear();
        self.edge_instances
            .extend(edges.iter().map(|e| EdgeInstance::from_edge_data(e, nodes)));
    }

    /// 初始化 GPU 缓冲区
    pub fn init_buffers(&mut self, device: &wgpu::Device, max_nodes: u32, max_edges: u32) {
        // 创建节点实例缓冲区
        let node_buffer_size = max_nodes as u64 * std::mem::size_of::<NodeInstance>() as u64;
        self.node_buffer = Some(device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Node Instance Buffer"),
            size: node_buffer_size,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }));

        // 创建边实例缓冲区
        let edge_buffer_size = max_edges as u64 * std::mem::size_of::<EdgeInstance>() as u64;
        self.edge_buffer = Some(device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Edge Instance Buffer"),
            size: edge_buffer_size,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }));
    }

    /// 上传实例数据到 GPU
    pub fn upload(&self, queue: &wgpu::Queue) {
        if let Some(buffer) = &self.node_buffer {
            let bytes: &[u8] = bytemuck::cast_slice(&self.node_instances);
            queue.write_buffer(buffer, 0, bytes);
        }

        if let Some(buffer) = &self.edge_buffer {
            let bytes: &[u8] = bytemuck::cast_slice(&self.edge_instances);
            queue.write_buffer(buffer, 0, bytes);
        }
    }

    /// 获取节点实例缓冲区
    pub fn node_buffer(&self) -> Option<&wgpu::Buffer> {
        self.node_buffer.as_ref()
    }

    /// 获取边实例缓冲区
    pub fn edge_buffer(&self) -> Option<&wgpu::Buffer> {
        self.edge_buffer.as_ref()
    }

    /// 获取节点实例数量
    pub fn node_count(&self) -> u32 {
        self.node_instances.len() as u32
    }

    /// 获取边实例数量
    pub fn edge_count(&self) -> u32 {
        self.edge_instances.len() as u32
    }

    /// 节点实例顶点缓冲区布局
    pub fn node_vertex_buffer_layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<NodeInstance>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &[
                // position: vec2<f32>
                wgpu::VertexAttribute {
                    offset: 0,
                    shader_location: 0,
                    format: wgpu::VertexFormat::Float32x2,
                },
                // size: f32
                wgpu::VertexAttribute {
                    offset: 8,
                    shader_location: 1,
                    format: wgpu::VertexFormat::Float32,
                },
                // _padding: f32 (skip)
                // color: vec4<f32>
                wgpu::VertexAttribute {
                    offset: 16,
                    shader_location: 2,
                    format: wgpu::VertexFormat::Float32x4,
                },
            ],
        }
    }

    /// 边实例顶点缓冲区布局
    pub fn edge_vertex_buffer_layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<EdgeInstance>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &[
                // source: vec2<f32>
                wgpu::VertexAttribute {
                    offset: 0,
                    shader_location: 0,
                    format: wgpu::VertexFormat::Float32x2,
                },
                // target: vec2<f32>
                wgpu::VertexAttribute {
                    offset: 8,
                    shader_location: 1,
                    format: wgpu::VertexFormat::Float32x2,
                },
                // color: vec4<f32>
                wgpu::VertexAttribute {
                    offset: 16,
                    shader_location: 2,
                    format: wgpu::VertexFormat::Float32x4,
                },
            ],
        }
    }

    /// 销毁资源
    pub fn destroy(&mut self) {
        self.node_instances.clear();
        self.edge_instances.clear();
        self.node_buffer = None;
        self.edge_buffer = None;
    }
}