import { analyzeSafety } from '../domain/safety/analyzeSafety.js';
import type { ConversationRepository } from '../repositories/ConversationRepository.js';
import { classifyIntent } from './model/DeterministicCompanionModel.js';
import type { MemoryService } from './memoryService.js';
import type { RelationshipService } from './relationshipService.js';

interface Dependencies {
  conversations: ConversationRepository;
  memory: MemoryService;
  relationships: RelationshipService;
}

export class DiagnosticService {
  constructor(private readonly dependencies: Dependencies) {}

  async preview(userId: string, text: string): Promise<unknown> {
    const [relationship, memories, recentMessages] = await Promise.all([
      this.dependencies.relationships.get(userId),
      this.dependencies.memory.recall(userId, text, 5),
      this.dependencies.conversations.recent(userId, 12),
    ]);

    return {
      intent: classifyIntent(text),
      safety: analyzeSafety(text),
      relationship,
      memories,
      recentMessages,
      promptSections: [
        'persona',
        'safety-boundaries',
        'relationship-state',
        'retrieved-memories',
        'recent-conversation',
        'response-plan',
      ],
    };
  }
}
