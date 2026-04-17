//! 渲染管线
//!
//! 管理 WebGPU 渲染管线和实例化绘制

use crate::renderer::context::GpuContext;
use crate::renderer::instance::InstanceManager;
use crate::renderer::UniformBuffer;

/// 渲染管线
/// 管理顶点/片段着色器和实例化绘制
pub struct RenderPipeline {
    /// 节点渲染管线
    node_pipeline: Option<wgpu::RenderPipeline>,

    /// 边渲染管线
    edge_pipeline: Option<wgpu::RenderPipeline>,

    /// 绑定组布局
    bind_group_layout: Option<wgpu::BindGroupLayout>,

    /// 绑定组
    bind_group: Option<wgpu::BindGroup>,
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
            node_pipeline: None,
            edge_pipeline: None,
            bind_group_layout: None,
            bind_group: None,
        }
    }

    /// 初始化渲染管线
    pub fn init(&mut self, gpu_context: &GpuContext) -> Result<(), String> {
        let device = gpu_context
            .device()
            .ok_or("GPU device not initialized")?;

        let surface_format = gpu_context
            .surface_format()
            .ok_or("Surface format not initialized")?;

        // 创建绑定组布局
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Render Bind Group Layout"),
            entries: &[
                // Uniform Buffer (camera params)
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        // 创建管线布局
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Render Pipeline Layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });

        // 加载节点着色器
        let node_shader = device.create_shader_module(wgpu::include_wgsl!("../../shaders/node.wgsl"));

        // 创建节点渲染管线
        let node_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Node Render Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &node_shader,
                entry_point: Some("vs_node"),
                buffers: &[crate::renderer::instance::InstanceManager::node_vertex_buffer_layout()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &node_shader,
                entry_point: Some("fs_node"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: surface_format,
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

        // 加载边着色器
        let edge_shader = device.create_shader_module(wgpu::include_wgsl!("../../shaders/edge.wgsl"));

        // 创建边渲染管线
        let edge_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Edge Render Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &edge_shader,
                entry_point: Some("vs_edge"),
                buffers: &[crate::renderer::instance::InstanceManager::edge_vertex_buffer_layout()],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &edge_shader,
                entry_point: Some("fs_edge"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: surface_format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::LineList,
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

        self.node_pipeline = Some(node_pipeline);
        self.edge_pipeline = Some(edge_pipeline);
        self.bind_group_layout = Some(bind_group_layout);

        Ok(())
    }

    /// 创建绑定组
    pub fn create_bind_group(
        &mut self,
        gpu_context: &GpuContext,
        uniform_buffer: &UniformBuffer,
    ) -> Result<(), String> {
        let device = gpu_context
            .device()
            .ok_or("GPU device not initialized")?;

        let bind_group_layout = self
            .bind_group_layout
            .as_ref()
            .ok_or("Bind group layout not initialized")?;

        let uniform_buf = uniform_buffer
            .buffer()
            .ok_or("Uniform buffer not initialized")?;

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Render Bind Group"),
            layout: bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buf.as_entire_binding(),
            }],
        });

        self.bind_group = Some(bind_group);
        Ok(())
    }

    /// 渲染帧
    pub fn render(
        &self,
        gpu_context: &GpuContext,
        instance_manager: &InstanceManager,
    ) -> Result<(), String> {
        let device = gpu_context
            .device()
            .ok_or("GPU device not initialized")?;

        let surface = gpu_context
            .surface()
            .ok_or("Surface not initialized")?;

        let node_pipeline = self
            .node_pipeline
            .as_ref()
            .ok_or("Node pipeline not initialized")?;

        let edge_pipeline = self
            .edge_pipeline
            .as_ref()
            .ok_or("Edge pipeline not initialized")?;

        let bind_group = self
            .bind_group
            .as_ref()
            .ok_or("Bind group not initialized")?;

        let node_instance_buffer = instance_manager
            .node_buffer()
            .ok_or("Node instance buffer not initialized")?;

        let edge_instance_buffer = instance_manager
            .edge_buffer()
            .ok_or("Edge instance buffer not initialized")?;

        // 获取当前纹理
        let output = match surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(texture) => texture,
            wgpu::CurrentSurfaceTexture::Suboptimal(texture) => texture,
            wgpu::CurrentSurfaceTexture::Timeout => {
                return Err("Failed to get current texture: timeout".to_string())
            }
            wgpu::CurrentSurfaceTexture::Occluded => {
                return Err("Failed to get current texture: occluded".to_string())
            }
            wgpu::CurrentSurfaceTexture::Outdated => {
                return Err("Failed to get current texture: outdated".to_string())
            }
            wgpu::CurrentSurfaceTexture::Lost => {
                return Err("Failed to get current texture: lost".to_string())
            }
            wgpu::CurrentSurfaceTexture::Validation => {
                return Err("Failed to get current texture: validation error".to_string())
            }
        };

        let view = output
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        // 创建命令编码器
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Render Encoder"),
        });

        // 渲染通道
        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.1,
                            g: 0.1,
                            b: 0.15,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });

            // 绘制边（先绘制，在节点下面）
            render_pass.set_pipeline(edge_pipeline);
            render_pass.set_bind_group(0, bind_group, &[]);
            render_pass.set_vertex_buffer(0, edge_instance_buffer.slice(..));

            // 每条边 2 个顶点
            let edge_count = instance_manager.edge_count();
            render_pass.draw(0..2, 0..edge_count);

            // 绘制节点（实例化）
            render_pass.set_pipeline(node_pipeline);
            render_pass.set_bind_group(0, bind_group, &[]);
            render_pass.set_vertex_buffer(0, node_instance_buffer.slice(..));

            let node_count = instance_manager.node_count();
            // 每个节点绘制一个圆形（32个三角形，每个三角形3个顶点 = 96顶点）
            render_pass.draw(0..96, 0..node_count);
        }

        // 提交命令
        let queue = gpu_context.queue().ok_or("GPU queue not initialized")?;
        queue.submit(std::iter::once(encoder.finish()));
        output.present();

        Ok(())
    }

    /// 销毁资源
    pub fn destroy(&mut self) {
        self.node_pipeline = None;
        self.edge_pipeline = None;
        self.bind_group_layout = None;
        self.bind_group = None;
    }
}

impl Drop for RenderPipeline {
    fn drop(&mut self) {
        self.destroy();
    }
}