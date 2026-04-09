//! 渲染管线
//!
//! 管理 WebGPU 渲染管线和绘制逻辑

use crate::data::{EdgeData, NodeData};
use crate::renderer::context::GpuContext;

/// 渲染管线
/// 管理顶点/片段着色器和实例化绘制
pub struct RenderPipeline {
    /// WebGPU 渲染管线
    pipeline: Option<wgpu::RenderPipeline>,

    /// 节点缓冲区
    node_buffer: Option<wgpu::Buffer>,

    /// 边缓冲区
    edge_buffer: Option<wgpu::Buffer>,

    /// 统一缓冲区（相机参数等）
    uniform_buffer: Option<wgpu::Buffer>,

    /// 绑定组
    bind_group: Option<wgpu::BindGroup>,

    /// 绑定组布局
    bind_group_layout: Option<wgpu::BindGroupLayout>,
}

impl Default for RenderPipeline {
    fn default() -> Self {
        Self::new()
    }
}

impl RenderPipeline {
    /// 创建新的渲染管线
    pub fn new() -> Self {
        Self {
            pipeline: None,
            node_buffer: None,
            edge_buffer: None,
            uniform_buffer: None,
            bind_group: None,
            bind_group_layout: None,
        }
    }

    /// 初始化渲染管线
    pub fn init(&mut self, gpu_context: &GpuContext) -> Result<(), String> {
        let device = gpu_context
            .device()
            .ok_or("GPU device not initialized")?;

        // 使用 wgpu 内置宏加载 WGSL 着色器
        let shader = device.create_shader_module(wgpu::include_wgsl!("../../shaders/node.wgsl"));

        // 创建渲染管线
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Graph Render Pipeline"),
            layout: None,
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Bgra8UnormSrgb,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState {
                count: 1,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview_mask: None,
            cache: None,
        });

        self.pipeline = Some(pipeline);
        Ok(())
    }

    /// 更新节点数据
    pub fn update_nodes(&mut self, _gpu_context: &GpuContext, _nodes: &[NodeData]) {
        // TODO: 实现节点数据更新
    }

    /// 更新边数据
    pub fn update_edges(&mut self, _gpu_context: &GpuContext, _edges: &[EdgeData]) {
        // TODO: 实现边数据更新
    }

    /// 渲染帧
    pub fn render(&self, _gpu_context: &GpuContext) -> Result<(), String> {
        // TODO: 实现渲染逻辑
        Ok(())
    }

    /// 销毁资源
    pub fn destroy(&mut self) {
        self.pipeline = None;
        self.node_buffer = None;
        self.edge_buffer = None;
        self.uniform_buffer = None;
        self.bind_group = None;
        self.bind_group_layout = None;
    }
}

impl Drop for RenderPipeline {
    fn drop(&mut self) {
        self.destroy();
    }
}