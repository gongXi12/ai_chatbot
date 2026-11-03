import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Sentry } from './instrument.js';
import { config } from './config/unifiedConfig.js';
import { AdminController } from './controllers/AdminController.js';
import { ChatController } from './controllers/ChatController.js';
import type { ConversationRepository } from './repositories/ConversationRepository.js';
import { InMemoryConversationRepository } from './repositories/InMemoryConversationRepository.js';
import { InMemoryMemoryRepository } from './repositories/InMemoryMemoryRepository.js';
import { InMemoryRelationshipRepository } from './repositories/InMemoryRelationshipRepository.js';
import { InMemoryOutboundDeliveryRepository } from './repositories/InMemoryOutboundDeliveryRepository.js';
import type { OutboundDeliveryRepository } from './repositories/OutboundDeliveryRepository.js';
import { InMemoryUserDeletionBarrier } from './repositories/InMemoryUserDeletionBarrier.js';
import type { UserDeletionBarrier } from './repositories/UserDeletionBarrier.js';
import type { MemoryRepository } from './repositories/MemoryRepository.js';
import type { RelationshipRepository } from './repositories/RelationshipRepository.js';
import { registerAdminRoutes } from './routes/adminRoutes.js';
import { registerChatRoutes } from './routes/chatRoutes.js';
import { CompanionService } from './services/companionService.js';
import { createCompanionModel } from './services/createCompanionModel.js';
import { DiagnosticService } from './services/diagnosticService.js';
import { MemoryService } from './services/memoryService.js';
import type { CompanionModel } from './services/model/CompanionModel.js';
import { RelationshipService } from './services/relationshipService.js';
import { InMemoryUserOperationLock, type UserOperationLock } from './services/UserOperationLock.js';

interface BuildAppOptions {
  adminToken?: string;
  chatToken?: string;
  repositories?: {
    conversations: ConversationRepository;
    memories: MemoryRepository;
    relationships: RelationshipRepository;
  };
  model?: CompanionModel;
  userOperations?: UserOperationLock;
  outboundDeliveries?: OutboundDeliveryRepository;
  deletionBarrier?: UserDeletionBarrier;
  deleteUserData?: (userId: string, deletedAt: Date) => Promise<void>;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: config.environment === 'test' ? false : { level: config.server.logLevel },
  });

  const repositories = options.repositories ?? {
    conversations: new InMemoryConversationRepository(),
    memories: new InMemoryMemoryRepository(),
    relationships: new InMemoryRelationshipRepository(),
  };
  const outboundDeliveries = options.outboundDeliveries ?? new InMemoryOutboundDeliveryRepository();
  const deletionBarrier = options.deletionBarrier ?? new InMemoryUserDeletionBarrier();
  const memoryService = new MemoryService(repositories.memories);
  const relationshipService = new RelationshipService(repositories.relationships, {
    autoAffection: config.companion.autoAffection,
  });
  const companionService = new CompanionService({
    conversations: repositories.conversations,
    memory: memoryService,
    relationships: relationshipService,
    model: options.model ?? createCompanionModel(),
    userOperations: options.userOperations ?? new InMemoryUserOperationLock(),
    deletionBarrier,
    deleteUserData: options.deleteUserData ?? (async (userId: string, deletedAt: Date) => {
      await Promise.all([
        repositories.conversations.deleteAllByUser(userId),
        repositories.memories.deleteAllByUser(userId),
        repositories.relationships.delete(userId),
        outboundDeliveries.deleteAllByUser(userId),
      ]);
      await deletionBarrier.recordDeletion(userId, deletedAt);
    }),
  });
  const chatController = new ChatController(companionService);
  const adminController = new AdminController(
    companionService,
    new DiagnosticService({
      conversations: repositories.conversations,
      memory: memoryService,
      relationships: relationshipService,
    }),
  );

  app.get('/health', async () => ({ status: 'ok' }));
  const chatToken = options.chatToken ?? config.chatApi.token;
  app.register(async (instance) => registerChatRoutes(instance, chatController, chatToken));
  const adminToken = options.adminToken ?? config.admin.token;
  if (adminToken) {
    app.register(
      async (instance) => registerAdminRoutes(instance, adminController, adminToken),
      { prefix: '/admin' },
    );
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      void reply.code(400).send({
        error: 'VALIDATION_ERROR',
        details: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      });
      return;
    }

    Sentry.captureException(error, { extra: { method: request.method, url: request.url } });
    request.log.error({ err: error }, 'request failed');
    void reply.code(500).send({ error: 'INTERNAL_SERVER_ERROR' });
  });

  return app;
}





