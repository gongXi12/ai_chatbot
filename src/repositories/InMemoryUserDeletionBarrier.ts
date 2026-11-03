import type { UserDeletionBarrier } from './UserDeletionBarrier.js';

export class InMemoryUserDeletionBarrier implements UserDeletionBarrier {
  private readonly deletions = new Map<string, Date>();

  async latestDeletionAt(userId: string): Promise<Date | undefined> {
    const deletedAt = this.deletions.get(userId);
    return deletedAt ? new Date(deletedAt) : undefined;
  }

  async recordDeletion(userId: string, deletedAt: Date): Promise<void> {
    this.deletions.set(userId, new Date(deletedAt));
  }
}
