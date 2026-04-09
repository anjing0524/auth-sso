/**
 * WebGPU 支持检测工具
 *
 * 检测浏览器是否支持 WebGPU
 */

export interface WebGPUSupport {
  /** 是否支持 WebGPU */
  supported: boolean;
  /** 不支持的原因 */
  reason?: string;
  /** 浏览器信息 */
  browser?: string;
}

/**
 * 检测 WebGPU 支持
 */
export async function checkWebGPUSupport(): Promise<WebGPUSupport> {
  // 检测是否在浏览器环境
  if (typeof window === 'undefined') {
    return {
      supported: false,
      reason: 'Server-side rendering',
    };
  }

  // 检测 navigator.gpu
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  const gpu = nav.gpu;

  if (!gpu) {
    // 尝试确定原因
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    let reason = 'WebGPU not supported';

    if (ua.includes('Firefox')) {
      browser = 'Firefox';
      reason = 'Firefox does not support WebGPU yet';
    } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
      browser = 'Safari';
      reason = 'Safari WebGPU support is limited';
    } else if (ua.includes('Chrome') || ua.includes('Edge')) {
      const version = parseInt(ua.match(/Chrome\/(\d+)/)?.[1] || '0');
      if (version < 113) {
        browser = version > 0 ? `Chrome ${version}` : 'Chrome';
        reason = 'Chrome 113+ required for WebGPU';
      } else {
        browser = `Chrome ${version}`;
        reason = 'WebGPU disabled or not available';
      }
    }

    return {
      supported: false,
      reason,
      browser,
    };
  }

  // 尝试请求适配器以验证真正可用
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return {
        supported: false,
        reason: 'No WebGPU adapter available',
      };
    }

    // 获取适配器信息
    const info = await adapter.requestAdapterInfo();

    return {
      supported: true,
      browser: info.vendor,
    };
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : 'WebGPU initialization failed',
    };
  }
}

/**
 * 获取推荐浏览器列表
 */
export function getRecommendedBrowsers(): string[] {
  return [
    'Google Chrome 113+',
    'Microsoft Edge 113+',
    'Chrome Canary (latest)',
    'Edge Canary (latest)',
  ];
}