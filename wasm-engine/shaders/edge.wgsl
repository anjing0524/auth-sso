// 边渲染着色器
// 使用实例化渲染绘制所有边

// 实例数据
struct EdgeInstance {
    @location(0) source: vec2<f32>,
    @location(1) end_pos: vec2<f32>,
    @location(2) color: vec4<f32>,
}

// Uniform 缓冲区
struct Uniforms {
    viewport_width: f32,
    viewport_height: f32,
    zoom: f32,
    pan_x: f32,
    pan_y: f32,
    _pad1: f32,
    _pad2: f32,
    _pad3: f32,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

// 顶点输出
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
}

// 将世界坐标转换为屏幕坐标
fn world_to_screen(pos: vec2<f32>) -> vec2<f32> {
    // 应用平移和缩放
    let transformed = (pos + vec2<f32>(uniforms.pan_x, uniforms.pan_y)) * uniforms.zoom;

    // 转换到 NDC (-1 到 1)
    let ndc_x = transformed.x / (uniforms.viewport_width * 0.5);
    let ndc_y = -transformed.y / (uniforms.viewport_height * 0.5);

    return vec2<f32>(ndc_x, ndc_y);
}

@vertex
fn vs_edge(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32,
    instance: EdgeInstance,
) -> VertexOutput {
    var output: VertexOutput;

    // vertex_index 0 = 源节点端点，vertex_index 1 = 目标节点端点
    let pos = select(instance.source, instance.end_pos, vertex_index == 1u);

    output.position = vec4<f32>(world_to_screen(pos), 0.0, 1.0);
    output.color = instance.color;

    return output;
}

@fragment
fn fs_edge(input: VertexOutput) -> @location(0) vec4<f32> {
    return input.color;
}