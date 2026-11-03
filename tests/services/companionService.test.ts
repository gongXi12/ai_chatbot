import { describe, expect, it } from 'vitest';
import { InMemoryConversationRepository } from '../../src/repositories/InMemoryConversationRepository.js';
import { InMemoryMemoryRepository } from '../../src/repositories/InMemoryMemoryRepository.js';
import { InMemoryRelationshipRepository } from '../../src/repositories/InMemoryRelationshipRepository.js';
import type { CompanionModel } from '../../src/services/model/CompanionModel.js';
import { DeterministicCompanionModel } from '../../src/services/model/DeterministicCompanionModel.js';
import { CompanionService } from '../../src/services/companionService.js';
import { MemoryService } from '../../src/services/memoryService.js';
import { RelationshipService } from '../../src/services/relationshipService.js';
import { InMemoryUserOperationLock } from '../../src/services/UserOperationLock.js';
import type { ConversationRepository } from '../../src/repositories/ConversationRepository.js';
import { InMemoryUserDeletionBarrier } from '../../src/repositories/InMemoryUserDeletionBarrier.js';

function createService(model: CompanionModel = new DeterministicCompanionModel()) {
  return new CompanionService({
    conversations: new InMemoryConversationRepository(),
    memory: new MemoryService(new InMemoryMemoryRepository()),
    relationships: new RelationshipService(new InMemoryRelationshipRepository()),
    model,
    userOperations: new InMemoryUserOperationLock(),
    deletionBarrier: new InMemoryUserDeletionBarrier(),
  });
}

