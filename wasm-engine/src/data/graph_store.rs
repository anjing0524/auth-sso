//! CPU 端图数据存储
//!
//! 使用 petgraph 提供图结构，支持邻居查询、搜索过滤等操作

use petgraph::graph::{EdgeIndex, NodeIndex, UnGraph};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::edge::EdgeData;
use super::node::NodeData;

/// 节点标签类型（用于搜索和显示）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeLabel {
    /// 客户名称
    pub name: String,
    /// 客户 ID（业务 ID）
    pub customer_id: String,
    /// 客户类型
    pub customer_type: String,
    /// 关联数量
    pub relationship_count: u32,
    /// 主要行业
    pub primary_industry: Option<String>,
}

impl Default for NodeLabel {
    fn default() -> Self {
        Self {
            name: String::new(),
            customer_id: String::new(),
            customer_type: "enterprise".to_string(),
            relationship_count: 0,
            primary_industry: None,
        }
    }
}

/// 边标签类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeLabel {
    /// 关联类型
    pub relationship_type: String,
    /// 元数据
    pub metadata: Option<HashMap<String, String>>,
}

impl Default for EdgeLabel {
    fn default() -> Self {
        Self {
            relationship_type: "partnership".to_string(),
            metadata: None,
        }
    }
}

/// 图存储结构体
/// 使用 petgraph::UnGraph 作为底层图结构
pub struct GraphStore {
    /// petgraph 无向图
    graph: UnGraph<NodeLabel, EdgeLabel>,

    /// 客户 ID 到节点索引的映射
    customer_id_to_index: HashMap<String, NodeIndex>,

    /// 节点索引到内部 ID 的映射
    index_to_internal_id: HashMap<NodeIndex, u32>,

    /// GPU 节点数据缓存
    node_data_cache: Vec<NodeData>,

    /// GPU 边数据缓存
    edge_data_cache: Vec<EdgeData>,

    /// 下一个内部节点 ID
    next_node_id: u32,

    /// 缓存是否需要更新
    cache_dirty: bool,
}

impl Default for GraphStore {
    fn default() -> Self {
        Self::new()
    }
}

impl GraphStore {
    /// 创建新的图存储
    pub fn new() -> Self {
        Self {
            graph: UnGraph::new_undirected(),
            customer_id_to_index: HashMap::new(),
            index_to_internal_id: HashMap::new(),
            node_data_cache: Vec::new(),
            edge_data_cache: Vec::new(),
            next_node_id: 0,
            cache_dirty: true,
        }
    }

    /// 添加节点
    /// 返回内部节点 ID
    pub fn add_node(&mut self, customer_id: String, label: NodeLabel) -> u32 {
        // 检查是否已存在
        if let Some(&idx) = self.customer_id_to_index.get(&customer_id) {
            // 更新现有节点
            self.graph[idx] = label;
            return self.index_to_internal_id[&idx];
        }

        // 添加新节点
        let idx = self.graph.add_node(label.clone());
        let internal_id = self.next_node_id;
        self.next_node_id += 1;

        self.customer_id_to_index.insert(customer_id, idx);
        self.index_to_internal_id.insert(idx, internal_id);
        self.cache_dirty = true;

        internal_id
    }

    /// 添加边
    pub fn add_edge(
        &mut self,
        source_customer_id: &str,
        target_customer_id: &str,
        label: EdgeLabel,
    ) -> Option<EdgeIndex> {
        let source_idx = self.customer_id_to_index.get(source_customer_id)?;
        let target_idx = self.customer_id_to_index.get(target_customer_id)?;

        let edge_idx = self.graph.add_edge(*source_idx, *target_idx, label);
        self.cache_dirty = true;

        Some(edge_idx)
    }

    /// 获取节点邻居
    pub fn get_neighbors(&self, customer_id: &str) -> Option<Vec<&NodeLabel>> {
        let idx = self.customer_id_to_index.get(customer_id)?;
        let neighbors: Vec<&NodeLabel> = self
            .graph
            .neighbors(*idx)
            .map(|n| &self.graph[n])
            .collect();
        Some(neighbors)
    }

    /// 获取节点度数
    pub fn get_degree(&self, customer_id: &str) -> Option<usize> {
        let idx = self.customer_id_to_index.get(customer_id)?;
        Some(self.graph.neighbors(*idx).count())
    }

    /// 按名称搜索节点
    pub fn search_by_name(&self, query: &str) -> Vec<&NodeLabel> {
        let query_lower = query.to_lowercase();
        self.graph
            .node_weights()
            .filter(|label| label.name.to_lowercase().contains(&query_lower))
            .collect()
    }

    /// 按客户类型过滤
    pub fn filter_by_type(&self, customer_type: &str) -> Vec<&NodeLabel> {
        self.graph
            .node_weights()
            .filter(|label| label.customer_type == customer_type)
            .collect()
    }

    /// 获取节点数量
    pub fn node_count(&self) -> usize {
        self.graph.node_count()
    }

    /// 获取边数量
    pub fn edge_count(&self) -> usize {
        self.graph.edge_count()
    }

    /// 获取 GPU 节点数据缓存
    /// 如果缓存过期，会重新计算
    pub fn get_node_data(&mut self) -> &[NodeData] {
        if self.cache_dirty {
            self.update_cache();
        }
        &self.node_data_cache
    }

