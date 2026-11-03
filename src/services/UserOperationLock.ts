import type { Pool, PoolClient } from 'pg';

export interface UserOperationLock {
  withUserLock<T>(userId: string, operation: () => Promise<T>): Promise<T>;
}

export class InMemoryUserOperationLock implements UserOperationLock {
  private readonly tails = new Map<string, Promise<void>>();

  async withUserLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(userId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(userId) === tail) this.tails.delete(userId);
    }
  }
}

function advisoryKeys(userId: string): [number, number] {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const character of userId) {
    const code = character.codePointAt(0) ?? 0;
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return [first | 0, second | 0];
}

export class PostgresUserOperationLock implements UserOperationLock {
  private readonly localGate = new InMemoryUserOperationLock();
  private activeLocks = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly pool: Pool,
    private readonly maxConcurrentLocks = 4,
  ) {}

  private async acquireSlot(): Promise<void> {
    if (this.activeLocks < this.maxConcurrentLocks) {
      this.activeLocks += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.activeLocks += 1;
  }

  private releaseSlot(): void {
    this.activeLocks -= 1;
    this.waiters.shift()?.();
  }

  async withUserLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    return this.localGate.withUserLock(userId, async () => {
      await this.acquireSlot();
      let client: PoolClient | undefined;
      let advisoryLockAcquired = false;
      const [first, second] = advisoryKeys(userId);
      try {
        client = await this.pool.connect();
        await client.query('SELECT pg_advisory_lock($1, $2)', [first, second]);
        advisoryLockAcquired = true;
        return await operation();
      } finally {
        try {
          if (client && advisoryLockAcquired) {
            await client.query('SELECT pg_advisory_unlock($1, $2)', [first, second]);
          }
        } finally {
          client?.release();
          this.releaseSlot();
        }
      }
    });
  }
}
