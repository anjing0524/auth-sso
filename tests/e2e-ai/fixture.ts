import { test as base } from '@playwright/test';
import {
  PlaywrightAiFixture,
  type PlayWrightAiFixtureType,
} from '@midscene/web/playwright';

/**
 * 只把 Midscene 注入到独立 AI 测试 project；主 E2E 不加载该 fixture。
 * cache 关闭：试点阶段先观察模型真实规划，不用缓存掩盖不稳定。
 */
export const test = base.extend<PlayWrightAiFixtureType>(
  PlaywrightAiFixture({
    cache: false,
    replanningCycleLimit: 20,
  }),
);

export const hasModelConfig = Boolean(process.env.MIDSCENE_MODEL_API_KEY);

test.beforeEach(async () => {
  test.skip(!hasModelConfig, '未配置 MIDSCENE_MODEL_API_KEY，跳过 AI 探索性测试');
});
