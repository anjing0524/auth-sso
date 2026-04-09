//! 交互处理模块
//!
//! 处理鼠标拖动、缩放、点击检测等交互

/// 交互处理器
/// 管理用户与图的交互状态
pub struct InteractionHandler {
    /// 当前拖动的节点 ID
    dragged_node: Option<u32>,

    /// 悬停的节点 ID
    hovered_node: Option<u32>,

    /// 选中的节点 ID
    selected_node: Option<u32>,

    /// 缩放级别
    zoom: f32,

    /// 平移偏移 X
    pan_x: f32,

    /// 平移偏移 Y
    pan_y: f32,

    /// 画布宽度
    canvas_width: f32,

    /// 画布高度
    canvas_height: f32,
}

impl Default for InteractionHandler {
    fn default() -> Self {
        Self::new()
    }
}

impl InteractionHandler {
    /// 创建新的交互处理器
    pub fn new() -> Self {
        Self {
            dragged_node: None,
            hovered_node: None,
            selected_node: None,
            zoom: 1.0,
            pan_x: 0.0,
            pan_y: 0.0,
            canvas_width: 800.0,
            canvas_height: 600.0,
        }
    }

    /// 处理鼠标移动
    pub fn on_mouse_move(&mut self, _x: f32, _y: f32) {
        // TODO: 实现鼠标移动处理
    }

    /// 处理鼠标按下
    pub fn on_mouse_down(&mut self, _x: f32, _y: f32) {
        // TODO: 实现鼠标按下处理
    }

    /// 处理鼠标释放
    pub fn on_mouse_up(&mut self) {
        self.dragged_node = None;
    }

    /// 处理滚轮缩放
    pub fn on_wheel(&mut self, _delta: f32) {
        // TODO: 实现缩放处理
    }

    /// 点击检测
    /// 返回点击位置的节点 ID（如果有）
    pub fn hit_test(&self, _x: f32, _y: f32) -> Option<u32> {
        // TODO: 实现点击检测
        None
    }

    /// 获取悬停节点
    pub fn get_hovered_node(&self) -> Option<u32> {
        self.hovered_node
    }

    /// 获取选中节点
    pub fn get_selected_node(&self) -> Option<u32> {
        self.selected_node
    }

    /// 设置画布尺寸
    pub fn set_canvas_size(&mut self, width: f32, height: f32) {
        self.canvas_width = width;
        self.canvas_height = height;
    }

    /// 屏幕坐标转世界坐标
    pub fn screen_to_world(&self, screen_x: f32, screen_y: f32) -> (f32, f32) {
        let world_x = (screen_x - self.canvas_width / 2.0) / self.zoom + self.pan_x;
        let world_y = (screen_y - self.canvas_height / 2.0) / self.zoom + self.pan_y;
        (world_x, world_y)
    }

    /// 世界坐标转屏幕坐标
    pub fn world_to_screen(&self, world_x: f32, world_y: f32) -> (f32, f32) {
        let screen_x = (world_x - self.pan_x) * self.zoom + self.canvas_width / 2.0;
        let screen_y = (world_y - self.pan_y) * self.zoom + self.canvas_height / 2.0;
        (screen_x, screen_y)
    }

    /// 获取当前缩放级别
    pub fn get_zoom(&self) -> f32 {
        self.zoom
    }

    /// 获取当前平移偏移
    pub fn get_pan(&self) -> (f32, f32) {
        (self.pan_x, self.pan_y)
    }
}