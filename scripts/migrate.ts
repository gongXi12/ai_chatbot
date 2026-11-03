import { Pool } from 'pg';
import { config } from '../src/config/unifiedConfig.js';
import { runMigrations } from '../src/database/runMigrations.js';

const pool = new Pool({ connectionString: config.storage.databaseUrl });

try {
  await runMigrations(pool);
  process.stdout.write('Database migrations completed.\n');
} finally {
  await pool.end();
}

