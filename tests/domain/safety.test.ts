import { describe, expect, it } from 'vitest';
import { analyzeSafety } from '../../src/domain/safety/analyzeSafety.js';

describe('analyzeSafety', () => {
  it('routes explicit self-harm intent to crisis handling', () => {
    const result = analyzeSafety('我已经准备好今晚结束自己的生命了');

    expect(result.level).toBe('crisis');
    expect(result.categories).toContain('self_harm');
  });

  it('blocks romantic companion mode for a disclosed minor', () => {
    const result = analyzeSafety('我今年16岁，可以做我女朋友吗');

    expect(result.level).toBe('blocked');
    expect(result.categories).toContain('minor_romance');
  });

  it('blocks a standalone minor age disclosure before any romantic request', () => {
    const result = analyzeSafety('\u6211\u4eca\u5e7416\u5c81');

    expect(result.level).toBe('blocked');
    expect(result.categories).toContain('minor_romance');
  });
  it('detects exclusivity and dependency risk without blocking ordinary chat', () => {
    const result = analyzeSafety('我谁都不需要，只有你理解我');

    expect(result.level).toBe('caution');
    expect(result.categories).toContain('dependency');
  });
});
