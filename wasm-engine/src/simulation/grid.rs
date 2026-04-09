//! 空间网格加速模块
//!
//! 实现空间划分以优化斥力计算从 O(n^2) 到 O(n)

/// 空间网格单元
#[derive(Debug, Clone)]
pub struct GridCell {
    /// 单元内的节点索引列表
    pub node_indices: Vec<u32>,
}

impl Default for GridCell {
    fn default() -> Self {
        Self::new()
    }
}

impl GridCell {
    /// 创建新的网格单元
    pub fn new() -> Self {
        Self {
            node_indices: Vec::new(),
        }
    }

    /// 添加节点
    pub fn add_node(&mut self, index: u32) {
        self.node_indices.push(index);
    }

    /// 清空
    pub fn clear(&mut self) {
        self.node_indices.clear();
    }
}

/// 空间网格
/// 将空间划分为网格以加速邻居查找
pub struct SpatialGrid {
    /// 单元大小
    cell_size: f32,

    /// 网格宽度（列数）
    grid_width: u32,

    /// 网格高度（行数）
    grid_height: u32,

    /// 网格单元
    cells: Vec<GridCell>,

    /// 世界边界
    min_x: f32,
    max_x: f32,
    min_y: f32,
    max_y: f32,
}

impl Default for SpatialGrid {
    fn default() -> Self {
        Self::new()
    }
}

impl SpatialGrid {
    /// 创建新的空间网格
    pub fn new() -> Self {
        Self {
            cell_size: 100.0,
            grid_width: 10,
            grid_height: 10,
            cells: Vec::new(),
            min_x: -500.0,
            max_x: 500.0,
            min_y: -500.0,
            max_y: 500.0,
        }
    }

    /// 设置网格参数
    pub fn configure(
        &mut self,
        cell_size: f32,
        min_x: f32,
        max_x: f32,
        min_y: f32,
        max_y: f32,
    ) {
        self.cell_size = cell_size.max(10.0);
        self.min_x = min_x;
        self.max_x = max_x;
        self.min_y = min_y;
        self.max_y = max_y;

        // 计算网格尺寸
        self.grid_width = ((max_x - min_x) / self.cell_size).ceil() as u32;
        self.grid_height = ((max_y - min_y) / self.cell_size).ceil() as u32;

        // 确保至少 1x1
        self.grid_width = self.grid_width.max(1);
        self.grid_height = self.grid_height.max(1);
    }

    /// 初始化网格
    pub fn init(&mut self) {
        let total_cells = (self.grid_width * self.grid_height) as usize;
        self.cells.clear();
        self.cells.reserve(total_cells);
        for _ in 0..total_cells {
            self.cells.push(GridCell::new());
        }
    }

    /// 清空所有单元
    pub fn clear(&mut self) {
        for cell in &mut self.cells {
            cell.clear();
        }
    }

    /// 将世界坐标转换为网格坐标
    #[inline]
    pub fn world_to_grid(&self, x: f32, y: f32) -> (u32, u32) {
        let gx = ((x - self.min_x) / self.cell_size).floor() as i32;
        let gy = ((y - self.min_y) / self.cell_size).floor() as i32;

        // 限制在网格范围内
        let gx = gx.clamp(0, self.grid_width as i32 - 1) as u32;
        let gy = gy.clamp(0, self.grid_height as i32 - 1) as u32;

        (gx, gy)
    }

    /// 将网格坐标转换为线性索引
    #[inline]
    pub fn grid_to_index(&self, gx: u32, gy: u32) -> usize {
        (gy * self.grid_width + gx) as usize
    }

    /// 添加节点到网格
    pub fn add_node(&mut self, index: u32, x: f32, y: f32) {
        let (gx, gy) = self.world_to_grid(x, y);
        let cell_index = self.grid_to_index(gx, gy);

        if cell_index < self.cells.len() {
            self.cells[cell_index].add_node(index);
        }
    }

    /// 获取节点所在单元的邻居节点
    /// 包括当前单元和相邻 8 个单元
    pub fn get_neighbors(&self, x: f32, y: f32) -> Vec<u32> {
        let (gx, gy) = self.world_to_grid(x, y);
        let mut neighbors = Vec::new();

        // 遍历 3x3 邻域
        for dy in -1i32..=1 {
            for dx in -1i32..=1 {
                let nx = gx as i32 + dx;
                let ny = gy as i32 + dy;

                // 边界检查
                if nx >= 0 && nx < self.grid_width as i32 && ny >= 0 && ny < self.grid_height as i32
                {
                    let cell_index = self.grid_to_index(nx as u32, ny as u32);
                    if cell_index < self.cells.len() {
                        neighbors.extend_from_slice(&self.cells[cell_index].node_indices);
                    }
                }
            }
        }

        neighbors
    }

    /// 获取网格统计信息
    pub fn stats(&self) -> GridStats {
        let mut total_nodes = 0;
        let mut max_nodes_per_cell = 0;
        let mut empty_cells = 0;

        for cell in &self.cells {
            let count = cell.node_indices.len();
            total_nodes += count;
            max_nodes_per_cell = max_nodes_per_cell.max(count);
            if count == 0 {
                empty_cells += 1;
            }
        }

        GridStats {
            total_cells: self.cells.len(),
            total_nodes,
            max_nodes_per_cell,
            empty_cells,
            avg_nodes_per_cell: if !self.cells.is_empty() {
                total_nodes as f32 / self.cells.len() as f32
            } else {
                0.0
            },
        }
    }
}

/// 网格统计信息
#[derive(Debug, Clone, Copy)]
pub struct GridStats {
    pub total_cells: usize,
    pub total_nodes: usize,
    pub max_nodes_per_cell: usize,
    pub empty_cells: usize,
    pub avg_nodes_per_cell: f32,
}