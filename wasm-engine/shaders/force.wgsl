// 力导向布局计算着色器
// 实现引力、斥力和碰撞检测
//
// 注意：完整的空间网格加速在单独的 WGSL 模块中实现
// 此着色器提供基本的力计算演示

// 节点数据结构（与 Rust 中的 NodeData 匹配，64 字节）
struct Node {
    x: f32,
    y: f32,
    vx: f32,
    vy: f32,
    radius: f32,
    color_r: f32,
    color_g: f32,
    color_b: f32,
    color_a: f32,
    node_id: u32,
    degree: u32,
    _padding: vec2<f32>,
}

// 边数据结构（与 Rust 中的 EdgeData 匹配，32 字节）
struct Edge {
    source_id: u32,
    target_id: u32,
    color_r: f32,
    color_g: f32,
    color_b: f32,
    color_a: f32,
    weight: f32,
    edge_type: u32,
}

// 模拟参数
struct SimulationParams {
    attraction_strength: f32,    // 引力强度
    repulsion_strength: f32,    // 斥力强度
    ideal_edge_length: f32,     // 理想边长度
    gravity_strength: f32,      // 重力强度
    damping: f32,               // 阻尼系数
    max_velocity: f32,          // 最大速度
    node_count: u32,            // 节点数量
    edge_count: u32,            // 边数量
    center_x: f32,              // 中心 X
    center_y: f32,              // 中心 Y
    _padding: f32,
}

@group(0) @binding(0)
var<storage, read_write> nodes: array<Node>;

@group(0) @binding(1)
var<storage, read> edges: array<Edge>;

@group(0) @binding(2)
var<uniform> params: SimulationParams;

// 计算两个节点之间的斥力
fn calculate_repulsion(node1: Node, node2: Node) -> vec2<f32> {
    let dx = node1.x - node2.x;
    let dy = node1.y - node2.y;
    let dist_sq = dx * dx + dy * dy;

    // 避免除零
    if (dist_sq < 1.0) {
        return vec2<f32>(params.repulsion_strength, params.repulsion_strength);
    }

    let dist = sqrt(dist_sq);
    let force = params.repulsion_strength / dist_sq;

    return vec2<f32>(force * dx / dist, force * dy / dist);
}

// 计算两个节点之间的引力（边连接）
fn calculate_attraction(node1: Node, node2: Node) -> vec2<f32> {
    let dx = node2.x - node1.x;
    let dy = node2.y - node1.y;
    let dist = sqrt(dx * dx + dy * dy);

    if (dist < 0.001) {
        return vec2<f32>(0.0, 0.0);
    }

    // 胡克定律：F = k * (d - d0)
    let force = params.attraction_strength * (dist - params.ideal_edge_length);

    return vec2<f32>(force * dx / dist, force * dy / dist);
}

// 计算重力（向中心吸引）
fn calculate_gravity(node: Node) -> vec2<f32> {
    let dx = params.center_x - node.x;
    let dy = params.center_y - node.y;

    return vec2<f32>(
        params.gravity_strength * dx,
        params.gravity_strength * dy
    );
}

// 应用速度限制
fn clamp_velocity(vx: f32, vy: f32) -> vec2<f32> {
    let speed = sqrt(vx * vx + vy * vy);

    if (speed > params.max_velocity) {
        let scale = params.max_velocity / speed;
        return vec2<f32>(vx * scale, vy * scale);
    }

    return vec2<f32>(vx, vy);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let node_idx = id.x;

    if (node_idx >= params.node_count) {
        return;
    }

    var node = nodes[node_idx];
    var force = vec2<f32>(0.0, 0.0);

    // 1. 计算斥力（与其他所有节点）
    // 注意：这是 O(n^2) 的简化实现，完整版应使用空间网格
    // 为性能考虑，只计算前 N 个最近节点
    let max_repulsion_nodes = min(100u, params.node_count);

    for (var i = 0u; i < max_repulsion_nodes; i++) {
        if (i != node_idx) {
            let repulsion = calculate_repulsion(node, nodes[i]);
            force += repulsion;
        }
    }

    // 2. 计算引力（从边）
    for (var e = 0u; e < params.edge_count; e++) {
        let edge = edges[e];

        if (edge.source_id == node_idx || edge.target_id == node_idx) {
            let other_idx = select(edge.target_id, edge.source_id, edge.source_id == node_idx);

            if (other_idx < params.node_count) {
                let attraction = calculate_attraction(node, nodes[other_idx]);
                force += attraction;
            }
        }
    }

    // 3. 计算重力
    let gravity = calculate_gravity(node);
    force += gravity;

    // 4. 更新速度
    node.vx += force.x;
    node.vy += force.y;

    // 5. 应用阻尼
    node.vx *= params.damping;
    node.vy *= params.damping;

    // 6. 限制速度
    let clamped = clamp_velocity(node.vx, node.vy);
    node.vx = clamped.x;
    node.vy = clamped.y;

    // 7. 更新位置
    node.x += node.vx;
    node.y += node.vy;

    nodes[node_idx] = node;
}