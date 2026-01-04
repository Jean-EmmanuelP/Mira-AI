import { SemanticMemory } from '../../database/schemas/memory.schema';
import { Message } from '../../database/schemas/message.schema';

export interface DetectedPattern {
  type: 'emotional' | 'temporal' | 'behavioral';
  description: string;
  confidence: number;
  observations: string[];
}

export class PatternService {
  /**
   * Detects recurring emotional patterns for a user
   */
  async detectEmotionalPatterns(userId: string): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];

    // Get recent messages with sentiment data
    const recentMessages = await Message.find({
      userId,
      role: 'user',
      'metadata.sentiment': { $exists: true },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    if (recentMessages.length < 5) return patterns;

    // Analyze sentiment trends
    const sentimentCounts: Record<string, number> = {};
    const dayOfWeekSentiment: Record<number, string[]> = {};

    for (const msg of recentMessages) {
      const sentiment = (msg as any).metadata?.sentiment;
      if (sentiment) {
        sentimentCounts[sentiment] = (sentimentCounts[sentiment] || 0) + 1;

        const dayOfWeek = new Date(msg.createdAt).getDay();
        if (!dayOfWeekSentiment[dayOfWeek]) dayOfWeekSentiment[dayOfWeek] = [];
        dayOfWeekSentiment[dayOfWeek].push(sentiment);
      }
    }

    // Check for dominant negative sentiment
    const total = Object.values(sentimentCounts).reduce((a, b) => a + b, 0);
    const stressCount = (sentimentCounts['stressed'] || 0) + (sentimentCounts['anxious'] || 0);
    if (stressCount / total > 0.3) {
      patterns.push({
        type: 'emotional',
        description: 'tends to feel stressed or anxious frequently',
        confidence: stressCount / total,
        observations: [`${Math.round((stressCount / total) * 100)}% of messages show stress/anxiety`],
      });
    }

    // Check for day-of-week patterns
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const [day, sentiments] of Object.entries(dayOfWeekSentiment)) {
      const negativeSentiments = sentiments.filter((s) =>
        ['stressed', 'anxious', 'sad', 'frustrated'].includes(s)
      );
      if (sentiments.length >= 3 && negativeSentiments.length / sentiments.length > 0.6) {
        patterns.push({
          type: 'temporal',
          description: `often seems stressed on ${dayNames[parseInt(day)]}s`,
          confidence: negativeSentiments.length / sentiments.length,
          observations: [
            `${negativeSentiments.length} out of ${sentiments.length} ${dayNames[parseInt(day)]} messages were negative`,
          ],
        });
      }
    }

    return patterns;
  }

  /**
   * Detects topic patterns - what they talk about most
   */
  async detectTopicPatterns(userId: string): Promise<DetectedPattern[]> {
    const patterns: DetectedPattern[] = [];

    // Get memory categories distribution
    const memories = await SemanticMemory.find({ userId }).lean();

    if (memories.length < 5) return patterns;

    const categoryCounts: Record<string, number> = {};
    for (const memory of memories) {
      categoryCounts[memory.category] = (categoryCounts[memory.category] || 0) + 1;
    }

    // Find dominant categories
    const total = memories.length;
    const sortedCategories = Object.entries(categoryCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);

    for (const [category, count] of sortedCategories) {
      if (count / total > 0.25) {
        patterns.push({
          type: 'behavioral',
          description: this.categoryToDescription(category),
          confidence: count / total,
          observations: [`${count} memories in ${category} category`],
        });
      }
    }

    return patterns;
  }

  /**
   * Converts category to human-readable pattern description
   */
  private categoryToDescription(category: string): string {
    const descriptions: Record<string, string> = {
      professional: 'often talks about work and career',
      health: 'health and wellness are important to them',
      goals: 'is goal-oriented and planning ahead',
      relationship: 'values their relationships with others',
      emotional: 'shares their feelings openly',
      preferences: 'knows what they like and shares preferences',
      personal: 'shares personal details and identity',
    };
    return descriptions[category] || `frequently discusses ${category} topics`;
  }

  /**
   * Gets all patterns for context building
   */
  async getAllPatterns(userId: string): Promise<DetectedPattern[]> {
    const [emotional, topics] = await Promise.all([
      this.detectEmotionalPatterns(userId),
      this.detectTopicPatterns(userId),
    ]);

    return [...emotional, ...topics].sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Formats patterns for the system prompt
   */
  formatPatternsForPrompt(patterns: DetectedPattern[]): string {
    if (patterns.length === 0) return '';

    const formatted = patterns.slice(0, 3).map((p) => `- ${p.description}`);

    return `### Patterns You've Noticed\n${formatted.join('\n')}`;
  }
}
