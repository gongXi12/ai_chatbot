import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

function equalToken(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

export function createChatAuth(chatToken: string) {
  return async function chatAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const provided = request.headers['x-chat-token'];
    if (typeof provided !== 'string' || !equalToken(provided, chatToken)) {
      await reply.code(401).send({ error: 'UNAUTHORIZED' });
    }
  };
}