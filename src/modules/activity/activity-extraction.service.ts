import { UserActivity, IActivityTag, ActivityCategory } from '../../database/schemas/user-activity.schema';
import { LLMService } from '../../shared/llm.service';

export interface ExtractedActivity {
  name: string;
  category: ActivityCategory;
  confidence: number;
}

export class ActivityExtractionService {
  private llmService: LLMService | null = null;

  private getLLMService(): LLMService {
    if (!this.llmService) {
      this.llmService = new LLMService();
    }
    return this.llmService;
  }

  /**
   * Extract activities from a user message using LLM
   */
  async extractActivitiesFromMessage(message: string): Promise<ExtractedActivity[]> {
    const prompt = `Extrait les activités et intérêts de ce message.
Catégories: tech, hobby, sports, passion, work, learning, other
Réponds UNIQUEMENT avec un JSON valide.

Message: "${message}"

Format: [{"name": "activité", "category": "hobby", "confidence": 0.9}]
Si rien: []`;

    try {
      const response = await this.getLLMService().generate(prompt, '');
      console.log(`   LLM response: ${response.substring(0, 200)}`);

      // Parse JSON from response (handle markdown code blocks)
      let jsonStr = response;
      const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1];
      }

      const jsonMatch = jsonStr.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) {
        console.log('   No JSON array found in response');
        return [];
      }

      const activities = JSON.parse(jsonMatch[0]) as ExtractedActivity[];
      return activities.filter(a => a.confidence >= 0.6);
    } catch (error) {
      console.error('Activity extraction error:', error);
      return [];
    }
  }

  /**
   * Update user profile with newly extracted activities
   */
  async updateUserActivities(userId: string, newActivities: ExtractedActivity[]): Promise<void> {
    if (newActivities.length === 0) return;

    let userActivity = await UserActivity.findOne({ userId });

    if (!userActivity) {
      // Create new profile
      userActivity = new UserActivity({
        userId,
        activities: newActivities.map(a => ({
          name: a.name.toLowerCase(),
          category: a.category,
          confidence: a.confidence,
          frequency: 1,
          firstMentioned: new Date(),
          lastMentioned: new Date()
        }))
      });
      userActivity.profileCompleteness = this.calculateProfileCompleteness(userActivity.activities);
      await userActivity.save();
      return;
    }

    // Merge with existing activities
    const now = new Date();

    for (const newActivity of newActivities) {
      const activityName = newActivity.name.toLowerCase();
      const existing = userActivity.activities.find(
        a => a.name.toLowerCase() === activityName
      );

      if (existing) {
        // Update existing
        existing.frequency += 1;
        existing.lastMentioned = now;
        existing.confidence = Math.min(1, existing.confidence + 0.05);
        if (newActivity.category && newActivity.category !== 'other') {
          existing.category = newActivity.category;
        }
      } else {
        // Add new
        userActivity.activities.push({
          name: activityName,
          category: newActivity.category,
          confidence: newActivity.confidence,
          frequency: 1,
          firstMentioned: now,
          lastMentioned: now
        } as IActivityTag);
      }
    }

    // Update profile completeness
    userActivity.profileCompleteness = this.calculateProfileCompleteness(userActivity.activities);
    userActivity.lastActivityExtractedAt = now;

    await userActivity.save();
  }

  /**
   * Calculate profile completeness (0-1)
   */
  private calculateProfileCompleteness(activities: IActivityTag[]): number {
    if (activities.length === 0) return 0;

    // Diversity score (capped at 10 unique activities)
    const diversityScore = Math.min(1, activities.length / 10);

    // Frequency score (total mentions capped at 20)
    const totalFrequency = activities.reduce((sum, a) => sum + a.frequency, 0);
    const frequencyScore = Math.min(1, totalFrequency / 20);

    // Recency score
    const recencyScore = this.calculateRecencyScore(activities);

    return (diversityScore + frequencyScore + recencyScore) / 3;
  }

  /**
   * Calculate recency score based on recent activity mentions
   */
  private calculateRecencyScore(activities: IActivityTag[]): number {
    if (activities.length === 0) return 0;

    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentActivities = activities.filter(
      a => new Date(a.lastMentioned).getTime() > oneWeekAgo
    );

    return recentActivities.length / activities.length;
  }

  /**
   * Get top activities by relevance for a user
   */
  async getTopActivities(userId: string, limit: number = 10): Promise<IActivityTag[]> {
    const userActivity = await UserActivity.findOne({ userId });
    if (!userActivity) return [];

    return userActivity.activities
      .sort((a, b) => {
        // Sort by: recency (50%), frequency (30%), confidence (20%)
        const aRecency = new Date(a.lastMentioned).getTime();
        const bRecency = new Date(b.lastMentioned).getTime();
        const recencyWeight = (bRecency - aRecency) / (1000 * 60 * 60 * 24); // Days difference

        const frequencyWeight = (b.frequency - a.frequency) * 3;
        const confidenceWeight = (b.confidence - a.confidence) * 2;

        return recencyWeight + frequencyWeight + confidenceWeight;
      })
      .slice(0, limit);
  }

  /**
   * Get user activity profile
   */
  async getUserActivityProfile(userId: string) {
    return UserActivity.findOne({ userId });
  }

  /**
   * Get activities by category
   */
  async getActivitiesByCategory(userId: string, category: ActivityCategory): Promise<IActivityTag[]> {
    const userActivity = await UserActivity.findOne({ userId });
    if (!userActivity) return [];

    return userActivity.activities.filter(a => a.category === category);
  }

  /**
   * Process message and extract activities (convenience method)
   */
  async processMessage(userId: string, message: string): Promise<ExtractedActivity[]> {
    try {
      const activities = await this.extractActivitiesFromMessage(message);
      console.log(`🎯 Activity extraction for ${userId}: found ${activities.length} activities`);
      if (activities.length > 0) {
        console.log(`   Activities: ${activities.map(a => a.name).join(', ')}`);
        await this.updateUserActivities(userId, activities);
        console.log(`   ✅ Activities saved for ${userId}`);
      }
      return activities;
    } catch (error) {
      console.error(`❌ Activity extraction error for ${userId}:`, error);
      return [];
    }
  }
}
