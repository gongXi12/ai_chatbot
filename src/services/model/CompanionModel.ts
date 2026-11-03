import type { ConversationMessage, Memory, RelationshipState } from '../../domain/types.js';

export type ConversationIntent = 'vent' | 'comfort' | 'celebrate' | 'advise' | 'casual';

export interface ModelContext {
  userText: string;
  intent: ConversationIntent;
  recentMessages: ConversationMessage[];
  memories: Memory[];
  relationship: RelationshipState;
}

export interface CompanionModel {
  generate(context: ModelContext): Promise<string[]>;
}
