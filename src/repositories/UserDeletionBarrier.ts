export interface UserDeletionBarrier {
  latestDeletionAt(userId: string): Promise<Date | undefined>;
  recordDeletion(userId: string, deletedAt: Date): Promise<void>;
}