    /// 获取 GPU 边数据缓存
    pub fn get_edge_data(&mut self) -> &[EdgeData] {
        if self.cache_dirty {
            self.update_cache();
        }
        &self.edge_data_cache
    }

    /// 更新缓存
    fn update_cache(&mut self) {
        // 计算每个节点的度数
        let mut degrees: HashMap<NodeIndex, u32> = HashMap::new();
        for idx in self.graph.node_indices() {
            degrees.insert(idx, self.graph.neighbors(idx).count() as u32);
        }

        // 构建节点数据缓存
        self.node_data_cache.clear();
        for idx in self.graph.node_indices() {
            let _label = &self.graph[idx];
            let degree = degrees.get(&idx).copied().unwrap_or(0);
            let internal_id = self.index_to_internal_id.get(&idx).copied().unwrap_or(0);

            // 基于度数计算半径（范围 5-30）
            let radius = 5.0 + (degree as f32).min(25.0);

            let node_data = NodeData::new(internal_id, 0.0, 0.0)
                .with_radius(radius)
                .with_degree(degree);

            self.node_data_cache.push(node_data);
        }

        // 构建边数据缓存
        self.edge_data_cache.clear();
        for edge_idx in self.graph.edge_indices() {
            let (source, target) = self.graph.edge_endpoints(edge_idx).unwrap();
            let source_id = self.index_to_internal_id.get(&source).copied().unwrap_or(0);
            let target_id = self.index_to_internal_id.get(&target).copied().unwrap_or(0);

            let edge_data = EdgeData::new(source_id, target_id);
            self.edge_data_cache.push(edge_data);
        }

        self.cache_dirty = false;
    }

    /// 更新节点位置（从 GPU 回传）
    pub fn update_positions(&mut self, positions: &[(f32, f32)]) {
        for (i, pos) in positions.iter().enumerate() {
            if i < self.node_data_cache.len() {
                self.node_data_cache[i].x = pos.0;
                self.node_data_cache[i].y = pos.1;
            }
        }
    }

    /// 清空图
    pub fn clear(&mut self) {
        self.graph = UnGraph::new_undirected();
        self.customer_id_to_index.clear();
        self.index_to_internal_id.clear();
        self.node_data_cache.clear();
        self.edge_data_cache.clear();
        self.next_node_id = 0;
        self.cache_dirty = true;
    }

    /// 获取节点标签
    pub fn get_node_label(&self, customer_id: &str) -> Option<&NodeLabel> {
        let idx = self.customer_id_to_index.get(customer_id)?;
        Some(&self.graph[*idx])
    }

    /// 根据内部 ID 获取客户 ID
    pub fn get_customer_id(&self, internal_id: u32) -> Option<String> {
        for (&idx, &id) in &self.index_to_internal_id {
            if id == internal_id {
                return self
                    .customer_id_to_index
                    .iter()
                    .find(|(_, &i)| i == idx)
                    .map(|(cid, _)| cid.clone());
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_node() {
        let mut store = GraphStore::new();
        let label = NodeLabel {
            name: "Test Customer".to_string(),
            customer_id: "cust-001".to_string(),
            ..Default::default()
        };

        let id = store.add_node("cust-001".to_string(), label);
        assert_eq!(store.node_count(), 1);
        assert_eq!(id, 0);
    }

    #[test]
    fn test_add_edge() {
        let mut store = GraphStore::new();

        let label1 = NodeLabel {
            name: "Customer 1".to_string(),
            customer_id: "cust-001".to_string(),
            ..Default::default()
        };
        let label2 = NodeLabel {
            name: "Customer 2".to_string(),
            customer_id: "cust-002".to_string(),
            ..Default::default()
        };

        store.add_node("cust-001".to_string(), label1);
        store.add_node("cust-002".to_string(), label2);

        let edge = store.add_edge("cust-001", "cust-002", EdgeLabel::default());
        assert!(edge.is_some());
        assert_eq!(store.edge_count(), 1);
    }

    #[test]
    fn test_get_neighbors() {
        let mut store = GraphStore::new();

        let label1 = NodeLabel {
            name: "Customer 1".to_string(),
            customer_id: "cust-001".to_string(),
            ..Default::default()
        };
        let label2 = NodeLabel {
            name: "Customer 2".to_string(),
            customer_id: "cust-002".to_string(),
            ..Default::default()
        };

        store.add_node("cust-001".to_string(), label1);
        store.add_node("cust-002".to_string(), label2);
        store.add_edge("cust-001", "cust-002", EdgeLabel::default());

        let neighbors = store.get_neighbors("cust-001").unwrap();
        assert_eq!(neighbors.len(), 1);
        assert_eq!(neighbors[0].name, "Customer 2");
    }

    #[test]
    fn test_search_by_name() {
        let mut store = GraphStore::new();

        let label1 = NodeLabel {
            name: "Alpha Company".to_string(),
            customer_id: "cust-001".to_string(),
            ..Default::default()
        };
        let label2 = NodeLabel {
            name: "Beta Corporation".to_string(),
            customer_id: "cust-002".to_string(),
            ..Default::default()
        };

        store.add_node("cust-001".to_string(), label1);
        store.add_node("cust-002".to_string(), label2);

        let results = store.search_by_name("alpha");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Alpha Company");
    }
}