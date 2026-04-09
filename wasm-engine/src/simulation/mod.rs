//! 力导向模拟模块
//!
//! GPU Compute Shader 实现的力导向布局算法

pub mod collision;
pub mod force;
pub mod grid;
pub mod physics;

pub use collision::CollisionDetector;
pub use force::{ForceCalculator, ForceParams};
pub use grid::{GridStats, SpatialGrid};
pub use physics::{ForceSimulator, SimulationMode};