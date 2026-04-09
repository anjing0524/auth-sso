//! 渲染模块
//!
//! WebGPU 渲染管线和 GPU 资源管理

pub mod buffer;
pub mod context;
pub mod instance;
pub mod pipeline;

pub use buffer::{EdgeBuffer, NodeBuffer, UniformBuffer, UniformData};
pub use context::GpuContext;
pub use instance::{EdgeInstance, InstanceManager, NodeInstance};
pub use pipeline::RenderPipeline;