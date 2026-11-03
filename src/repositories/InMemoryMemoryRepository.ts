import type { Memory } from '../domain/types.js';
import type { MemoryRepository } from './MemoryRepository.js';

export class InMemoryMemoryRepository implements MemoryRepository {
  private readonly memories = new Map<string, Memory>();

  async save(memory: Memory): Promise<void> {
    this.memories.set(memory.id, structuredClone(memory));
  }

  async replace(priorMemoryId: string, memory: Memory): Promise<void> {
    const prior = this.memories.get(priorMemoryId);
    this.memories.set(memory.id, structuredClone(memory));
    if (prior) prior.status = 'superseded';
  }

  async listActiveByUser(userId: string): Promise<Memory[]> {
    return [...this.memories.values()]
      .filter((memory) => memory.userId === userId && memory.status === 'active')
      .map((memory) => structuredClone(memory));
  }

  async supersede(memoryId: string): Promise<void> {
    const memory = this.memories.get(memoryId);
    if (memory) {
      memory.status = 'superseded';
    }
  }

  async deleteAllByUser(userId: string): Promise<void> {
    for (const [id, memory] of this.memories) {
      if (memory.userId === userId) this.memories.delete(id);
    }
  }
}

