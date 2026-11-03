import type { Memory } from '../domain/types.js';

export interface MemoryRepository {
  save(memory: Memory): Promise<void>;
  replace(priorMemoryId: string, memory: Memory): Promise<void>;
  listActiveByUser(userId: string): Promise<Memory[]>;
  supersede(memoryId: string): Promise<void>;
  deleteAllByUser(userId: string): Promise<void>;
}

