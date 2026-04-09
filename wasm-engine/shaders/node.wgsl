// 节点渲染着色器
// 使用 Instanced Rendering 绘制节点

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
}

struct Uniforms {
    view_proj: mat4x4<f32>,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    // TODO: 实现顶点着色器
    var output: VertexOutput;
    output.position = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    output.color = vec4<f32>(1.0, 1.0, 1.0, 1.0);
    output
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // TODO: 实现片段着色器
    input.color
}