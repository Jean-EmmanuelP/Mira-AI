import { FastifyRequest, FastifyReply } from 'fastify';
import { MessageService } from './message.service';
import { Logger } from '../../shared/logger';

export class MessageController {
  private messageService = new MessageService();

  async chat(req: FastifyRequest, reply: FastifyReply) {
    const startTime = Date.now();

    try {
      const { userId, conversationId, content } = req.body as {
        userId: string;
        conversationId?: string;
        content: string;
      };

      if (!userId || !content) {
        return reply.status(400).send({ error: 'Missing required fields: userId, content' });
      }

      const convId = conversationId || `conv-${Date.now()}`;

      const message = await this.messageService.processMessage(userId, convId, content);

      const duration = Date.now() - startTime;

      Logger.log('MessageController', `Message processed in ${duration}ms`, {
        userId,
        conversationId: convId,
        duration,
      });

      return {
        success: true,
        message,
        conversationId: convId,
        processingTime: duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      Logger.error('MessageController', 'Failed to process message', error);
      return reply.status(500).send({
        error: 'Failed to process message',
        processingTime: duration,
      });
    }
  }

  async getConversation(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { conversationId } = req.params as { conversationId: string };
      const { userId } = req.query as { userId: string };

      if (!userId) {
        return reply.status(400).send({ error: 'userId required' });
      }

      const messages = await this.messageService.getConversation(userId, conversationId);

      return { success: true, messages, count: messages.length };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to fetch conversation' });
    }
  }
}
