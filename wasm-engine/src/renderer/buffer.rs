//! GPU 缓冲区管理
//!
//! 创建和管理 Storage Buffers 用于节点和边数据

use crate::data::{EdgeData, NodeData};

/// 缓冲区大小常量
pub const MAX_NODES: u64 = 100_000;
pub const MAX_EDGES: u64 = 500_000;

/// 节点缓冲区管理器
/// 管理 GPU Storage Buffer 用于节点数据
pub struct NodeBuffer {
    /// GPU 缓冲区
    buffer: Option<wgpu::Buffer>,

    /// 当前节点数量
    node_count: u32,
}

impl Default for NodeBuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl NodeBuffer {
    /// 创建新的节点缓冲区
    pub fn new() -> Self {
        Self {
            buffer: None,
            node_count: 0,
        }
    }

    /// 初始化缓冲区
    /// 在 GPU 上分配 Storage Buffer
    pub fn init(&mut self, device: &wgpu::Device, initial_capacity: u32) {
        let capacity = initial_capacity.max(1000) as u64;
        let buffer_size = capacity * std::mem::size_of::<NodeData>() as u64;

        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Node Storage Buffer"),
            size: buffer_size,
            usage: wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_DST
                | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        self.buffer = Some(buffer);
        self.node_count = 0;
    }

    /// 更新节点数据
    /// 将 CPU 端节点数据上传到 GPU
    pub fn update(&self, queue: &wgpu::Queue, nodes: &[NodeData]) {
        if let Some(buffer) = &self.buffer {
            let bytes: &[u8] = bytemuck::cast_slice(nodes);
            queue.write_buffer(buffer, 0, bytes);
        }
    }

    /// 获取缓冲区引用
    pub fn buffer(&self) -> Option<&wgpu::Buffer> {
        self.buffer.as_ref()
    }

    /// 获取当前节点数量
    pub fn count(&self) -> u32 {
        self.node_count
    }

    /// 设置节点数量
    pub fn set_count(&mut self, count: u32) {
        self.node_count = count;
    }

    /// 销毁缓冲区
    pub fn destroy(&mut self) {
        self.buffer = None;
        self.node_count = 0;
    }
}

/// 边缓冲区管理器
/// 管理 GPU Storage Buffer 用于边数据
pub struct EdgeBuffer {
    /// GPU 缓冲区
    buffer: Option<wgpu::Buffer>,

    /// 当前边数量
    edge_count: u32,
}

impl Default for EdgeBuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl EdgeBuffer {
    /// 创建新的边缓冲区
    pub fn new() -> Self {
        Self {
            buffer: None,
            edge_count: 0,
        }
    }

    /// 初始化缓冲区
    /// 在 GPU 上分配 Storage Buffer
    pub fn init(&mut self, device: &wgpu::Device, initial_capacity: u32) {
        let capacity = initial_capacity.max(1000) as u64;
        let buffer_size = capacity * std::mem::size_of::<EdgeData>() as u64;

        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Edge Storage Buffer"),
            size: buffer_size,
            usage: wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_DST
                | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        self.buffer = Some(buffer);
        self.edge_count = 0;
    }

    /// 更新边数据
    /// 将 CPU 端边数据上传到 GPU
    pub fn update(&self, queue: &wgpu::Queue, edges: &[EdgeData]) {
        if let Some(buffer) = &self.buffer {
            let bytes: &[u8] = bytemuck::cast_slice(edges);
            queue.write_buffer(buffer, 0, bytes);
        }
    }

    /// 获取缓冲区引用
    pub fn buffer(&self) -> Option<&wgpu::Buffer> {
        self.buffer.as_ref()
    }

    /// 获取当前边数量
    pub fn count(&self) -> u32 {
        self.edge_count
    }

    /// 设置边数量
    pub fn set_count(&mut self, count: u32) {
        self.edge_count = count;
    }

    /// 销毁缓冲区
    pub fn destroy(&mut self) {
        self.buffer = None;
        self.edge_count = 0;
    }
}

/// 统一缓冲区 (Uniform Buffer)
/// 用于传递相机参数等全局数据
#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct UniformData {
    /// 视口宽度
    pub viewport_width: f32,
    /// 视口高度
    pub viewport_height: f32,
    /// 缩放级别
    pub zoom: f32,
    /// 平移 X
    pub pan_x: f32,
    /// 平移 Y
    pub pan_y: f32,
    /// 填充
    pub _padding: [f32; 3],
}

impl Default for UniformData {
    fn default() -> Self {
        Self {
            viewport_width: 800.0,
            viewport_height: 600.0,
            zoom: 1.0,
            pan_x: 0.0,
            pan_y: 0.0,
            _padding: [0.0; 3],
        }
    }
}

/// 统一缓冲区管理器
pub struct UniformBuffer {
    /// GPU 缓冲区
    buffer: Option<wgpu::Buffer>,

    /// 当前数据
    data: UniformData,
}

impl Default for UniformBuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl UniformBuffer {
    /// 创建新的统一缓冲区
    pub fn new() -> Self {
        Self {
            buffer: None,
            data: UniformData::default(),
        }
    }

    /// 初始化缓冲区
    pub fn init(&mut self, device: &wgpu::Device) {
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Uniform Buffer"),
            size: std::mem::size_of::<UniformData>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        self.buffer = Some(buffer);
    }

    /// 更新视口参数
    pub fn set_viewport(&mut self, width: f32, height: f32, zoom: f32, pan_x: f32, pan_y: f32) {
        self.data.viewport_width = width;
        self.data.viewport_height = height;
        self.data.zoom = zoom;
        self.data.pan_x = pan_x;
        self.data.pan_y = pan_y;
    }

    /// 上传数据到 GPU
    pub fn upload(&self, queue: &wgpu::Queue) {
        if let Some(buffer) = &self.buffer {
            queue.write_buffer(buffer, 0, bytemuck::bytes_of(&self.data));
        }
    }

    /// 获取缓冲区引用
    pub fn buffer(&self) -> Option<&wgpu::Buffer> {
        self.buffer.as_ref()
    }

    /// 销毁缓冲区
    pub fn destroy(&mut self) {
        self.buffer = None;
    }
}