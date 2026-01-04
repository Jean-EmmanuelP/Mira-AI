import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MessageController } from './message.controller';
import { ReengagementService } from '../human/reengagement.service';

let reengagementService: ReengagementService | null = null;

function getReengagementService(): ReengagementService {
  if (!reengagementService) {
    reengagementService = new ReengagementService();
  }
  return reengagementService;
}

export async function messageRoutes(app: FastifyInstance) {
  const controller = new MessageController();

  app.post('/chat', async (req: FastifyRequest, reply: FastifyReply) => {
    return controller.chat(req, reply);
  });

  app.get('/conversation/:conversationId', async (req: FastifyRequest, reply: FastifyReply) => {
    return controller.getConversation(req, reply);
  });

  // Check for re-engagement message when user returns
  app.get('/reengagement', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = req.query as { userId: string };
      if (!userId) {
        return reply.status(400).send({ error: 'userId required' });
      }

      const message = await getReengagementService().checkReengagement(userId);

      if (message && message.message) {
        return {
          success: true,
          hasMessage: true,
          type: message.type,
          message: message.message
        };
      }

      return {
        success: true,
        hasMessage: false
      };
    } catch (error) {
      console.error('Reengagement check error:', error);
      return { success: true, hasMessage: false };
    }
  });
}
