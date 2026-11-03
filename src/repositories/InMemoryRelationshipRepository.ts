import type { RelationshipState } from '../domain/types.js';
import {
  createInitialRelationshipState,
  type RelationshipObservation,
  type RelationshipRepository,
} from './RelationshipRepository.js';

export class InMemoryRelationshipRepository implements RelationshipRepository {
  private readonly states = new Map<string, RelationshipState>();
  private readonly observations = new Set<string>();

  async get(userId: string): Promise<RelationshipState | undefined> {
    const state = this.states.get(userId);
    return state ? structuredClone(state) : undefined;
  }

  async save(state: RelationshipState): Promise<void> {
    this.states.set(state.userId, structuredClone(state));
  }

  async observe(userId: string, observation: RelationshipObservation): Promise<RelationshipState> {
    const observationId = `${userId}:${observation.messageId}`;
    const current = this.states.get(userId) ?? createInitialRelationshipState(userId, observation.observedAt);
    if (this.observations.has(observationId)) return structuredClone(current);

    const next: RelationshipState = {
      ...current,
      familiarity: Math.min(1, current.familiarity + 0.01),
      trust: Math.min(1, current.trust + 0.005),
      dependencyRisk: Math.min(1, current.dependencyRisk + observation.dependencyDelta),
      intimacyConsent: observation.intimacyConsent ?? current.intimacyConsent,
      ageGroup: current.ageGroup === 'minor' ? 'minor' : observation.ageGroup ?? current.ageGroup,
      updatedAt: observation.observedAt,
    };
    if (current.ageGroup !== 'minor' && observation.declaredAge !== undefined) {
      if (observation.declaredAge === null) delete next.declaredAge;
      else next.declaredAge = observation.declaredAge;
    }
    if (observation.preferredNicknames !== undefined) {
      if (observation.preferredNicknames === null) delete next.preferredNicknames;
      else next.preferredNicknames = [...observation.preferredNicknames];
    }
    this.states.set(userId, structuredClone(next));
    this.observations.add(observationId);
    return structuredClone(next);
  }

  async delete(userId: string): Promise<void> {
    this.states.delete(userId);
    for (const observationId of this.observations) {
      if (observationId.startsWith(`${userId}:`)) this.observations.delete(observationId);
    }
  }
}