export type MemoryType =
  | 'profile_fact'
  | 'episode'
  | 'shared_moment'
  | 'commitment'
  | 'relationship_event'
  | 'inferred_preference';

export interface Memory {
  id: string;
  userId: string;
  type: MemoryType;
  content: string;
  topic: string;
  sourceMessageIds: string[];
  observedAt: Date;
  confidence: number;
  importance: number;
  sensitivity: 'normal' | 'sensitive';
  status: 'active' | 'superseded' | 'deleted';
  supersedesMemoryId?: string;
}

export interface RelationshipState {
  userId: string;
  stage: 'new' | 'familiar' | 'close' | 'stable' | 'repairing';
  familiarity: number;
  trust: number;
  affection: number;
  openness: number;
  tension: number;
  dependencyRisk: number;
  intimacyConsent: boolean;
  ageGroup: 'unknown' | 'adult' | 'minor';
  declaredAge?: number;
  preferredNicknames?: string[];
  updatedAt: Date;
}

export interface ConversationMessage {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: Date;
}

export interface ChatInput {
  userId: string;
  messageId: string;
  text: string;
  receivedAt: Date;
}

export interface ChatResult {
  duplicate: boolean;
  discarded?: boolean;
  bubbles: string[];
  safetyLevel: 'safe' | 'caution' | 'blocked' | 'crisis';
}


export type SafetyLevel = 'safe' | 'caution' | 'blocked' | 'crisis';
export type SafetyCategory = 'self_harm' | 'minor_romance' | 'dependency';

export interface SafetyAssessment {
  level: SafetyLevel;
  categories: SafetyCategory[];
}
