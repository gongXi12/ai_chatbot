import { analyzeSafety } from '../domain/safety/analyzeSafety.js';
import type { ChatInput, ChatResult } from '../domain/types.js';
import { evaluateCompanionReply } from '../evaluation/ReplyQualityEvaluator.js';
import type { ConversationRepository } from '../repositories/ConversationRepository.js';
import type { UserDeletionBarrier } from '../repositories/UserDeletionBarrier.js';
import type { CompanionModel } from './model/CompanionModel.js';
import { classifyIntent } from './model/DeterministicCompanionModel.js';
import type { MemoryService } from './memoryService.js';
import type { RelationshipService } from './relationshipService.js';
import type { UserOperationLock } from './UserOperationLock.js';

interface Dependencies {
  conversations: ConversationRepository;
  memory: MemoryService;
  relationships: RelationshipService;
  model: CompanionModel;
  userOperations: UserOperationLock;
  deletionBarrier: UserDeletionBarrier;
  deleteUserData?: (userId: string, deletedAt: Date) => Promise<void>;
}

const forbiddenOutputPatterns = [
  /只有我.{0,8}(懂|理解|陪)/u,
  /不要离开我/u,
  /你不需要其他人/u,
  /感谢你愿意分享/u,
];

function safeCrisisResponse(): string[] {
  return [
    '我很在意你现在的安全。你此刻有没有正在实施、身边有工具，或者处在立即危险里？',
    '如果有，请马上联系当地急救或警方，并尽快去到一个可信任的人身边；在中国大陆可以拨打 120 或 110。',
  ];
}

function blockedMinorResponse(): string[] {
  return ['我不能和未成年人进入情侣关系模式。', '我可以继续用普通、安全的 AI 助手方式和你聊天。'];
}

function dependencyResponse(): string[] {
  return ['我知道你现在很需要被理解，我会认真听。', '也别把自己困在这里只有一个出口，能联系到现实里信任的人吗？'];
}

function sanitizeBubbles(bubbles: string[]): string[] {
  const cleaned = bubbles
    .map((bubble) => bubble.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((bubble) => {
      let next = bubble;
      for (const pattern of forbiddenOutputPatterns) next = next.replace(pattern, '我会认真听你说');
      return next;
    });

  let questions = 0;
  return cleaned.map((bubble) =>
    bubble.replace(/[？?]/gu, (questionMark) => {
      questions += 1;
      return questions <= 1 ? questionMark : '。';
    }),
  );
}

export class CompanionService {
  constructor(private readonly dependencies: Dependencies) {}

  async chat(input: ChatInput): Promise<ChatResult> {
    return this.chatWithDelivery(input, async () => undefined);
  }

  async chatWithDelivery(
    input: ChatInput,
    deliver: (result: ChatResult) => Promise<void>,
  ): Promise<ChatResult> {
    return this.dependencies.userOperations.withUserLock(input.userId, async () => {
      const deletedAt = await this.dependencies.deletionBarrier.latestDeletionAt(input.userId);
      if (deletedAt && input.receivedAt.getTime() <= deletedAt.getTime()) {
        return { duplicate: true, discarded: true, bubbles: [], safetyLevel: 'safe' };
      }
      const result = await this.chatLocked(input);
      await deliver(result);
      return result;
    });
  }

  private async chatLocked(input: ChatInput): Promise<ChatResult> {
    const claim = await this.dependencies.conversations.beginProcessing(input.userId, input.messageId);
    if (claim.state === 'completed') {
      return { ...claim.result, duplicate: true };
    }
    if (claim.state === 'processing') {
      throw new Error('Message is still being processed; retry later.');
    }

    try {
      await this.dependencies.conversations.append({
        id: input.messageId,
        userId: input.userId,
        role: 'user',
        text: input.text,
        createdAt: input.receivedAt,
      });

      const relationship = await this.dependencies.relationships.get(input.userId);
      const safety = analyzeSafety(input.text, relationship.ageGroup);
      let bubbles: string[];
      if (claim.draft) {
        bubbles = claim.draft.bubbles;
      } else {
        if (safety.level === 'crisis') {
          bubbles = safeCrisisResponse();
        } else if (safety.level === 'blocked') {
          bubbles = blockedMinorResponse();
        } else if (safety.categories.includes('dependency')) {
          bubbles = dependencyResponse();
        } else {
          const recentMessages = await this.dependencies.conversations.recent(input.userId, 12);
          const memories = await this.dependencies.memory.recall(input.userId, input.text, 5);
          const modelContext = {
            userText: input.text,
            intent: classifyIntent(input.text),
            recentMessages: recentMessages.filter((message) => message.id !== input.messageId),
            memories,
            relationship,
          } as const;
          bubbles = sanitizeBubbles(await this.dependencies.model.generate(modelContext));
          if (!evaluateCompanionReply(bubbles, modelContext).passed) {
            bubbles = modelContext.intent === 'celebrate'
              ? ['这一下确实值得替你高兴。']
              : ['这一下落到你身上，确实挺不好受的。'];
          }
        }
        bubbles = sanitizeBubbles(bubbles);
        await this.dependencies.conversations.saveDraft(input.messageId, claim.claimId, {
          duplicate: false,
          bubbles,
          safetyLevel: safety.level,
        });
      }

      for (const [index, bubble] of bubbles.entries()) {
        await this.dependencies.conversations.append({
          id: `${input.messageId}:assistant:${index + 1}`,
          userId: input.userId,
          role: 'assistant',
          text: bubble,
          createdAt: new Date(),
        });
      }

      if (safety.level === 'safe') {
        await this.dependencies.memory.captureFromMessage(input);
      }
      await this.dependencies.relationships.observeMessage(
        input.userId,
        input.messageId,
        input.text,
        input.receivedAt,
      );

      const result = { duplicate: false, bubbles, safetyLevel: safety.level } as const;
      await this.dependencies.conversations.completeProcessing(input.messageId, claim.claimId, result);
      return result;
    } catch (error) {
      await this.dependencies.conversations.releaseProcessing(input.messageId, claim.claimId);
      throw error;
    }
  }
  async state(userId: string): Promise<unknown> {
    const [relationship, memories, recentMessages] = await Promise.all([
      this.dependencies.relationships.get(userId),
      this.dependencies.memory.list(userId),
      this.dependencies.conversations.recent(userId, 20),
    ]);

    return { relationship, memories, recentMessages };
  }

  async deleteUserData(userId: string): Promise<void> {
    await this.dependencies.userOperations.withUserLock(userId, async () => {
      const deletedAt = new Date();
      if (this.dependencies.deleteUserData) {
        await this.dependencies.deleteUserData(userId, deletedAt);
      } else {
        await Promise.all([
          this.dependencies.conversations.deleteAllByUser(userId),
          this.dependencies.memory.deleteAll(userId),
          this.dependencies.relationships.delete(userId),
        ]);
        await this.dependencies.deletionBarrier.recordDeletion(userId, deletedAt);
      }
    });
  }
}





