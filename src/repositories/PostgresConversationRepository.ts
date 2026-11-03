import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ChatResult, ConversationMessage } from '../domain/types.js';
import type { ConversationRepository, ProcessingClaim } from './ConversationRepository.js';

interface ConversationRow {
  id: string;
  user_id: string;
  role: 'user' | 'assistant';
  text: string;
  created_at: Date | string;
}

interface ProcessingRow {
  user_id: string;
  status: 'processing' | 'completed';
  claim_id: string | null;
  result: ChatResult | string | null;
  updated_at: Date | string;
}

function toMessage(row: ConversationRow): ConversationMessage {
  return {
    id: row.id,
    userId: row.user_id,
    role: row.role,
    text: row.text,
    createdAt: new Date(row.created_at),
  };
}

function parseResult(value: ProcessingRow['result']): ChatResult {
  if (!value) throw new Error('Completed message is missing its persisted result.');
  return typeof value === 'string' ? JSON.parse(value) as ChatResult : value;
}

export class PostgresConversationRepository implements ConversationRepository {
  private readonly leaseMs: number;

  constructor(
    private readonly pool: Pool,
    options: { leaseMs?: number } = {},
  ) {
    this.leaseMs = options.leaseMs ?? 5 * 60_000;
  }

  async beginProcessing(userId: string, messageId: string, now = new Date()): Promise<ProcessingClaim> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<ProcessingRow>(
        `SELECT user_id, status, claim_id, result, updated_at
         FROM message_processing
         WHERE message_id = $1
         FOR UPDATE`,
        [messageId],
      );
      const row = existing.rows[0];
      if (row?.status === 'completed') {
        await client.query('COMMIT');
        return { state: 'completed', result: parseResult(row.result) };
      }
      if (row?.status === 'processing') {
        if (!row.claim_id) {
          const claimId = randomUUID();
          await client.query(
            `UPDATE message_processing
             SET claim_id = $2, updated_at = $3
             WHERE message_id = $1`,
            [messageId, claimId, now],
          );
          await client.query('COMMIT');
          return {
            state: 'claimed',
            claimId,
            ...(row.result ? { draft: parseResult(row.result) } : {}),
          };
        }
        const activeLease = now.getTime() - new Date(row.updated_at).getTime() < this.leaseMs;
        if (row.user_id !== userId || activeLease) {
          await client.query('COMMIT');
          return { state: 'processing' };
        }
      }

      const claimId = randomUUID();
      if (row) {
        await client.query(
          `UPDATE message_processing
           SET claim_id = $2, updated_at = $3
           WHERE message_id = $1`,
          [messageId, claimId, now],
        );
      } else {
        await client.query(
          `INSERT INTO message_processing
             (message_id, user_id, status, claim_id, result, updated_at)
           VALUES ($1, $2, 'processing', $3, NULL, $4)`,
          [messageId, userId, claimId, now],
        );
      }
      await client.query('COMMIT');
      return {
        state: 'claimed',
        claimId,
        ...(row?.result ? { draft: parseResult(row.result) } : {}),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') return { state: 'processing' };
      throw error;
    } finally {
      client.release();
    }
  }

  async saveDraft(messageId: string, claimId: string, result: ChatResult): Promise<void> {
    const saved = await this.pool.query(
      `UPDATE message_processing
       SET result = $3::jsonb
       WHERE message_id = $1 AND status = 'processing' AND claim_id = $2`,
      [messageId, claimId, JSON.stringify(result)],
    );
    if (saved.rowCount !== 1) {
      throw new Error('Message processing claim was lost before draft persistence.');
    }
  }

  async completeProcessing(messageId: string, claimId: string, result: ChatResult): Promise<void> {
    const completed = await this.pool.query(
      `UPDATE message_processing
       SET status = 'completed', result = $3::jsonb, updated_at = NOW()
       WHERE message_id = $1 AND status = 'processing' AND claim_id = $2`,
      [messageId, claimId, JSON.stringify(result)],
    );
    if (completed.rowCount !== 1) {
      throw new Error('Message processing claim was lost before completion.');
    }
  }

  async releaseProcessing(messageId: string, claimId: string): Promise<void> {
    const releasedDraft = await this.pool.query(
      `UPDATE message_processing
       SET claim_id = NULL, updated_at = $3
       WHERE message_id = $1 AND status = 'processing' AND claim_id = $2 AND result IS NOT NULL`,
      [messageId, claimId, new Date(0)],
    );
    if (releasedDraft.rowCount === 0) {
      await this.pool.query(
        `DELETE FROM message_processing
         WHERE message_id = $1 AND status = 'processing' AND claim_id = $2`,
        [messageId, claimId],
      );
    }
  }

  async append(message: ConversationMessage): Promise<void> {
    await this.pool.query(
      `INSERT INTO conversation_messages (id, user_id, role, text, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [message.id, message.userId, message.role, message.text, message.createdAt],
    );
  }

  async recent(userId: string, limit: number): Promise<ConversationMessage[]> {
    const result = await this.pool.query<ConversationRow>(
      `SELECT id, user_id, role, text, created_at
       FROM conversation_messages
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [userId, limit],
    );
    return result.rows.reverse().map(toMessage);
  }

  async deleteAllByUser(userId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM conversation_messages WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM message_processing WHERE user_id = $1', [userId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}