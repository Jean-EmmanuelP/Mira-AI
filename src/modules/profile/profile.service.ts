import { SemanticMemory } from '../../database/schemas/memory.schema';
import { Goal } from '../../database/schemas/goal.schema';
import { LLMService } from '../../shared/llm.service';
import { CacheService } from '../../shared/cache.service';

export class ProfileService {
  private llmService = new LLMService();
  private cacheService = new CacheService();

  async generateUserSummary(userId: string): Promise<string> {
    const cacheKey = `summary:${userId}`;

    const cached = await this.cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    const memories = await SemanticMemory.find({ userId })
      .sort({ lastMentioned: -1 })
      .limit(15)
      .lean();

    const goals = await Goal.find({ userId, status: 'active' }).limit(5).lean();

    if (memories.length === 0) {
      return '';
    }

    const memoryText = memories.map((m: any) => `- ${m.fact}`).join('\n');

    const goalText =
      goals.length > 0
        ? `\n\nCurrent goals:\n${goals.map((g: any) => `- ${g.goal}`).join('\n')}`
        : '';

    const prompt = `Based on these facts and goals, write a brief 1-2 sentence summary of who this person is:

${memoryText}${goalText}

Write in second person ("You are...").`;

    try {
      const summary = await this.llmService.generate('', prompt);
      await this.cacheService.set(cacheKey, summary, 7 * 24 * 3600);
      return summary;
    } catch {
      return '';
    }
  }

  async invalidateCache(userId: string): Promise<void> {
    await this.cacheService.del(`summary:${userId}`);
  }
}
