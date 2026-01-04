import { FastifyRequest, FastifyReply } from 'fastify';
import { MessageService } from './message.service';
import { Logger } from '../../shared/logger';

export class MessageController {
  private messageService = new MessageService();

  /**
   * Calculate realistic typing delay based on message length
   * Average typing speed: 38-40 words per minute = ~1.5 seconds per word
   * Also adds some randomness to feel more human
   */
  private calculateTypingDelay(messageContent: string): number {
    // Count words (split by spaces)
    const wordCount = messageContent.trim().split(/\s+/).length;

    // Base: ~1.5 seconds per word (40 words/minute)
    const baseDelayPerWord = 1500; // ms

    // Calculate raw delay
    let delay = wordCount * baseDelayPerWord;

    // Add some randomness (±20%)
    const randomFactor = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
    delay = delay * randomFactor;

    // Add a small "thinking" delay before typing (0.5-2 seconds)
    const thinkingDelay = 500 + Math.random() * 1500;
    delay += thinkingDelay;

    // Cap between 1 second and 15 seconds
    delay = Math.max(1000, Math.min(delay, 15000));

    return Math.round(delay);
  }

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

      // Calculate how long the frontend should wait before showing the message
      // This simulates realistic typing speed
      const typingDelay = this.calculateTypingDelay(message.content);

      Logger.log('MessageController', `Message processed in ${duration}ms, typing delay: ${typingDelay}ms`, {
        userId,
        conversationId: convId,
        duration,
        typingDelay,
        wordCount: message.content.trim().split(/\s+/).length,
      });

      return {
        success: true,
        message,
        conversationId: convId,
        processingTime: duration,
        typingDelay, // Frontend should wait this long before displaying
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
