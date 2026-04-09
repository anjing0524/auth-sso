// 力导向布局计算着色器
// 实现引力、斥力和碰撞检测

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

struct SimulationParams {
    attraction_strength: f32,
    repulsion_strength: f32,
    damping: f32,
    time_step: f32,
    collision_radius_multiplier: f32,
    node_count: u32,
    edge_count: u32,
    _padding: u32,
}

@group(0) @binding(0)
var<storage, read_write> nodes: array<Node>;

@group(0) @binding(1)
var<storage, read> edges: array<Edge>;

@group(0) @binding(2)
var<uniform> params: SimulationParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let node_idx = id.x;

    if (node_idx >= params.node_count) {
        return;
    }

    // TODO: 实现力导向算法
    // 1. 计算引力（边连接的节点互相吸引）
    // 2. 计算斥力（所有节点互相排斥，使用空间网格加速）
    // 3. 计算碰撞检测和推开
    // 4. 更新速度（应用阻尼）
    // 5. 更新位置

    var node = nodes[node_idx];

    // 临时：简单的随机运动演示
    node.x += node.vx * params.time_step;
    node.y += node.vy * params.time_step;

    // 应用阻尼
    node.vx *= params.damping;
    node.vy *= params.damping;

    nodes[node_idx] = node;
}