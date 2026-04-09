//! 力导向物理模拟
//!
//! 实现 GPU Compute Shader 和 CPU 回退的力导向布局

use crate::data::{EdgeData, NodeData};
use crate::renderer::context::GpuContext;
use crate::renderer::{EdgeBuffer, NodeBuffer, UniformBuffer};

use super::collision::CollisionDetector;
use super::force::{ForceCalculator, ForceParams};
use super::grid::SpatialGrid;

/// 模拟器模式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SimulationMode {
    /// GPU 计算着色器模式
    Gpu,
    /// CPU 回退模式（调试或 WebGL）
    Cpu,
}

/// 力导向模拟器
/// 使用 GPU Compute Shader 或 CPU 进行并行计算
pub struct ForceSimulator {
    /// 计算管线
    compute_pipeline: Option<wgpu::ComputePipeline>,

    /// 绑定组布局
    bind_group_layout: Option<wgpu::BindGroupLayout>,

    /// 绑定组
    bind_group: Option<wgpu::BindGroup>,

    /// 模拟参数
    params: ForceParams,

    /// 模拟模式
    mode: SimulationMode,

    /// CPU 端力计算器（回退）
    cpu_calculator: ForceCalculator,

    /// CPU 端碰撞检测器
    collision_detector: CollisionDetector,

    /// 空间网格（用于 CPU 模式优化）
    spatial_grid: SpatialGrid,

    /// 是否已初始化
    initialized: bool,
}

impl Default for ForceSimulator {
    fn default() -> Self {
        Self::new()
    }
}

impl ForceSimulator {
    /// 创建新的力导向模拟器
    pub fn new() -> Self {
        Self {
            compute_pipeline: None,
            bind_group_layout: None,
            bind_group: None,
            params: ForceParams::default(),
            mode: SimulationMode::Gpu,
            cpu_calculator: ForceCalculator::new(),
            collision_detector: CollisionDetector::new(),
            spatial_grid: SpatialGrid::new(),
            initialized: false,
        }
    }

    /// 设置模拟参数
    pub fn set_params(&mut self, params: ForceParams) {
        self.params = params;
        self.cpu_calculator.set_params(params);
    }

    /// 设置模拟模式
    pub fn set_mode(&mut self, mode: SimulationMode) {
        self.mode = mode;
    }

    /// 初始化 GPU 计算管线
    pub fn init_gpu(&mut self, gpu_context: &GpuContext) -> Result<(), String> {
        let device = gpu_context
            .device()
            .ok_or("GPU device not initialized")?;

        // 加载 WGSL 着色器
        let shader = device.create_shader_module(wgpu::include_wgsl!("../../shaders/force.wgsl"));

        // 创建绑定组布局
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Force Simulation Bind Group Layout"),
            entries: &[
                // Node Storage Buffer (read-write)
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage {
                            read_only: false,
                        },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Edge Storage Buffer (read-only)
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage {
                            read_only: true,
                        },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Uniform Buffer (simulation params)
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        // 创建计算管线
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Force Compute Pipeline Layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });

        let compute_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Force Compute Pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            cache: None,
        });

        self.compute_pipeline = Some(compute_pipeline);
        self.bind_group_layout = Some(bind_group_layout);
        self.initialized = true;

        Ok(())
    }

    /// 创建绑定组
    pub fn create_bind_group(
        &mut self,
        gpu_context: &GpuContext,
        node_buffer: &NodeBuffer,
        edge_buffer: &EdgeBuffer,
        uniform_buffer: &UniformBuffer,
    ) -> Result<(), String> {
        let device = gpu_context
            .device()
            .ok_or("GPU device not initialized")?;

        let bind_group_layout = self
            .bind_group_layout
            .as_ref()
            .ok_or("Bind group layout not initialized")?;

        let node_buf = node_buffer
            .buffer()
            .ok_or("Node buffer not initialized")?;
        let edge_buf = edge_buffer
            .buffer()
            .ok_or("Edge buffer not initialized")?;
        let uniform_buf = uniform_buffer
            .buffer()
            .ok_or("Uniform buffer not initialized")?;

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Force Simulation Bind Group"),
            layout: bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: node_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: edge_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: uniform_buf.as_entire_binding(),
                },
            ],
        });

        self.bind_group = Some(bind_group);
        Ok(())
    }

    /// 执行一次 GPU 计算步骤
    pub fn step_gpu(&self, gpu_context: &GpuContext, node_count: u32) -> Result<(), String> {
        let device = gpu_context
            .device()
            .ok_or("GPU device not initialized")?;
        let queue = gpu_context
            .queue()
            .ok_or("GPU queue not initialized")?;

        let pipeline = self
            .compute_pipeline
            .as_ref()
            .ok_or("Compute pipeline not initialized")?;
        let bind_group = self
            .bind_group
            .as_ref()
            .ok_or("Bind group not initialized")?;

        // 计算工作组大小（每个工作组 64 个线程）
        let workgroup_count = (node_count + 63) / 64;

        // 创建命令编码器
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Force Simulation Encoder"),
        });

        // 计算通道
        {
            let mut compute_pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Force Compute Pass"),
                timestamp_writes: None,
            });
            compute_pass.set_pipeline(pipeline);
            compute_pass.set_bind_group(0, bind_group, &[]);
            compute_pass.dispatch_workgroups(workgroup_count, 1, 1);
        }

        // 提交命令
        queue.submit(std::iter::once(encoder.finish()));

        Ok(())
    }

    /// 执行一次 CPU 计算步骤
    pub fn step_cpu(&mut self, nodes: &mut [NodeData], edges: &[EdgeData]) {
        // 1. 力计算
        self.cpu_calculator.step(nodes, edges);

        // 2. 碰撞检测和解决
        self.collision_detector.resolve_collisions(nodes);
    }

    /// 执行一次模拟步骤
    /// 自动选择 GPU 或 CPU 模式
    pub fn step(
        &mut self,
        gpu_context: &GpuContext,
        nodes: &mut [NodeData],
        edges: &[EdgeData],
        node_buffer: &NodeBuffer,
        edge_buffer: &EdgeBuffer,
        uniform_buffer: &UniformBuffer,
        queue: &wgpu::Queue,
    ) -> Result<(), String> {
        match self.mode {
            SimulationMode::Gpu => {
                // 上传节点数据到 GPU
                node_buffer.update(queue, nodes);
                edge_buffer.update(queue, edges);
                uniform_buffer.upload(queue);

                // 执行 GPU 计算
                self.step_gpu(gpu_context, nodes.len() as u32)?;

                // TODO: 从 GPU 读回数据
                // 目前 GPU 计算结果不可见，需要实现 Readback
                // 临时方案：同时运行 CPU 模拟
                self.step_cpu(nodes, edges);

                Ok(())
            }
            SimulationMode::Cpu => {
                self.step_cpu(nodes, edges);

                // 上传更新后的数据到 GPU
                node_buffer.update(queue, nodes);

                Ok(())
            }
        }
    }

    /// 获取当前节点位置（CPU 模式）
    pub fn get_positions(&self, nodes: &[NodeData]) -> Vec<(f32, f32)> {
        nodes.iter().map(|n| (n.x, n.y)).collect()
    }

    /// 检查是否已初始化
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    /// 销毁资源
    pub fn destroy(&mut self) {
        self.compute_pipeline = None;
        self.bind_group_layout = None;
        self.bind_group = None;
        self.initialized = false;
    }
}

impl Drop for ForceSimulator {
    fn drop(&mut self) {
        self.destroy();
    }
}