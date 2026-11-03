import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PostgresConversationRepository } from '../../src/repositories/PostgresConversationRepository.js';
import { PostgresMemoryRepository } from '../../src/repositories/PostgresMemoryRepository.js';
import { PostgresOutboundDeliveryRepository } from '../../src/repositories/PostgresOutboundDeliveryRepository.js';
import { PostgresRelationshipRepository } from '../../src/repositories/PostgresRelationshipRepository.js';
import { PostgresUserDeletionBarrier } from '../../src/repositories/PostgresUserDeletionBarrier.js';
import { runMigrations } from '../../src/database/runMigrations.js';
import { createTestPool } from '../helpers/createTestPool.js';

let pool: Pool;

beforeEach(async () => {
  pool = createTestPool();
  await runMigrations(pool);
});

afterEach(async () => {
  await pool.end();
});

describe('PostgreSQL repositories', () => {
  it('keeps completed message deduplication and conversation history across repository instances', async () => {
    const first = new PostgresConversationRepository(pool);
    const claim = await first.beginProcessing('u1', 'm1');
    expect(claim.state).toBe('claimed');
    if (claim.state !== 'claimed') throw new Error('expected claim');
    await first.append({
      id: 'm1', userId: 'u1', role: 'user', text: '你好',
      createdAt: new Date('2026-08-13T10:00:00+08:00'),
    });
    await first.completeProcessing('m1', claim.claimId, {
      duplicate: false, bubbles: ['你好'], safetyLevel: 'safe',
    });

    const second = new PostgresConversationRepository(pool);
    expect(await second.beginProcessing('u1', 'm1')).toEqual({
      state: 'completed',
      result: { duplicate: false, bubbles: ['你好'], safetyLevel: 'safe' },
    });
    expect(await second.recent('u1', 10)).toEqual([
      expect.objectContaining({ id: 'm1', userId: 'u1', text: '你好' }),
    ]);
  });

  it('deduplicates message IDs globally even when user IDs differ', async () => {
    const repository = new PostgresConversationRepository(pool);
    expect((await repository.beginProcessing('u1', 'shared-message')).state).toBe('claimed');
    expect(await repository.beginProcessing('u2', 'shared-message')).toEqual({ state: 'processing' });
  });

  it('reclaims a stale processing lease after a worker crash', async () => {
    const repository = new PostgresConversationRepository(pool, { leaseMs: 60_000 });
    const first = await repository.beginProcessing('u1', 'stale-message', new Date('2026-08-13T10:00:00Z'));
    expect(first.state).toBe('claimed');
    expect(await repository.beginProcessing(
      'u1', 'stale-message', new Date('2026-08-13T10:02:00Z'),
    )).toMatchObject({ state: 'claimed' });
  });

  it('releases a failed processing claim so the same channel message can retry', async () => {
    const repository = new PostgresConversationRepository(pool);
    const first = await repository.beginProcessing('u1', 'm1');
    expect(first.state).toBe('claimed');
    if (first.state !== 'claimed') throw new Error('expected claim');
    await repository.releaseProcessing('m1', first.claimId);
    expect((await repository.beginProcessing('u1', 'm1')).state).toBe('claimed');
  });

  it('persists, atomically replaces and deletes memories', async () => {
    const repository = new PostgresMemoryRepository(pool);
    await repository.save({
      id: 'memory-1', userId: 'u1', type: 'profile_fact', content: '我喜欢喝咖啡', topic: '咖啡',
      sourceMessageIds: ['m1'], observedAt: new Date('2026-08-13T10:00:00+08:00'),
      confidence: 0.95, importance: 0.5, sensitivity: 'normal', status: 'active',
    });

    expect(await new PostgresMemoryRepository(pool).listActiveByUser('u1')).toHaveLength(1);
    await repository.replace('memory-1', {
      id: 'memory-2', userId: 'u1', type: 'profile_fact', content: '我不喜欢喝咖啡了', topic: '咖啡',
      sourceMessageIds: ['m2'], observedAt: new Date('2026-08-13T11:00:00+08:00'),
      confidence: 0.98, importance: 0.6, sensitivity: 'normal', status: 'active',
      supersedesMemoryId: 'memory-1',
    });
    expect(await repository.listActiveByUser('u1')).toEqual([
      expect.objectContaining({ id: 'memory-2', supersedesMemoryId: 'memory-1' }),
    ]);
    await repository.deleteAllByUser('u1');
    expect(await repository.listActiveByUser('u1')).toEqual([]);
  });

  it('rolls back a memory replacement when the prior memory does not exist', async () => {
    const repository = new PostgresMemoryRepository(pool);
    const replacementId = `replacement-${randomUUID()}`;
    await expect(repository.replace('missing-prior', {
      id: replacementId, userId: 'u1', type: 'profile_fact', content: '新的记忆', topic: '新',
      sourceMessageIds: ['m2'], observedAt: new Date(), confidence: 1, importance: 1,
      sensitivity: 'normal', status: 'active', supersedesMemoryId: 'missing-prior',
    })).rejects.toThrow();
    expect(await repository.listActiveByUser('u1')).toEqual([]);
  });

  it('persists outbound bubble delivery state across repository instances', async () => {
    const repository = new PostgresOutboundDeliveryRepository(pool);
    await repository.markDelivered({
      id: 'channel:account:m1:bubble:0',
      userId: 'channel:account:u1',
      channel: 'openclaw-weixin',
      accountId: 'account',
      inboundMessageId: 'm1',
      bubbleIndex: 0,
      clientId: 'stable-client-id',
      deliveredAt: new Date('2026-08-13T10:00:00+08:00'),
    });

    expect(await new PostgresOutboundDeliveryRepository(pool).isDelivered(
      'channel:account:m1:bubble:0',
    )).toBe(true);
    await repository.deleteAllByUser('channel:account:u1');
    expect(await repository.isDelivered('channel:account:m1:bubble:0')).toBe(false);
  });

  it('persists a deletion barrier without storing the raw user id', async () => {
    const barrier = new PostgresUserDeletionBarrier(pool);
    const deletedAt = new Date('2026-08-13T10:00:00+08:00');
    await barrier.recordDeletion('channel:account:user', deletedAt);

    expect(await new PostgresUserDeletionBarrier(pool).latestDeletionAt(
      'channel:account:user',
    )).toEqual(deletedAt);
    const rows = await pool.query<{ user_key: string }>('SELECT user_key FROM user_deletions');
    expect(rows.rows[0]?.user_key).not.toContain('channel:account:user');
  });

  it('persists relationship state across repository instances', async () => {
    const repository = new PostgresRelationshipRepository(pool);
    await repository.save({
      userId: 'u1', stage: 'familiar', familiarity: 0.4, trust: 0.3, affection: 0.2,
      openness: 0.3, tension: 0.1, dependencyRisk: 0, intimacyConsent: true, ageGroup: 'adult',
      preferredNicknames: ['小朋友', '宝宝'], updatedAt: new Date('2026-08-13T10:00:00+08:00'),
    });
    expect(await new PostgresRelationshipRepository(pool).get('u1')).toEqual(
      expect.objectContaining({ userId: 'u1', stage: 'familiar', intimacyConsent: true, preferredNicknames: ['小朋友', '宝宝'] }),
    );
  });

  it('deletes all persisted user data including message deduplication records', async () => {
    const conversations = new PostgresConversationRepository(pool);
    const memories = new PostgresMemoryRepository(pool);
    const relationships = new PostgresRelationshipRepository(pool);
    const deletionClaim = await conversations.beginProcessing('u1', 'm1');
    if (deletionClaim.state !== 'claimed') throw new Error('expected claim');
    await conversations.append({ id: 'm1', userId: 'u1', role: 'user', text: '秘密', createdAt: new Date() });
    await conversations.completeProcessing('m1', deletionClaim.claimId, {
      duplicate: false, bubbles: ['ok'], safetyLevel: 'safe',
    });
    await memories.save({
      id: 'memory-1', userId: 'u1', type: 'profile_fact', content: '秘密', topic: '秘密',
      sourceMessageIds: ['m1'], observedAt: new Date(), confidence: 1, importance: 1,
      sensitivity: 'normal', status: 'active',
    });
    await relationships.save({
      userId: 'u1', stage: 'new', familiarity: 0.1, trust: 0.1, affection: 0.1,
      openness: 0.1, tension: 0, dependencyRisk: 0, intimacyConsent: false, ageGroup: 'unknown', updatedAt: new Date(),
    });

    await conversations.deleteAllByUser('u1');
    await memories.deleteAllByUser('u1');
    await relationships.delete('u1');

    expect(await conversations.recent('u1', 10)).toEqual([]);
    expect((await conversations.beginProcessing('u1', 'm1')).state).toBe('claimed');
    expect(await memories.listActiveByUser('u1')).toEqual([]);
    expect(await relationships.get('u1')).toBeUndefined();
  });
});


