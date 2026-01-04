import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ProfileService } from './profile.service';
import { GoalService } from '../goals/goal.service';

export async function profileRoutes(app: FastifyInstance) {
  const profileService = new ProfileService();
  const goalService = new GoalService();

  app.get('/:userId', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = req.params as { userId: string };
      const summary = await profileService.generateUserSummary(userId);
      const goals = await goalService.getActiveGoals(userId);
      return { success: true, summary, goals };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to fetch profile' });
    }
  });
}
