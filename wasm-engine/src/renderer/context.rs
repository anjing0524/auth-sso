//! GPU 上下文管理
//!
//! 初始化 WebGPU 设备、队列和表面

#[cfg(target_arch = "wasm32")]
use web_sys::HtmlCanvasElement;

/// GPU 上下文
/// 管理 WebGPU 设备、队列和表面
pub struct GpuContext {
    /// WebGPU 设备
    device: Option<wgpu::Device>,

    /// GPU 队列
    queue: Option<wgpu::Queue>,

    /// 配置的表面
    surface: Option<wgpu::Surface<'static>>,

    /// 表面格式
    surface_format: Option<wgpu::TextureFormat>,

    /// 是否已初始化
    initialized: bool,
}

impl Default for GpuContext {
    fn default() -> Self {
        Self::new()
    }
}

impl GpuContext {
    /// 创建新的 GPU 上下文
    pub fn new() -> Self {
        Self {
            device: None,
            queue: None,
            surface: None,
            surface_format: None,
            initialized: false,
        }
    }

    /// 初始化 GPU 上下文 (WASM 目标)
    /// 异步初始化 WebGPU 设备
    #[cfg(target_arch = "wasm32")]
    pub async fn init(&mut self, canvas: HtmlCanvasElement) -> Result<(), String> {
        // 检查 WebGPU 支持
        let _window = web_sys::window().ok_or("No window available")?;

        // 获取画布尺寸 (在移动 canvas 之前)
        let canvas_width = canvas.width();
        let canvas_height = canvas.height();

        // 获取 WebGPU 实例 - wgpu 29 API
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::BROWSER_WEBGPU,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });

        // 创建表面 - wgpu 29 SurfaceTarget::Canvas (仅 WASM)
        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| format!("Failed to create surface: {:?}", e))?;

        // 请求适配器 - wgpu 29 返回 Result
        // 先尝试正常请求，如果失败则使用 forceFallbackAdapter
        let adapter = match instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
        {
            Ok(adapter) => adapter,
            Err(_) => {
                // 尝试使用 fallback adapter
                instance
                    .request_adapter(&wgpu::RequestAdapterOptions {
                        power_preference: wgpu::PowerPreference::LowPower,
                        compatible_surface: Some(&surface),
                        force_fallback_adapter: true,
                    })
                    .await
                    .map_err(|_| "No suitable GPU adapter found. Please use Chrome or Edge browser.")?
            }
        };

        // 请求设备 - wgpu 29 API
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("Graph Engine Device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::MemoryUsage,
                trace: wgpu::Trace::Off,
                experimental_features: wgpu::ExperimentalFeatures::disabled(),
            })
            .await
            .map_err(|e| format!("Failed to request device: {:?}", e))?;

        // 配置表面 - 使用画布尺寸
        let size = wgpu::Extent3d {
            width: canvas_width,
            height: canvas_height,
            depth_or_array_layers: 1,
        };

        let surface_caps = surface.get_capabilities(&adapter);

        // 选择可用的表面格式 - 优先选择 SRGB，但不强制
        let surface_format = surface_caps
            .formats
            .iter()
            .copied()
            .find(|f| matches!(f, wgpu::TextureFormat::Rgba8UnormSrgb))
            .or_else(|| {
                surface_caps
                    .formats
                    .iter()
                    .copied()
                    .find(|f| matches!(f, wgpu::TextureFormat::Bgra8UnormSrgb))
            })
            .or_else(|| {
                surface_caps
                    .formats
                    .iter()
                    .copied()
                    .find(|f| matches!(f, wgpu::TextureFormat::Rgba8Unorm))
            })
            .or_else(|| {
                surface_caps
                    .formats
                    .iter()
                    .copied()
                    .find(|f| matches!(f, wgpu::TextureFormat::Bgra8Unorm))
            })
            .unwrap_or_else(|| {
                // 使用第一个可用格式
                surface_caps.formats[0]
            });

        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: surface_format,
            width: size.width,
            height: size.height,
            present_mode: wgpu::PresentMode::AutoVsync,
            alpha_mode: wgpu::CompositeAlphaMode::Auto,
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };

        surface.configure(&device, &config);

        self.device = Some(device);
        self.queue = Some(queue);
        self.surface = Some(surface);
        self.surface_format = Some(surface_format);
        self.initialized = true;

        Ok(())
    }

    /// 获取设备引用
    pub fn device(&self) -> Option<&wgpu::Device> {
        self.device.as_ref()
    }

    /// 获取队列引用
    pub fn queue(&self) -> Option<&wgpu::Queue> {
        self.queue.as_ref()
    }

    /// 获取表面引用
    pub fn surface(&self) -> Option<&wgpu::Surface<'static>> {
        self.surface.as_ref()
    }

    /// 获取表面格式
    pub fn surface_format(&self) -> Option<wgpu::TextureFormat> {
        self.surface_format
    }

    /// 检查是否已初始化
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    /// 调整大小
    pub fn resize(&mut self, width: u32, height: u32) {
        if let (Some(surface), Some(device), Some(format)) =
            (&self.surface, &self.device, self.surface_format)
        {
            let config = wgpu::SurfaceConfiguration {
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                format,
                width,
                height,
                present_mode: wgpu::PresentMode::AutoVsync,
                alpha_mode: wgpu::CompositeAlphaMode::Auto,
                view_formats: vec![],
                desired_maximum_frame_latency: 2,
            };
            surface.configure(device, &config);
        }
    }

    /// 销毁 GPU 资源
    pub fn destroy(&mut self) {
        self.device = None;
        self.queue = None;
        self.surface = None;
        self.surface_format = None;
        self.initialized = false;
    }
}

impl Drop for GpuContext {
    fn drop(&mut self) {
        self.destroy();
    }
}