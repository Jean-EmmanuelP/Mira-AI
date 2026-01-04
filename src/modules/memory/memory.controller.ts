import { FastifyRequest, FastifyReply } from 'fastify';
import { StorageService } from './storage.service';
import { RetrievalService } from './retrieval.service';

export class MemoryController {
  private storageService = new StorageService();
  private retrievalService = new RetrievalService();

  async getMemories(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { userId } = req.query as { userId: string };

      if (!userId) {
        return reply.status(400).send({ error: 'userId required' });
      }

      const memories = await this.storageService.getMemories(userId, 50);
      return { success: true, memories };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to fetch memories' });
    }
  }

  async searchMemories(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { userId, q } = req.query as { userId: string; q: string };

      if (!userId || !q) {
        return reply.status(400).send({ error: 'userId and q required' });
      }

      const results = await this.retrievalService.retrieveRelevantMemories(userId, q, 10);
      return { success: true, results };
    } catch (error) {
      return reply.status(500).send({ error: 'Search failed' });
    }
  }
}
