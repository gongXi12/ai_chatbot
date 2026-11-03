import type { Pool, PoolClient } from 'pg';
import type { Memory, MemoryType } from '../domain/types.js';
import type { MemoryRepository } from './MemoryRepository.js';

interface MemoryRow {
  id: string;
  user_id: string;
  type: MemoryType;
  content: string;
  topic: string;
  source_message_ids: string[] | string;
  observed_at: Date | string;
  confidence: number | string;
  importance: number | string;
  sensitivity: 'normal' | 'sensitive';
  status: 'active' | 'superseded' | 'deleted';
  supersedes_memory_id: string | null;
}

function sourceIds(value: string[] | string): string[] {
  if (Array.isArray(value)) return value;
  return JSON.parse(value) as string[];
}

function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    content: row.content,
    topic: row.topic,
    sourceMessageIds: sourceIds(row.source_message_ids),
    observedAt: new Date(row.observed_at),
    confidence: Number(row.confidence),
    importance: Number(row.importance),
    sensitivity: row.sensitivity,
    status: row.status,
    ...(row.supersedes_memory_id ? { supersedesMemoryId: row.supersedes_memory_id } : {}),
  };
}

const upsertMemorySql = `INSERT INTO memories (
  id, user_id, type, content, topic, source_message_ids, observed_at,
  confidence, importance, sensitivity, status, supersedes_memory_id
) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)
ON CONFLICT (id) DO UPDATE SET
  content = EXCLUDED.content,
  topic = EXCLUDED.topic,
  source_message_ids = EXCLUDED.source_message_ids,
  confidence = EXCLUDED.confidence,
  importance = EXCLUDED.importance,
  sensitivity = EXCLUDED.sensitivity,
  status = EXCLUDED.status,
  supersedes_memory_id = EXCLUDED.supersedes_memory_id`;

function memoryValues(memory: Memory): unknown[] {
  return [
    memory.id, memory.userId, memory.type, memory.content, memory.topic,
    JSON.stringify(memory.sourceMessageIds), memory.observedAt, memory.confidence,
    memory.importance, memory.sensitivity, memory.status, memory.supersedesMemoryId ?? null,
  ];
}

async function saveWith(client: Pick<PoolClient, 'query'>, memory: Memory): Promise<void> {
  const saved = await client.query(upsertMemorySql, memoryValues(memory));
  if (saved.rowCount !== 1) throw new Error('Memory was not persisted.');
}

export class PostgresMemoryRepository implements MemoryRepository {
  constructor(private readonly pool: Pool) {}

  async save(memory: Memory): Promise<void> {
    await saveWith(this.pool, memory);
  }

  async replace(priorMemoryId: string, memory: Memory): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await saveWith(client, memory);
      const superseded = await client.query(
        `UPDATE memories SET status = 'superseded' WHERE id = $1 AND user_id = $2`,
        [priorMemoryId, memory.userId],
      );
      if (superseded.rowCount !== 1) throw new Error('Prior memory was not superseded.');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listActiveByUser(userId: string): Promise<Memory[]> {
    const result = await this.pool.query<MemoryRow>(
      `SELECT * FROM memories WHERE user_id = $1 AND status = 'active' ORDER BY observed_at DESC`,
      [userId],
    );
    return result.rows.map(toMemory);
  }

  async supersede(memoryId: string): Promise<void> {
    await this.pool.query(`UPDATE memories SET status = 'superseded' WHERE id = $1`, [memoryId]);
  }

  async deleteAllByUser(userId: string): Promise<void> {
    await this.pool.query(`DELETE FROM memories WHERE user_id = $1`, [userId]);
  }
}
