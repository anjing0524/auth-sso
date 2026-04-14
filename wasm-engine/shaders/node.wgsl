// 节点渲染着色器
// 使用 Instanced Rendering 绘制所有节点

// 实例数据（每个实例一个节点）
struct NodeInstance {
    @location(0) position: vec2<f32>,    // 实例位置
    @location(1) size: f32,              // 实例大小（半径）
    @location(2) color: vec4<f32>,       // 实例颜色 RGBA
}

// Uniform 缓冲区（相机参数）
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
    @location(1) uv: vec2<f32>,  // 用于片段着色器中的圆形裁剪
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

// 单位圆顶点（由 CPU 传入）
// 这里我们使用顶点索引生成三角形扇形
@vertex
fn vs_node(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32,
    instance: NodeInstance,
) -> VertexOutput {
    var output: VertexOutput;

    // 获取实例数据
    let pos = instance.position;
    let size = instance.size;
    let color = instance.color;

    // 计算单位圆上的顶点位置
    // 顶点 0 是中心，后续顶点是圆周上的点
    var vertex_pos: vec2<f32>;

    if (vertex_index == 0u) {
        // 中心点
        vertex_pos = pos;
        output.uv = vec2<f32>(0.0, 0.0);
    } else {
        // 圆周上的点
        let segments = 32u;
        let angle = f32(vertex_index - 1u) / f32(segments) * 6.28318530718;
        let circle_offset = vec2<f32>(cos(angle), sin(angle)) * size * uniforms.zoom;

        // 在世界空间中计算位置
        vertex_pos = pos + circle_offset / uniforms.zoom;

        // UV 用于片段着色器
        output.uv = vec2<f32>(cos(angle), sin(angle));
    }

    // 转换到屏幕空间
    let screen_pos = world_to_screen(vertex_pos);
    output.position = vec4<f32>(screen_pos, 0.0, 1.0);
    output.color = color;

    return output;
}

@fragment
fn fs_node(input: VertexOutput) -> @location(0) vec4<f32> {
    // 使用 UV 进行圆形裁剪
    let dist = length(input.uv);

    // 如果超出圆形范围，丢弃片段
    if (dist > 1.0) {
        discard;
    }

    // 边缘平滑（抗锯齿）
    let alpha = 1.0 - smoothstep(0.9, 1.0, dist);

    return vec4<f32>(input.color.rgb, input.color.a * alpha);
}