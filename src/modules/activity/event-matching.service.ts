import { NewsEvent, INewsEvent } from '../../database/schemas/news-event.schema';
import { UserActivity, IActivityTag } from '../../database/schemas/user-activity.schema';
import { ActivityExtractionService } from './activity-extraction.service';

export interface MatchedEvent {
  _id: any;
  title: string;
  description?: string;
  source: string;
  url: string;
  tags: string[];
  relevanceScore: number;
}

export class EventMatchingService {
  private activityService = new ActivityExtractionService();

  /**
   * Find events relevant to a user based on their activities
   */
  async findRelevantEventsForUser(userId: string, limit: number = 5): Promise<MatchedEvent[]> {
    const userActivity = await UserActivity.findOne({ userId });
    if (!userActivity || userActivity.activities.length === 0) {
      return [];
    }

    const topActivities = await this.activityService.getTopActivities(userId, 10);
    const activityNames = topActivities.map(a => a.name.toLowerCase());

    // Get recent events not yet mentioned to this user
    const recentEvents = await NewsEvent.find({
      fetchedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      expiresAt: { $gt: new Date() },
      'mentionedTo.userId': { $ne: userId }
    }).limit(100);

    // Score events by relevance
    const scoredEvents: MatchedEvent[] = recentEvents.map(event => {
      const score = this.calculateEventRelevance(event, activityNames, topActivities);
      return {
        ...event.toObject(),
        relevanceScore: score
      } as MatchedEvent;
    });

    // Filter and sort
    return scoredEvents
      .filter(e => e.relevanceScore > 0.4)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  /**
   * Calculate relevance score between an event and user activities
   */
  private calculateEventRelevance(
    event: INewsEvent,
    activityNames: string[],
    userActivities: IActivityTag[]
  ): number {
    const eventTags = event.tags.map(t => t.toLowerCase());
    const eventTitle = event.title.toLowerCase();
    const eventDesc = (event.description || '').toLowerCase();

    let totalScore = 0;
    let matchCount = 0;

    for (const activity of userActivities) {
      const activityName = activity.name.toLowerCase();

      // Check tag matches
      const tagMatch = eventTags.some(tag =>
        tag.includes(activityName) ||
        activityName.includes(tag) ||
        this.isSimilar(tag, activityName)
      );

      // Check title/description matches
      const titleMatch = eventTitle.includes(activityName) || activityName.includes(eventTitle);
      const descMatch = eventDesc.includes(activityName);

      if (tagMatch || titleMatch || descMatch) {
        matchCount++;

        // Weight by activity metrics
        const recencyWeight = this.getRecencyWeight(activity.lastMentioned);
        const frequencyWeight = Math.min(1, activity.frequency / 5);
        const confidenceWeight = activity.confidence;

        // Combine weights
        const activityScore = (recencyWeight * 0.4 + frequencyWeight * 0.3 + confidenceWeight * 0.3);
        totalScore += activityScore;
      }
    }

    // Normalize score
    if (matchCount === 0) return 0;
    return Math.min(1, totalScore / matchCount);
  }

  /**
   * Simple similarity check between strings
   */
  private isSimilar(str1: string, str2: string): boolean {
    const words1 = str1.split(/\s+/);
    const words2 = str2.split(/\s+/);

    // Check if any significant word matches
    return words1.some(w1 =>
      w1.length > 3 && words2.some(w2 => w2.length > 3 && w1 === w2)
    );
  }

  /**
   * Weight by recency of activity mention
   */
  private getRecencyWeight(lastMentioned: Date): number {
    const daysSince = (Date.now() - new Date(lastMentioned).getTime()) / (24 * 60 * 60 * 1000);

    if (daysSince <= 1) return 1.0;
    if (daysSince <= 3) return 0.9;
    if (daysSince <= 7) return 0.7;
    if (daysSince <= 14) return 0.5;
    if (daysSince <= 30) return 0.3;
    return 0.1;
  }

  /**
   * Mark event as mentioned to user
   */
  async markEventAsMentioned(userId: string, eventId: string): Promise<void> {
    await NewsEvent.findByIdAndUpdate(eventId, {
      $addToSet: {
        mentionedTo: {
          userId,
          mentionedAt: new Date()
        }
      }
    });

    // Update user activity profile
    await UserActivity.findOneAndUpdate(
      { userId },
      {
        lastEventMentionedAt: new Date(),
        $inc: { eventsMentionedCount: 1 }
      }
    );
  }

  /**
   * Check if we should mention an event to this user
   * Anti-spam rules:
   * - Max 1 event per 24 hours
   * - Only if profile completeness > 40%
   * - Random chance (70%)
   */
  async shouldMentionEvent(userId: string): Promise<boolean> {
    const userActivity = await UserActivity.findOne({ userId });
    if (!userActivity) return false;

    // Need reasonable activity profile
    if (userActivity.profileCompleteness < 0.4) {
      return false;
    }

    // Max once per 24 hours
    if (userActivity.lastEventMentionedAt) {
      const hoursSince = (Date.now() - new Date(userActivity.lastEventMentionedAt).getTime()) / (60 * 60 * 1000);
      if (hoursSince < 24) {
        return false;
      }
    }

    // 70% chance to trigger
    if (Math.random() > 0.7) {
      return false;
    }

    return true;
  }

  /**
   * Get a single relevant event for response integration
   */
  async getEventForResponse(userId: string): Promise<MatchedEvent | null> {
    const shouldMention = await this.shouldMentionEvent(userId);
    if (!shouldMention) return null;

    const events = await this.findRelevantEventsForUser(userId, 1);
    return events.length > 0 ? events[0] : null;
  }
}
