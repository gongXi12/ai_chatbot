import type { Memory, MemoryType } from '../domain/types.js';
import type { MemoryRepository } from '../repositories/MemoryRepository.js';

interface CaptureInput {
  userId: string;
  messageId: string;
  text: string;
  receivedAt: Date;
}

interface ExtractedMemory {
  type: MemoryType;
  content: string;
  topic: string;
  confidence: number;
  importance: number;
  correction: boolean;
}

const blockedSensitivePatterns = [
  /密码/u,
  /银行卡/u,
  /身份证/u,
  /精确住址/u,
];

function extractMemory(text: string): ExtractedMemory | undefined {
  if (blockedSensitivePatterns.some((pattern) => pattern.test(text))) return undefined;

  if (/面试/u.test(text) && /(明天|后天|下周|周[一二三四五六日天])/u.test(text)) {
    return {
      type: 'commitment',
      content: text,
      topic: '面试',
      confidence: 0.95,
      importance: 0.8,
      correction: false,
    };
  }

  const negativePreference = text.match(/我(?:现在)?不喜欢(?:喝|吃|看|听)?(.+?)(?:了)?$/u);
  if (negativePreference?.[1]) {
    const object = negativePreference[1].replace(/了$/u, '');
    return {
      type: 'profile_fact',
      content: text,
      topic: object,
      confidence: 0.98,
      importance: 0.6,
      correction: true,
    };
  }

  const positivePreference = text.match(/我喜欢(?:喝|吃|看|听)?(.+)$/u);
  if (positivePreference?.[1]) {
    return {
      type: 'profile_fact',
      content: text,
      topic: positivePreference[1],
      confidence: 0.95,
      importance: 0.5,
      correction: false,
    };
  }

  return undefined;
}

export class MemoryService {
  constructor(private readonly repository: MemoryRepository) {}

  async captureFromMessage(input: CaptureInput): Promise<Memory | undefined> {
    const extracted = extractMemory(input.text.trim());
    if (!extracted) return undefined;

    const memoryId = `${input.messageId}:memory`;
    const existing = await this.repository.listActiveByUser(input.userId);
    const alreadyCaptured = existing.find((memory) => memory.id === memoryId);
    if (alreadyCaptured) return alreadyCaptured;
    const prior = existing.find(
      (memory) =>
        memory.type === extracted.type &&
        (memory.topic.includes(extracted.topic) || extracted.topic.includes(memory.topic)),
    );


    const memory: Memory = {
      id: memoryId,
      userId: input.userId,
      type: extracted.type,
      content: extracted.content,
      topic: extracted.topic,
      sourceMessageIds: [input.messageId],
      observedAt: input.receivedAt,
      confidence: extracted.confidence,
      importance: extracted.importance,
      sensitivity: 'normal',
      status: 'active',
      ...(prior && extracted.correction ? { supersedesMemoryId: prior.id } : {}),
    };

    if (prior && extracted.correction) {
      await this.repository.replace(prior.id, memory);
    } else {
      await this.repository.save(memory);
    }
    return memory;
  }

  async recall(userId: string, query: string, limit: number): Promise<Memory[]> {
    const active = await this.repository.listActiveByUser(userId);
    const terms = [...new Set(query.split(/[^\p{L}\p{N}]+/u).filter(Boolean))];

    return active
      .map((memory) => ({
        memory,
        score:
          Number(query.includes(memory.topic) || memory.topic.includes(query)) * 10 +
          terms.filter((term) => memory.content.includes(term)).length +
          memory.importance,
      }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ memory }) => memory);
  }

  async list(userId: string): Promise<Memory[]> {
    return this.repository.listActiveByUser(userId);
  }

  async deleteAll(userId: string): Promise<void> {
    await this.repository.deleteAllByUser(userId);
  }
}


