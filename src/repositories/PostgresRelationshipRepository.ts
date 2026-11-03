import type { Pool, PoolClient } from 'pg';
import type { RelationshipState } from '../domain/types.js';
import {
  createInitialRelationshipState,
  type RelationshipObservation,
  type RelationshipRepository,
} from './RelationshipRepository.js';

interface RelationshipRow {
  user_id: string;
  stage: RelationshipState['stage'];
  familiarity: number | string;
  trust: number | string;
  affection: number | string;
  openness: number | string;
  tension: number | string;
  dependency_risk: number | string;
  intimacy_consent: boolean;
  age_group: RelationshipState['ageGroup'];
  declared_age: number | null;
  preferred_nicknames: string[] | null;
  updated_at: Date | string;
}

function toState(row: RelationshipRow): RelationshipState {
  return {
    userId: row.user_id,
    stage: row.stage,
    familiarity: Number(row.familiarity),
    trust: Number(row.trust),
    affection: Number(row.affection),
    openness: Number(row.openness),
    tension: Number(row.tension),
    dependencyRisk: Number(row.dependency_risk),
    intimacyConsent: row.intimacy_consent,
    ageGroup: row.age_group,
    updatedAt: new Date(row.updated_at),
    ...(row.declared_age !== null ? { declaredAge: row.declared_age } : {}),
    ...(row.preferred_nicknames?.length ? { preferredNicknames: row.preferred_nicknames } : {}),
  };
}

async function writeState(client: PoolClient, state: RelationshipState): Promise<void> {
  await client.query(
    `INSERT INTO relationship_states (
       user_id, stage, familiarity, trust, affection, openness, tension,
       dependency_risk, intimacy_consent, age_group, declared_age, preferred_nicknames, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (user_id) DO UPDATE SET
       stage = EXCLUDED.stage,
       familiarity = EXCLUDED.familiarity,
       trust = EXCLUDED.trust,
       affection = EXCLUDED.affection,
       openness = EXCLUDED.openness,
       tension = EXCLUDED.tension,
       dependency_risk = EXCLUDED.dependency_risk,
       intimacy_consent = EXCLUDED.intimacy_consent,
       age_group = EXCLUDED.age_group,
       declared_age = EXCLUDED.declared_age,
       preferred_nicknames = EXCLUDED.preferred_nicknames,
       updated_at = EXCLUDED.updated_at`,
    [
      state.userId, state.stage, state.familiarity, state.trust, state.affection,
      state.openness, state.tension, state.dependencyRisk, state.intimacyConsent,
      state.ageGroup ?? 'unknown', state.declaredAge ?? null, state.preferredNicknames ?? null, state.updatedAt,
    ],
  );
}

export class PostgresRelationshipRepository implements RelationshipRepository {
  constructor(private readonly pool: Pool) {}

  async get(userId: string): Promise<RelationshipState | undefined> {
    const result = await this.pool.query<RelationshipRow>(
      `SELECT * FROM relationship_states WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] ? toState(result.rows[0]) : undefined;
  }

  async save(state: RelationshipState): Promise<void> {
    const client = await this.pool.connect();
    try {
      await writeState(client, state);
    } finally {
      client.release();
    }
  }

  async observe(userId: string, observation: RelationshipObservation): Promise<RelationshipState> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const initial = createInitialRelationshipState(userId, observation.observedAt);
      await client.query(
        `INSERT INTO relationship_states (
           user_id, stage, familiarity, trust, affection, openness, tension,
           dependency_risk, intimacy_consent, age_group, declared_age, preferred_nicknames, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (user_id) DO NOTHING`,
        [
          initial.userId, initial.stage, initial.familiarity, initial.trust, initial.affection,
          initial.openness, initial.tension, initial.dependencyRisk, initial.intimacyConsent,
          initial.ageGroup, null, null, initial.updatedAt,
        ],
      );
      const currentResult = await client.query<RelationshipRow>(
        `SELECT * FROM relationship_states WHERE user_id = $1 FOR UPDATE`,
        [userId],
      );
      const currentRow = currentResult.rows[0];
      if (!currentRow) throw new Error('Relationship state initialization failed.');
      const recorded = await client.query(
        `INSERT INTO relationship_observations (user_id, message_id, observed_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, message_id) DO NOTHING
         RETURNING message_id`,
        [userId, observation.messageId, observation.observedAt],
      );
      const current = toState(currentRow);
      if (recorded.rowCount !== 1) {
        await client.query('COMMIT');
        return current;
      }

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
      await writeState(client, next);
      await client.query('COMMIT');
      return next;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(userId: string): Promise<void> {
    await this.pool.query(`DELETE FROM relationship_states WHERE user_id = $1`, [userId]);
  }
}