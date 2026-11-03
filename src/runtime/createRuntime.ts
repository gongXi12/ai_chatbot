import type { Pool } from 'pg';
import { Pool as PgPool } from 'pg';
import { buildApp } from '../app.js';
import { config } from '../config/unifiedConfig.js';
import { runMigrations } from '../database/runMigrations.js';
import { InMemoryConversationRepository } from '../repositories/InMemoryConversationRepository.js';
import { InMemoryMemoryRepository } from '../repositories/InMemoryMemoryRepository.js';
import { InMemoryOutboundDeliveryRepository } from '../repositories/InMemoryOutboundDeliveryRepository.js';
import { InMemoryRelationshipRepository } from '../repositories/InMemoryRelationshipRepository.js';
import { InMemoryUserDeletionBarrier } from '../repositories/InMemoryUserDeletionBarrier.js';
import { PostgresConversationRepository } from '../repositories/PostgresConversationRepository.js';
import { PostgresMemoryRepository } from '../repositories/PostgresMemoryRepository.js';
import { PostgresOutboundDeliveryRepository } from '../repositories/PostgresOutboundDeliveryRepository.js';
import { PostgresRelationshipRepository } from '../repositories/PostgresRelationshipRepository.js';
import {
  PostgresUserDeletionBarrier, userDeletionKey,
} from '../repositories/PostgresUserDeletionBarrier.js';
import type { CompanionModel } from '../services/model/CompanionModel.js';
import { InMemoryUserOperationLock, PostgresUserOperationLock } from '../services/UserOperationLock.js';

interface RuntimeOptions {
  storageDriver?: 'memory' | 'postgres';
  pool?: Pool;
  ownsPool?: boolean;
  adminToken?: string;
  chatToken?: string;
  model?: CompanionModel;
  databaseUrl?: string;
  poolFactory?: (connectionString: string) => Pool;
}

export async function createRuntime(options: RuntimeOptions = {}) {
  const storageDriver = options.storageDriver ?? config.storage.driver;
  let pool = options.pool;
  let ownsPool = options.ownsPool ?? false;

  if (storageDriver === 'postgres' && !pool) {
    const connectionString = options.databaseUrl ?? config.storage.databaseUrl;
    pool = options.poolFactory?.(connectionString) ?? new PgPool({
      connectionString,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
    ownsPool = true;
    try {
      await runMigrations(pool);
    } catch (error) {
      await pool.end();
      throw error;
    }
  }

  const repositories = storageDriver === 'postgres' && pool
    ? {
        conversations: new PostgresConversationRepository(pool),
        memories: new PostgresMemoryRepository(pool),
        relationships: new PostgresRelationshipRepository(pool),
      }
    : {
        conversations: new InMemoryConversationRepository(),
        memories: new InMemoryMemoryRepository(),
        relationships: new InMemoryRelationshipRepository(),
      };

  const outboundDeliveries = storageDriver === 'postgres' && pool
    ? new PostgresOutboundDeliveryRepository(pool)
    : new InMemoryOutboundDeliveryRepository();

  const deletionBarrier = storageDriver === 'postgres' && pool
    ? new PostgresUserDeletionBarrier(pool)
    : new InMemoryUserDeletionBarrier();

  const userOperations = storageDriver === 'postgres' && pool
    ? new PostgresUserOperationLock(pool)
    : new InMemoryUserOperationLock();
  const deleteUserData = storageDriver === 'postgres' && pool
    ? async (userId: string, deletedAt: Date): Promise<void> => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('DELETE FROM outbound_deliveries WHERE user_id = $1', [userId]);
          await client.query('DELETE FROM memories WHERE user_id = $1', [userId]);
          await client.query('DELETE FROM relationship_states WHERE user_id = $1', [userId]);
          await client.query('DELETE FROM conversation_messages WHERE user_id = $1', [userId]);
          await client.query('DELETE FROM message_processing WHERE user_id = $1', [userId]);
          await client.query(
            `INSERT INTO user_deletions (user_key, deleted_at)
             VALUES ($1, $2)
             ON CONFLICT (user_key) DO UPDATE SET deleted_at = EXCLUDED.deleted_at`,
            [userDeletionKey(userId), deletedAt],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }
    : undefined;

  const app = buildApp({
    repositories,
    userOperations,
    outboundDeliveries,
    deletionBarrier,
    ...(deleteUserData === undefined ? {} : { deleteUserData }),
    ...(options.adminToken === undefined ? {} : { adminToken: options.adminToken }),
    ...(options.chatToken === undefined ? {} : { chatToken: options.chatToken }),
    ...(options.model === undefined ? {} : { model: options.model }),
  });

  if (pool && ownsPool) {
    app.addHook('onClose', async () => {
      await pool?.end();
    });
  }


  return { app, pool, storageDriver, outboundDeliveries };
}











