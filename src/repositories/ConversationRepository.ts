import type { ChatResult, ConversationMessage } from '../domain/types.js';

export type ProcessingClaim =
  | { state: 'claimed'; claimId: string; draft?: ChatResult }
  | { state: 'processing' }
  | { state: 'completed'; result: ChatResult };

export interface ConversationRepository {
  beginProcessing(userId: string, messageId: string, now?: Date): Promise<ProcessingClaim>;
  saveDraft(messageId: string, claimId: string, result: ChatResult): Promise<void>;
  completeProcessing(messageId: string, claimId: string, result: ChatResult): Promise<void>;
  releaseProcessing(messageId: string, claimId: string): Promise<void>;
  append(message: ConversationMessage): Promise<void>;
  recent(userId: string, limit: number): Promise<ConversationMessage[]>;
  deleteAllByUser(userId: string): Promise<void>;
}