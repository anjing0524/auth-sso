/**
 * WASM 模块加载器
 *
 * 动态加载和初始化 WASM 图引擎
 */

// WASM 模块类型定义
export interface GraphEngineWasm {
  init(canvas: HTMLCanvasElement): Promise<void>;
  load_data(nodes: unknown, edges: unknown): Promise<void>;
  step_simulation(): void;
  render(): Promise<void>;
  resize(width: number, height: number): void;
  set_viewport(zoom: number, pan_x: number, pan_y: number): void;
  get_zoom(): number;
  get_pan(): number[];
  on_mouse_down(x: number, y: number, button: number): void;
  on_mouse_move(x: number, y: number): void;
  on_mouse_up(): void;
  on_wheel(delta: number, x: number, y: number): void;
  get_hovered_node(x: number, y: number): number;
  drag_node(node_id: number, x: number, y: number): void;
  get_node_positions(): Promise<unknown>;
  select_node(node_id: number | null): void;
  get_selected_node(): number;
  fit_to_view(padding: number): void;
  reset_viewport(): void;
  get_node_count(): number;
  get_edge_count(): number;
  set_simulation_params(
    attraction: number,
    repulsion: number,
    gravity: number,
    damping: number
  ): void;
  destroy(): void;
}

// WASM 模块构造函数类型
interface GraphEngineWasmConstructor {
  new (): GraphEngineWasm;
}

// WASM 模块导出类型
interface WasmModule {
  GraphEngineWasm: GraphEngineWasmConstructor;
  is_webgpu_supported(): boolean;
  get_version(): string;
}

/** 加载状态 */
export type LoadState =
  | 'idle'
  | 'loading'
  | 'initializing'
  | 'ready'
  | 'error';

/** 加载进度 */
export interface LoadProgress {
  /** 当前状态 */
  state: LoadState;
  /** 进度百分比 (0-100) */
  progress: number;
  /** 状态消息 */
  message: string;
  /** 错误信息 */
  error?: string;
}

/** 加载回调 */
export type LoadCallback = (progress: LoadProgress) => void;

let wasmModule: WasmModule | null = null;
let wasmLoadPromise: Promise<WasmModule> | null = null;

/**
 * 加载 WASM 模块
 */
export async function loadWasmModule(
  onProgress?: LoadCallback
): Promise<WasmModule> {
  // 如果已经加载，直接返回
  if (wasmModule) {
    return wasmModule;
  }

  // 如果正在加载，等待完成
  if (wasmLoadPromise) {
    return wasmLoadPromise;
  }

  wasmLoadPromise = (async () => {
    try {
      onProgress?.({
        state: 'loading',
        progress: 10,
        message: 'Loading WASM module...',
      });

      // 动态导入 WASM 模块
      const wasmPath = '/wasm/graph_engine.js';

      // 使用 script 标签加载
      await loadScript(wasmPath);

      onProgress?.({
        state: 'loading',
        progress: 50,
        message: 'Initializing WASM...',
      });

      // 获取导出
      const exports = (window as Window & { graph_engine?: WasmModule })
        .graph_engine;

      if (!exports) {
        throw new Error('WASM module exports not found');
      }

      onProgress?.({
        state: 'ready',
        progress: 100,
        message: 'WASM ready',
      });

      wasmModule = exports;
      return wasmModule;
    } catch (error) {
      wasmLoadPromise = null;
      throw error;
    }
  })();

  return wasmLoadPromise;
}

/**
 * 加载脚本
 */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;

    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));

    document.head.appendChild(script);
  });
}

/**
 * 创建图引擎实例
 */
export async function createGraphEngine(
  canvas: HTMLCanvasElement,
  onProgress?: LoadCallback
): Promise<GraphEngineWasm> {
  try {
    onProgress?.({
      state: 'loading',
      progress: 20,
      message: 'Loading engine...',
    });

    const wasmMod = await loadWasmModule((p) => {
      onProgress?.({
        ...p,
        progress: 20 + p.progress * 0.6,
      });
    });

    onProgress?.({
      state: 'initializing',
      progress: 80,
      message: 'Initializing GPU...',
    });

    const engine = new wasmMod.GraphEngineWasm();

    await engine.init(canvas);

    onProgress?.({
      state: 'ready',
      progress: 100,
      message: 'Engine ready',
    });

    return engine;
  } catch (error) {
    onProgress?.({
      state: 'error',
      progress: 0,
      message: 'Failed to initialize engine',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * 获取 WASM 版本
 */
export function getWasmVersion(): string {
  return wasmModule?.get_version() ?? 'unknown';
}

/**
 * 检查是否支持 WebGPU
 */
export function isWebGpuSupported(): boolean {
  return wasmModule?.is_webgpu_supported() ?? false;
}