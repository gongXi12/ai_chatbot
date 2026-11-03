import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CompanionService } from '../services/companionService.js';
import { BaseController } from './BaseController.js';

const chatSchema = z.object({
  userId: z.string().trim().min(1).max(128),
  messageId: z.string().trim().min(1).max(256),
  text: z.string().trim().min(1).max(8_000),
  receivedAt: z.coerce.date().optional(),
});

export class ChatController extends BaseController {
  constructor(private readonly companionService: CompanionService) {
    super();
  }

  async chat(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const input = chatSchema.parse(request.body);
    const result = await this.companionService.chat({
      userId: input.userId,
      messageId: `http:${input.userId}:${input.messageId}`,
      text: input.text,
      receivedAt: input.receivedAt ?? new Date(),
    });
    await this.sendSuccess(reply, result);
  }
}
