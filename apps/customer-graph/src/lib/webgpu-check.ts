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

  // 等待 navigator 对象完全初始化
  await new Promise((resolve) => setTimeout(resolve, 200));

  // 检测 navigator.gpu
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  const gpu = nav.gpu;

  // 获取浏览器信息
  const ua = navigator.userAgent;
  let browser = 'Unknown';

  if (ua.includes('Firefox')) {
    browser = 'Firefox';
  } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
    browser = 'Safari';
  } else if (ua.includes('Edge')) {
    const version = parseInt(ua.match(/Edg\/(\d+)/)?.[1] || ua.match(/Chrome\/(\d+)/)?.[1] || '0');
    browser = version > 0 ? `Edge ${version}` : 'Edge';
  } else if (ua.includes('Chrome')) {
    const version = parseInt(ua.match(/Chrome\/(\d+)/)?.[1] || '0');
    browser = version > 0 ? `Chrome ${version}` : 'Chrome';
  }

  if (!gpu) {
    let reason = 'WebGPU API not available';

    if (browser.startsWith('Firefox')) {
      reason = 'Firefox does not support WebGPU yet';
    } else if (browser.startsWith('Safari')) {
      reason = 'Safari WebGPU support is limited';
    } else if (browser.startsWith('Chrome') || browser.startsWith('Edge')) {
      reason = 'WebGPU not enabled - try chrome://flags/#enable-unsafe-webgpu';
    }

    return {
      supported: false,
      reason,
      browser,
    };
  }

  // 尝试请求适配器以验证真正可用
  try {
    // 先尝试正常请求
    let adapter = await gpu.requestAdapter();

    // 如果正常请求返回 null，尝试 forceFallbackAdapter
    if (!adapter) {
      console.log('[WebGPU] Normal adapter null, trying fallback...');
      adapter = await gpu.requestAdapter({ forceFallbackAdapter: true });
    }

    if (!adapter) {
      return {
        supported: false,
        reason: 'No GPU adapter found - check GPU drivers or try chrome://flags/#enable-unsafe-webgpu',
        browser,
      };
    }

    // 适配器可用
    console.log('[WebGPU] Adapter available:', adapter);

    return {
      supported: true,
      browser,
    };
  } catch (error) {
    console.error('[WebGPU] Adapter request failed:', error);
    return {
      supported: false,
      reason: error instanceof Error ? error.message : 'WebGPU initialization failed',
      browser,
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