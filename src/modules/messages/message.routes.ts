import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MessageController } from './message.controller';

export async function messageRoutes(app: FastifyInstance) {
  const controller = new MessageController();

  app.post('/chat', async (req: FastifyRequest, reply: FastifyReply) => {
    return controller.chat(req, reply);
  });

  app.get('/conversation/:conversationId', async (req: FastifyRequest, reply: FastifyReply) => {
    return controller.getConversation(req, reply);
  });
}
