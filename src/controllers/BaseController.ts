import type { FastifyReply } from 'fastify';

export abstract class BaseController {
  protected async sendSuccess(reply: FastifyReply, data: unknown, statusCode = 200): Promise<void> {
    await reply.code(statusCode).send(data);
  }

  protected async sendNoContent(reply: FastifyReply): Promise<void> {
    await reply.code(204).send();
  }
}
