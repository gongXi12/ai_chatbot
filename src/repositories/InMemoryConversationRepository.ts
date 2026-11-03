import { randomUUID } from 'node:crypto';
import type { ChatResult, ConversationMessage } from '../domain/types.js';
import type { ConversationRepository, ProcessingClaim } from './ConversationRepository.js';

interface ProcessingRecord {
  userId: string;
  status: 'processing' | 'completed';
  claimId: string;
  updatedAt: Date;
  result?: ChatResult;
}

export class InMemoryConversationRepository implements ConversationRepository {
  private readonly records = new Map<string, ProcessingRecord>();
  private readonly messages = new Map<string, ConversationMessage>();

  constructor(private readonly leaseMs = 5 * 60_000) {}

  async beginProcessing(userId: string, messageId: string, now = new Date()): Promise<ProcessingClaim> {
    const existing = this.records.get(messageId);
    if (existing?.status === 'completed' && existing.result) {
      return { state: 'completed', result: structuredClone(existing.result) };
    }
    if (existing?.status === 'processing') {
      if (!existing.claimId) {
        const claimId = randomUUID();
        existing.claimId = claimId;
        existing.updatedAt = new Date(now);
        return {
          state: 'claimed',
          claimId,
          ...(existing.result ? { draft: structuredClone(existing.result) } : {}),
        };
      }
      const activeLease = now.getTime() - existing.updatedAt.getTime() < this.leaseMs;
      if (existing.userId !== userId || activeLease) return { state: 'processing' };
    }

    const claimId = randomUUID();
    this.records.set(messageId, {
      userId,
      status: 'processing',
      claimId,
      updatedAt: new Date(now),
    });
    return { state: 'claimed', claimId };
  }

  async saveDraft(messageId: string, claimId: string, result: ChatResult): Promise<void> {
    const record = this.records.get(messageId);
    if (!record || record.status !== 'processing' || record.claimId !== claimId) {
      throw new Error('Message processing claim was lost before draft persistence.');
    }
    record.result = structuredClone(result);
  }

  async completeProcessing(messageId: string, claimId: string, result: ChatResult): Promise<void> {
    const record = this.records.get(messageId);
    if (!record || record.status !== 'processing' || record.claimId !== claimId) {
      throw new Error('Message processing claim was lost before completion.');
    }
    this.records.set(messageId, {
      ...record,
      status: 'completed',
      updatedAt: new Date(),
      result: structuredClone(result),
    });
  }

  async releaseProcessing(messageId: string, claimId: string): Promise<void> {
    const record = this.records.get(messageId);
    if (record?.status === 'processing' && record.claimId === claimId) {
      if (record.result) {
        record.claimId = '';
        record.updatedAt = new Date(0);
      } else {
        this.records.delete(messageId);
      }
    }
  }

  async append(message: ConversationMessage): Promise<void> {
    this.messages.set(message.id, structuredClone(message));
  }

  async recent(userId: string, limit: number): Promise<ConversationMessage[]> {
    return [...this.messages.values()]
      .filter((message) => message.userId === userId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(-limit)
      .map((message) => structuredClone(message));
  }

  async deleteAllByUser(userId: string): Promise<void> {
    for (const [id, message] of this.messages) {
      if (message.userId === userId) this.messages.delete(id);
    }
    for (const [id, record] of this.records) {
      if (record.userId === userId) this.records.delete(id);
    }
  }
}