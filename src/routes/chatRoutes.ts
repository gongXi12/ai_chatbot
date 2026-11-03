import type { FastifyInstance } from 'fastify';
import type { ChatController } from '../controllers/ChatController.js';
import { createChatAuth } from '../middleware/chatAuth.js';

export async function registerChatRoutes(
  app: FastifyInstance,
  controller: ChatController,
  chatToken = '',
): Promise<void> {
  if (chatToken) app.addHook('preHandler', createChatAuth(chatToken));
  app.post('/v1/chat', (request, reply) => controller.chat(request, reply));
}