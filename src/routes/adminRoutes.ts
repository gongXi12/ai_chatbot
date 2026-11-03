import type { FastifyInstance } from 'fastify';
import type { AdminController } from '../controllers/AdminController.js';
import { createAdminAuth } from '../middleware/adminAuth.js';

export async function registerAdminRoutes(
  app: FastifyInstance,
  controller: AdminController,
  adminToken: string,
): Promise<void> {
  const auth = createAdminAuth(adminToken);
  app.addHook('onSend', async (_request, reply, payload) => {
    void reply
      .header('cache-control', 'no-store, private')
      .header('pragma', 'no-cache')
      .header('vary', 'x-admin-token');
    return payload;
  });
  app.addHook('preHandler', auth);
  app.get('/', (request, reply) => controller.page(request, reply));
  app.get('/api/users/:userId/state', (request, reply) => controller.state(request, reply));
  app.post('/api/diagnostics/preview', (request, reply) => controller.preview(request, reply));
  app.delete('/api/users/:userId/data', (request, reply) => controller.deleteUserData(request, reply));
}
