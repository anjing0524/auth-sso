//! 缩放和平移处理模块
//!
//! 实现视口变换交互

/// 视口状态
#[derive(Debug, Clone, Copy)]
pub struct Viewport {
    /// 缩放级别 (1.0 = 100%)
    pub zoom: f32,

    /// 平移 X (世界坐标)
    pub pan_x: f32,

    /// 平移 Y (世界坐标)
    pub pan_y: f32,

    /// 视口宽度 (像素)
    pub width: f32,

    /// 视口高度 (像素)
    pub height: f32,
}

impl Default for Viewport {
    fn default() -> Self {
        Self::new()
    }
}

impl Viewport {
    /// 创建新的视口
    pub fn new() -> Self {
        Self {
            zoom: 1.0,
            pan_x: 0.0,
            pan_y: 0.0,
            width: 800.0,
            height: 600.0,
        }
    }

    /// 设置视口尺寸
    pub fn set_size(&mut self, width: f32, height: f32) {
        self.width = width.max(1.0);
        self.height = height.max(1.0);
    }

    /// 缩放到指定级别
    pub fn zoom_to(&mut self, zoom: f32) {
        self.zoom = zoom.clamp(0.1, 10.0);
    }

    /// 相对于当前缩放
    pub fn zoom_by(&mut self, delta: f32) {
        self.zoom = (self.zoom * delta).clamp(0.1, 10.0);
    }

    /// 缩放到指定点（保持该点在屏幕上的位置不变）
    pub fn zoom_at_point(&mut self, zoom_delta: f32, screen_x: f32, screen_y: f32) {
        let old_zoom = self.zoom;
        let new_zoom = (self.zoom * zoom_delta).clamp(0.1, 10.0);

        if old_zoom != new_zoom {
            // 计算鼠标指向的世界坐标
            let world_x = (screen_x - self.width / 2.0) / old_zoom - self.pan_x;
            let world_y = (self.height / 2.0 - screen_y) / old_zoom - self.pan_y;

            // 更新缩放
            self.zoom = new_zoom;

            // 调整平移以保持鼠标位置不变
            self.pan_x = (screen_x - self.width / 2.0) / new_zoom - world_x;
            self.pan_y = (self.height / 2.0 - screen_y) / new_zoom - world_y;
        }
    }

    /// 平移
    pub fn pan_by(&mut self, dx: f32, dy: f32) {
        self.pan_x += dx / self.zoom;
        self.pan_y += dy / self.zoom;
    }

    /// 设置平移
    pub fn set_pan(&mut self, x: f32, y: f32) {
        self.pan_x = x;
        self.pan_y = y;
    }

    /// 屏幕坐标转世界坐标
    pub fn screen_to_world(&self, screen_x: f32, screen_y: f32) -> (f32, f32) {
        let world_x = (screen_x - self.width / 2.0) / self.zoom - self.pan_x;
        let world_y = (self.height / 2.0 - screen_y) / self.zoom - self.pan_y;
        (world_x, world_y)
    }

    /// 世界坐标转屏幕坐标
    pub fn world_to_screen(&self, world_x: f32, world_y: f32) -> (f32, f32) {
        let screen_x = (world_x + self.pan_x) * self.zoom + self.width / 2.0;
        let screen_y = self.height / 2.0 - (world_y + self.pan_y) * self.zoom;
        (screen_x, screen_y)
    }

    /// 重置视口
    pub fn reset(&mut self) {
        self.zoom = 1.0;
        self.pan_x = 0.0;
        self.pan_y = 0.0;
    }

    /// 适配所有节点到视口
    pub fn fit_nodes(&mut self, nodes: &[(f32, f32)], padding: f32) {
        if nodes.is_empty() {
            self.reset();
            return;
        }

        // 计算边界
        let mut min_x = f32::MAX;
        let mut max_x = f32::MIN;
        let mut min_y = f32::MAX;
        let mut max_y = f32::MIN;

        for &(x, y) in nodes {
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
        }

        let width = (max_x - min_x).max(1.0);
        let height = (max_y - min_y).max(1.0);

        // 计算缩放以适配视口
        let scale_x = (self.width - padding * 2.0) / width;
        let scale_y = (self.height - padding * 2.0) / height;
        self.zoom = scale_x.min(scale_y).clamp(0.1, 10.0);

        // 计算平移以居中
        let center_x = (min_x + max_x) / 2.0;
        let center_y = (min_y + max_y) / 2.0;
        self.pan_x = -center_x;
        self.pan_y = -center_y;
    }
}

/// 缩放处理器
pub struct ZoomHandler {
    /// 当前视口
    viewport: Viewport,

    /// 是否正在拖动平移
    is_panning: bool,

    /// 平移起始位置
    pan_start_x: f32,
    pan_start_y: f32,
}

impl Default for ZoomHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl ZoomHandler {
    /// 创建新的缩放处理器
    pub fn new() -> Self {
        Self {
            viewport: Viewport::new(),
            is_panning: false,
            pan_start_x: 0.0,
            pan_start_y: 0.0,
        }
    }

    /// 获取视口引用
    pub fn viewport(&self) -> &Viewport {
        &self.viewport
    }

    /// 获取视口可变引用
    pub fn viewport_mut(&mut self) -> &mut Viewport {
        &mut self.viewport
    }

    /// 开始平移（鼠标按下）
    pub fn start_pan(&mut self, screen_x: f32, screen_y: f32) {
        self.is_panning = true;
        self.pan_start_x = screen_x;
        self.pan_start_y = screen_y;
    }

    /// 更新平移（鼠标移动）
    pub fn update_pan(&mut self, screen_x: f32, screen_y: f32) {
        if self.is_panning {
            let dx = screen_x - self.pan_start_x;
            let dy = screen_y - self.pan_start_y;

            self.viewport.pan_by(dx, dy);

            self.pan_start_x = screen_x;
            self.pan_start_y = screen_y;
        }
    }

    /// 结束平移（鼠标释放）
    pub fn end_pan(&mut self) {
        self.is_panning = false;
    }

    /// 滚轮缩放
    pub fn wheel_zoom(&mut self, delta: f32, screen_x: f32, screen_y: f32) {
        let zoom_delta = if delta > 0.0 { 1.1 } else { 0.9 };
        self.viewport.zoom_at_point(zoom_delta, screen_x, screen_y);
    }
}