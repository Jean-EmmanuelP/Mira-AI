import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MemoryController } from './memory.controller';

export async function memoryRoutes(app: FastifyInstance) {
  const controller = new MemoryController();

  app.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    return controller.getMemories(req, reply);
  });

  app.get('/search', async (req: FastifyRequest, reply: FastifyReply) => {
    return controller.searchMemories(req, reply);
  });
}
