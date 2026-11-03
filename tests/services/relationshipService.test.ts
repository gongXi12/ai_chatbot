import { describe, expect, it } from 'vitest';
import { InMemoryRelationshipRepository } from '../../src/repositories/InMemoryRelationshipRepository.js';
import { RelationshipService } from '../../src/services/relationshipService.js';

describe('RelationshipService', () => {
  it('persists the exact consented nickname and clears it when consent is withdrawn', async () => {
    const service = new RelationshipService(new InMemoryRelationshipRepository());

    await service.observeMessage(
      'u1', 'adult', '我已经成年了', new Date('2026-08-21T10:59:00+08:00'),
    );
    const consented = await service.observeMessage(
      'u1', 'm1', '你可以叫我小朋友', new Date('2026-08-21T11:00:00+08:00'),
    );
    const withdrawn = await service.observeMessage(
      'u1', 'm2', '别叫我小朋友了', new Date('2026-08-21T11:01:00+08:00'),
    );

    expect(consented).toMatchObject({ intimacyConsent: true, preferredNicknames: ['小朋友'] });
    expect(withdrawn.intimacyConsent).toBe(false);
    expect(withdrawn.preferredNicknames).toBeUndefined();
  });

  it('collects multiple consented nicknames and removes them one at a time', async () => {
    const service = new RelationshipService(new InMemoryRelationshipRepository());

    await service.observeMessage(
      'u1', 'adult', '我已经成年了', new Date('2026-08-21T10:59:00+08:00'),
    );
    const consented = await service.observeMessage(
      'u1', 'm1', '你可以叫我宝贝、宝宝和亲爱的', new Date('2026-08-21T11:00:00+08:00'),
    );
    const partiallyWithdrawn = await service.observeMessage(
      'u1', 'm2', '别叫我亲爱的', new Date('2026-08-21T11:01:00+08:00'),
    );

    expect(consented.preferredNicknames).toEqual(['宝贝', '宝宝', '亲爱的']);
    expect(partiallyWithdrawn).toMatchObject({
      intimacyConsent: true,
      preferredNicknames: ['宝贝', '宝宝'],
    });
  });

  it('ignores nickname consent until adulthood is confirmed', async () => {
    const service = new RelationshipService(new InMemoryRelationshipRepository());

    const state = await service.observeMessage(
      'u1', 'm1', '\u4f60\u53ef\u4ee5\u53eb\u6211\u5b9d\u8d1d', new Date('2026-08-21T11:00:00+08:00'),
    );

    expect(state.intimacyConsent).toBe(false);
    expect(state.preferredNicknames).toBeUndefined();
  });
  it('auto affection starts as an adult girlfriend with default nicknames', async () => {
    const service = new RelationshipService(
      new InMemoryRelationshipRepository(),
      { autoAffection: true },
    );

    await expect(service.get('u1')).resolves.toMatchObject({
      ageGroup: 'adult',
      intimacyConsent: true,
      preferredNicknames: ['宝贝', '宝宝', '亲爱的', '乖乖', '小可爱'],
    });

    const afterBoundary = await service.observeMessage(
      'u1', 'm1', '别叫我宝贝', new Date('2026-08-21T11:00:00+08:00'),
    );
    expect(afterBoundary.preferredNicknames).toEqual(['宝宝', '亲爱的', '乖乖', '小可爱']);
  });

  it('auto affection still respects a stored minor age group', async () => {
    const repository = new InMemoryRelationshipRepository();
    const service = new RelationshipService(repository, { autoAffection: true });
    await repository.save({
      userId: 'u1',
      stage: 'new',
      familiarity: 0.05,
      trust: 0.05,
      affection: 0.02,
      openness: 0.05,
      tension: 0,
      dependencyRisk: 0,
      intimacyConsent: false,
      ageGroup: 'minor',
      updatedAt: new Date('2026-08-21T10:00:00+08:00'),
    });

    await expect(service.get('u1')).resolves.toMatchObject({
      ageGroup: 'minor',
      intimacyConsent: false,
    });
  });

  it('persists an explicit adult confirmation for later turns', async () => {
    const service = new RelationshipService(new InMemoryRelationshipRepository());

    await service.observeMessage(
      'u1', 'm1', '我已经成年了', new Date('2026-08-21T11:00:00+08:00'),
    );

    await expect(service.get('u1')).resolves.toMatchObject({ ageGroup: 'adult' });
  });
});