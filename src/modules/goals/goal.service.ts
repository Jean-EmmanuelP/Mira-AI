import { Goal } from '../../database/schemas/goal.schema';
import { LLMService } from '../../shared/llm.service';

interface ExtractedGoal {
  goal: string;
  targetDate?: string | null;
}

export class GoalService {
  private llmService = new LLMService();

  async detectGoals(userId: string, content: string): Promise<void> {
    const now = new Date();
    const prompt = `Extract any goals or aspirations mentioned in this text.
Current date: ${now.toISOString()}

For each goal, extract:
- goal: the goal description (e.g., "Run a marathon", "Learn Spanish", "Get a promotion")
- targetDate: ISO date string if a deadline/target date is mentioned (parse "next month", "by December", "in 6 months", etc.), null otherwise

Examples:
- "I want to run a marathon by June" → { goal: "Run a marathon", targetDate: "2026-06-01T00:00:00Z" }
- "I'm learning to code" → { goal: "Learn to code", targetDate: null }
- "I need to lose 10kg before summer" → { goal: "Lose 10kg", targetDate: "2026-06-21T00:00:00Z" }

Return JSON array: [{ goal: string, targetDate: string | null }]

Text: "${content}"`;

    try {
      const extracted = await this.llmService.extract(prompt);
      const goals: ExtractedGoal[] = Array.isArray(extracted) ? extracted : [];

      for (const { goal, targetDate } of goals) {
        if (goal && goal.trim()) {
          const existing = await Goal.findOne({ userId, goal: goal.trim() });
          if (!existing) {
            const goalData: any = {
              userId,
              goal: goal.trim(),
              status: 'active',
            };

            // Parse target date if provided
            if (targetDate) {
              try {
                const parsedDate = new Date(targetDate);
                if (!isNaN(parsedDate.getTime()) && parsedDate > now) {
                  goalData.targetDate = parsedDate;
                  console.log(`📅 Goal with target date: ${goal} (by ${parsedDate.toLocaleDateString()})`);
                }
              } catch {
                // Invalid date, skip it
              }
            }

            await Goal.create(goalData);
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
