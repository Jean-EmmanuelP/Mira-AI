import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { OnboardingService } from './onboarding.service';

let service: OnboardingService | null = null;

function getService(): OnboardingService {
  if (!service) {
    service = new OnboardingService();
  }
  return service;
}

export async function onboardingRoutes(app: FastifyInstance) {
  // Check if user needs onboarding
  app.get('/check', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = req.query as { userId: string };
      if (!userId) return reply.status(400).send({ error: 'userId required' });

      const needs = await getService().needsOnboarding(userId);
      return { success: true, needsOnboarding: needs };
    } catch (error) {
      return reply.status(500).send({ error: 'Check failed' });
    }
  });

  // Get next question
  app.get('/question', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId, lang } = req.query as { userId: string; lang?: 'fr' | 'en' };
      if (!userId) return reply.status(400).send({ error: 'userId required' });

      const question = await getService().getNextQuestion(userId, lang || 'fr');
      return { success: true, ...question };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to get question' });
    }
  });

  // Submit answer
  app.post('/answer', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId, questionId, answer, skipped } = req.body as {
        userId: string;
        questionId: number;
        answer?: string;
        skipped?: boolean;
      };

      if (!userId || !questionId) {
        return reply.status(400).send({ error: 'Missing userId or questionId' });
      }

      await getService().processAnswer(userId, questionId, answer || '', skipped || false);

      // Get next question
      const next = await getService().getNextQuestion(userId);
      return { success: true, message: 'Answer saved', next };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to process answer' });
    }
  });

  // Skip entire onboarding
  app.post('/skip', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = req.body as { userId: string };
      if (!userId) return reply.status(400).send({ error: 'userId required' });

      await getService().skipOnboarding(userId);
      return { success: true, message: 'Onboarding skipped' };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to skip' });
    }
  });

  // Get status
  app.get('/status', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = req.query as { userId: string };
      if (!userId) return reply.status(400).send({ error: 'userId required' });

      const onboarding = await getService().getUserOnboarding(userId);
      return {
        success: true,
        completed: onboarding?.completed || false,
        skipped: !!onboarding?.skippedAt,
        progress: onboarding?.responses?.length || 0,
        totalQuestions: 9,
        name: onboarding?.name
      };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to get status' });
    }
  });
}
