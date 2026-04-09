//! 图数据模块
//!
//! 定义节点、边和图存储结构

pub mod edge;
pub mod graph_store;
pub mod node;

pub use edge::{EdgeData, EdgeType};
pub use graph_store::{EdgeLabel, GraphStore, NodeLabel};
pub use node::NodeData;