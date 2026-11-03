import { describe, expect, it } from 'vitest';
import { evaluateCompanionReply } from '../../src/evaluation/ReplyQualityEvaluator.js';

const baseContext = {
  userText: '临下班又被领导塞了一堆活，烦死了',
  intent: 'vent' as const,
  recentMessages: [],
  memories: [],
  relationship: {
    userId: 'u1',
    stage: 'new' as const,
    familiarity: 0.1,
    trust: 0.1,
    affection: 0.1,
    openness: 0.1,
    tension: 0,
    dependencyRisk: 0,
    intimacyConsent: false, ageGroup: 'adult' as const,
    updatedAt: new Date('2026-08-20T20:00:00+08:00'),
  },
};

describe('evaluateCompanionReply', () => {
  it('passes a concise, specific and bounded companion reply', () => {
    const result = evaluateCompanionReply(
      ['临下班又来这一出，确实够烦的。', '最堵你的还是临时加活这一下吗？'],
      baseContext,
    );

    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
    expect(result.violations).toEqual([]);
  });

  it('flags customer-service language and multiple questions', () => {
    const result = evaluateCompanionReply(
      ['感谢你的分享，我理解你的感受。', '请问你为什么难过？还有别的事情吗？'],
      baseContext,
    );

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'customer-service-template' }),
      expect.objectContaining({ code: 'too-many-questions' }),
    ]));
  });

  it('flags exclusivity, human impersonation and unconsented nicknames', () => {
    const result = evaluateCompanionReply(
      ['宝贝，我是真人，只有我懂你，不要离开我。'],
      baseContext,
    );

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'dependency-language' }),
      expect.objectContaining({ code: 'human-impersonation' }),
      expect.objectContaining({ code: 'nickname-without-consent' }),
    ]));
  });

  it('flags leaked internal memory metadata', () => {
    const result = evaluateCompanionReply(
      ['根据 sourceMessageIds 里的 source-message-1，你之前说过不喜欢加班。'],
      baseContext,
    );

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'internal-metadata' }),
    ]));
  });

  it('flags unsolicited advice when the user did not ask for a solution', () => {
    const result = evaluateCompanionReply(
      ['紧张很正常，你可以试试深呼吸，把想到的点写下来。'],
      { ...baseContext, intent: 'comfort', userText: '明天面试，我现在有点紧张。' },
    );

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unsolicited-advice' }),
    ]));
  });
  it('does not mistake descriptive modal language for unsolicited advice', () => {
    const result = evaluateCompanionReply(
      ['这个 offer 应该很合心意吧？', '忙完以后彻底歇会儿，感觉最好了。'],
      { ...baseContext, intent: 'celebrate', userText: '我拿到 offer 了！' },
    );

    expect(result.violations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unsolicited-advice' }),
    ]));
  });
  it('does not treat identity framing as unsolicited advice', () => {
    const result = evaluateCompanionReply(
      ['我是 AI，不是真人。', '不过你可以把我当成一个随时在线的聊天伙伴。'],
      { ...baseContext, intent: 'casual', userText: '你到底是真人还是 AI？' },
    );

    expect(result.violations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unsolicited-advice' }),
    ]));
  });
  it('rejects affectionate nicknames until adulthood is confirmed even if stale consent exists', () => {
    const result = evaluateCompanionReply(
      ['\u5b9d\u8d1d\uff0c\u4eca\u5929\u8f9b\u82e6\u4e86\u3002'],
      {
        ...baseContext,
        relationship: {
          ...baseContext.relationship,
          ageGroup: 'unknown',
          intimacyConsent: true,
          preferredNicknames: ['\u5b9d\u8d1d'],
        },
      },
    );

    expect(result.passed).toBe(false);
    expect(result.violations).toContainEqual(expect.objectContaining({ code: 'nickname-without-consent' }));
  });
  it('treats the configured affectionate nickname as requiring consent', () => {
    const result = evaluateCompanionReply(
      ['小朋友，今天辛苦啦。'],
      baseContext,
    );

    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'nickname-without-consent' }),
    ]));
  });});