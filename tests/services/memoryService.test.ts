import { describe, expect, it } from 'vitest';
import { InMemoryMemoryRepository } from '../../src/repositories/InMemoryMemoryRepository.js';
import { MemoryService } from '../../src/services/memoryService.js';
import type { Memory } from '../../src/domain/types.js';
import type { MemoryRepository } from '../../src/repositories/MemoryRepository.js';

describe('MemoryService', () => {
  it('stores a future commitment with source evidence and retrieves it by topic', async () => {
    const service = new MemoryService(new InMemoryMemoryRepository());

    await service.captureFromMessage({
      userId: 'u1',
      messageId: 'm1',
      text: '我明天下午三点要去面试',
      receivedAt: new Date('2026-08-13T12:00:00+08:00'),
    });

    const memories = await service.recall('u1', '面试', 3);

    expect(memories).toHaveLength(1);
    expect(memories[0]?.type).toBe('commitment');
    expect(memories[0]?.sourceMessageIds).toEqual(['m1']);
    expect(memories[0]?.content).toContain('面试');
  });

  it('supersedes an earlier preference when the user explicitly corrects it', async () => {
    const repository = new InMemoryMemoryRepository();
    const service = new MemoryService(repository);

    await service.captureFromMessage({
      userId: 'u1',
      messageId: 'm1',
      text: '我喜欢喝咖啡',
      receivedAt: new Date('2026-08-12T12:00:00+08:00'),
    });
    await service.captureFromMessage({
      userId: 'u1',
      messageId: 'm2',
      text: '我现在不喜欢喝咖啡了',
      receivedAt: new Date('2026-08-13T12:00:00+08:00'),
    });

    const active = await repository.listActiveByUser('u1');

    expect(active).toHaveLength(1);
    expect(active[0]?.content).toContain('不喜欢喝咖啡');
    expect(active[0]?.sourceMessageIds).toEqual(['m2']);
  });
  it('keeps the prior memory active when an atomic replacement fails', async () => {
    const prior: Memory = {
      id: 'm1:memory', userId: 'u1', type: 'profile_fact', content: '我喜欢喝咖啡', topic: '咖啡',
      sourceMessageIds: ['m1'], observedAt: new Date('2026-08-12T12:00:00+08:00'),
      confidence: 0.95, importance: 0.5, sensitivity: 'normal', status: 'active',
    };
    const active = structuredClone(prior);
    const repository: MemoryRepository & {
      replace(priorMemoryId: string, memory: Memory): Promise<void>;
    } = {
      async save() { throw new Error('replacement insert failed'); },
      async replace() { throw new Error('replacement insert failed'); },
      async listActiveByUser() { return active.status === 'active' ? [structuredClone(active)] : []; },
      async supersede() { active.status = 'superseded'; },
      async deleteAllByUser() {},
    };
    const service = new MemoryService(repository);

    await expect(service.captureFromMessage({
      userId: 'u1', messageId: 'm2', text: '我现在不喜欢喝咖啡了',
      receivedAt: new Date('2026-08-13T12:00:00+08:00'),
    })).rejects.toThrow('replacement insert failed');

    expect((await repository.listActiveByUser('u1')).map((memory) => memory.id)).toEqual(['m1:memory']);
  });
});


