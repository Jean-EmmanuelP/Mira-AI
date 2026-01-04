import { Goal } from '../../database/schemas/goal.schema';
import { LLMService } from '../../shared/llm.service';

export class GoalService {
  private llmService = new LLMService();

  async detectGoals(userId: string, content: string): Promise<void> {
    const prompt = `Extract any goals mentioned in this text.
Return JSON: [{ goal: string }]

Text: "${content}"`;

    try {
      const extracted = await this.llmService.extract(prompt);
      const goals = Array.isArray(extracted) ? extracted : [];

      for (const { goal } of goals) {
        if (goal && goal.trim()) {
          const existing = await Goal.findOne({ userId, goal: goal.trim() });
          if (!existing) {
            await Goal.create({
              userId,
              goal: goal.trim(),
              status: 'active',
            });
            console.log(`✅ New goal detected for user ${userId}: ${goal}`);
          }
        }
      }
    } catch (error) {
      console.error('Goal detection error:', error);
    }
  }

  async getActiveGoals(userId: string) {
    return Goal.find({ userId, status: 'active' });
  }

  async updateGoalProgress(userId: string, goalId: string, progress: number) {
    return Goal.findOneAndUpdate(
      { _id: goalId, userId },
      { progress, status: progress >= 100 ? 'completed' : 'active' },
      { new: true }
    );
  }
}
