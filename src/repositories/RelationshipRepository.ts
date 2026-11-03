import type { RelationshipState } from '../domain/types.js';

export interface RelationshipObservation {
  messageId: string;
  dependencyDelta: number;
  intimacyConsent?: boolean;
  preferredNicknames?: string[] | null;
  ageGroup?: RelationshipState['ageGroup'];
  declaredAge?: number | null;
  observedAt: Date;
}

export function createInitialRelationshipState(
  userId: string,
  now = new Date(),
): RelationshipState {
  return {
    userId,
    stage: 'new',
    familiarity: 0.05,
    trust: 0.05,
    affection: 0.02,
    openness: 0.05,
    tension: 0,
    dependencyRisk: 0,
    intimacyConsent: false,
    ageGroup: 'unknown',
    updatedAt: now,
  };
}

export interface RelationshipRepository {
  get(userId: string): Promise<RelationshipState | undefined>;
  save(state: RelationshipState): Promise<void>;
  observe(userId: string, observation: RelationshipObservation): Promise<RelationshipState>;
  delete(userId: string): Promise<void>;
}