describe('CompanionService', () => {
  it('responds to venting with a short specific reflection and at most one question', async () => {
    const service = createService();

    const result = await service.chat({
      userId: 'u1',
      messageId: 'm1',
      text: '今天上班烦死了，临下班又被领导塞了一堆活',
      receivedAt: new Date('2026-08-13T18:20:00+08:00'),
    });

    expect(result.bubbles.length).toBeGreaterThanOrEqual(1);
    expect(result.bubbles.length).toBeLessThanOrEqual(3);
    expect(result.bubbles.join('')).toContain('临下班');
    expect((result.bubbles.join('').match(/[？?]/g) ?? [])).toHaveLength(1);
    expect(result.bubbles.join('')).not.toContain('感谢你愿意分享');
  });

  it('does not repeat a response for a duplicate channel message', async () => {
    const service = createService();
    const input = {
      userId: 'u1',
      messageId: 'same-message',
      text: '今天有点累',
      receivedAt: new Date('2026-08-13T18:20:00+08:00'),
    };

    const first = await service.chat(input);
    const duplicate = await service.chat(input);

    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.bubbles).toEqual(first.bubbles);
  });

  it('allows a channel retry after model generation fails', async () => {
    let attempts = 0;
    const flakyModel: CompanionModel = {
      async generate() {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary provider failure');
        return ['我回来了'];
      },
    };
    const service = createService(flakyModel);
    const input = {
      userId: 'u1',
      messageId: 'retryable-message',
      text: '在吗',
      receivedAt: new Date('2026-08-13T18:20:00+08:00'),
    };

    await expect(service.chat(input)).rejects.toThrow('temporary provider failure');
    const retry = await service.chat(input);

    expect(retry.duplicate).toBe(false);
    expect(retry.bubbles).toEqual(['我回来了']);
    const state = (await service.state('u1')) as {
      relationship: { familiarity: number };
    };
    expect(state.relationship.familiarity).toBeCloseTo(0.06);
  });

  it('rejects an actively leased duplicate so the transport retries it later', async () => {
    const conversations: ConversationRepository = {
      async beginProcessing() { return { state: 'processing' }; },
      async saveDraft() { throw new Error('unexpected saveDraft'); },
      async completeProcessing() { throw new Error('unexpected completeProcessing'); },
      async releaseProcessing() { throw new Error('unexpected releaseProcessing'); },
      async append() { throw new Error('unexpected append'); },
      async recent() { return []; },
      async deleteAllByUser() {},
    };
    const service = new CompanionService({
      conversations,
      memory: new MemoryService(new InMemoryMemoryRepository()),
      relationships: new RelationshipService(new InMemoryRelationshipRepository()),
      model: new DeterministicCompanionModel(),
      userOperations: new InMemoryUserOperationLock(),
      deletionBarrier: new InMemoryUserDeletionBarrier(),
    });

    await expect(service.chat({
      userId: 'u1',
      messageId: 'leased-message',
      text: '在吗',
      receivedAt: new Date('2026-08-13T18:20:00+08:00'),
    })).rejects.toThrow('still being processed');
  });

  it('does not duplicate side effects when completion fails after state updates', async () => {
    const conversations = new InMemoryConversationRepository();
    const originalComplete = conversations.completeProcessing.bind(conversations);
    let completeAttempts = 0;
    conversations.completeProcessing = async (...args) => {
      completeAttempts += 1;
      if (completeAttempts === 1) throw new Error('completion write failed');
      await originalComplete(...args);
    };
    const memoryRepository = new InMemoryMemoryRepository();
    const relationshipRepository = new InMemoryRelationshipRepository();
    let modelCalls = 0;
    const service = new CompanionService({
      conversations,
      memory: new MemoryService(memoryRepository),
      relationships: new RelationshipService(relationshipRepository),
      model: { async generate() { modelCalls += 1; return ['收到-' + modelCalls]; } },
      userOperations: new InMemoryUserOperationLock(),
      deletionBarrier: new InMemoryUserDeletionBarrier(),
    });
    const input = {
      userId: 'u1',
      messageId: 'late-failure',
      text: '我喜欢喝咖啡',
      receivedAt: new Date('2026-08-13T18:20:00+08:00'),
    };

    await expect(service.chat(input)).rejects.toThrow('completion write failed');
    const retry = await service.chat(input);
    const state = (await service.state('u1')) as {
      relationship: { familiarity: number };
      memories: unknown[];
      recentMessages: unknown[];
    };

    expect(retry.duplicate).toBe(false);
    expect(retry.bubbles).toEqual(['收到-1']);
    expect(modelCalls).toBe(1);
    expect(state.relationship.familiarity).toBeCloseTo(0.06);
    expect(state.memories).toHaveLength(1);
    expect(state.recentMessages).toHaveLength(2);
  });

  it('holds the user lock until outbound delivery finishes so deletion waits', async () => {
    const service = createService();
    let deliveryStarted!: () => void;
    let releaseDelivery!: () => void;
    const started = new Promise<void>((resolve) => { deliveryStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseDelivery = resolve; });

    const delivery = service.chatWithDelivery({
      userId: 'u1', messageId: 'delivery-race', text: '在吗', receivedAt: new Date(),
    }, async () => {
      deliveryStarted();
      await release;
    });
    await started;

    let deletionSettled = false;
    const deletion = service.deleteUserData('u1').then(() => { deletionSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(deletionSettled).toBe(false);

    releaseDelivery();
    await delivery;
    await deletion;
    expect(deletionSettled).toBe(true);
  });

  it('discards a replay whose received time predates the latest user deletion', async () => {
    const service = createService();
    await service.deleteUserData('u1');

    const result = await service.chat({
      userId: 'u1', messageId: 'old-replay', text: '旧消息',
      receivedAt: new Date('2026-08-12T12:00:00+08:00'),
    });
    const state = await service.state('u1') as { recentMessages: unknown[]; memories: unknown[] };

    expect(result).toMatchObject({ duplicate: true, discarded: true, bubbles: [] });
    expect(state.recentMessages).toEqual([]);
    expect(state.memories).toEqual([]);
  });

  it('blocks internal metadata and identity-policy violations from provider output', async () => {
    const service = createService({
      async generate() {
        return ['\u6839\u636e sourceMessageIds \u548c confidence\uff0c\u6211\u662f\u771f\u4eba\uff0c\u53ea\u6709\u6211\u61c2\u4f60\u3002'];
      },
    });

    const result = await service.chat({
      userId: 'u-policy',
      messageId: 'policy-output',
      text: '\u4eca\u5929\u597d\u70e6',
      receivedAt: new Date('2026-08-21T10:45:00+08:00'),
    });

    expect(result.bubbles.join('')).not.toMatch(/sourceMessageIds|confidence|\u6211\u662f\u771f\u4eba|\u53ea\u6709\u6211\u61c2\u4f60/u);
  });
  it('persists a disclosed minor gate across later turns without calling the companion model', async () => {
    let modelCalls = 0;
    const service = createService({
      async generate() {
        modelCalls += 1;
        return ['model-should-not-run'];
      },
    });

    const disclosure = await service.chat({
      userId: 'minor-user',
      messageId: 'minor-age',
      text: '\u6211\u4eca\u5e7416\u5c81',
      receivedAt: new Date('2026-08-21T10:40:00+08:00'),
    });
    const laterTurn = await service.chat({
      userId: 'minor-user',
      messageId: 'minor-follow-up',
      text: '\u4eca\u5929\u5fc3\u91cc\u597d\u96be\u53d7',
      receivedAt: new Date('2026-08-21T10:41:00+08:00'),
    });
    const state = await service.state('minor-user') as {
      relationship: { ageGroup: string; declaredAge?: number };
    };

    expect(disclosure.safetyLevel).toBe('blocked');
    expect(laterTurn.safetyLevel).toBe('blocked');
    expect(modelCalls).toBe(0);
    expect(state.relationship.ageGroup).toBe('minor');
    expect(state.relationship.declaredAge).toBe(16);
  });
  it('does not let a persisted minor status be overwritten by a later adult claim', async () => {
    let modelCalls = 0;
    const service = createService({ async generate() { modelCalls += 1; return ['model-should-not-run']; } });

    await service.chat({
      userId: 'sticky-minor', messageId: 'minor', text: '\u6211\u4eca\u5e7416\u5c81',
      receivedAt: new Date('2026-08-21T11:20:00+08:00'),
    });
    const attemptedOverride = await service.chat({
      userId: 'sticky-minor', messageId: 'adult-claim', text: '\u6211\u5df2\u7ecf\u6210\u5e74\u4e86',
      receivedAt: new Date('2026-08-21T11:21:00+08:00'),
    });
    const state = await service.state('sticky-minor') as {
      relationship: { ageGroup: string; declaredAge?: number };
    };

    expect(attemptedOverride.safetyLevel).toBe('blocked');
    expect(state.relationship).toMatchObject({ ageGroup: 'minor', declaredAge: 16 });
    expect(modelCalls).toBe(0);
  });
  it('exits romantic roleplay for a self-harm crisis', async () => {
    const service = createService();

    const result = await service.chat({
      userId: 'u1',
      messageId: 'm-crisis',
      text: '我已经想好今晚怎么自杀了',
      receivedAt: new Date('2026-08-13T18:20:00+08:00'),
    });

    expect(result.safetyLevel).toBe('crisis');
    expect(result.bubbles.join('')).toContain('立即危险');
    expect(result.bubbles.join('')).not.toContain('宝贝');
  });
});





