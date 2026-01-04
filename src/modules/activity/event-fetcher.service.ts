import { NewsEvent, NewsSource } from '../../database/schemas/news-event.schema';
import { LLMService } from '../../shared/llm.service';

interface FetchedEvent {
  title: string;
  description?: string;
  source: NewsSource;
  url: string;
  tags: string[];
  publishedAt?: Date;
}

export class EventFetcherService {
  private llmService: LLMService | null = null;

  private getLLMService(): LLMService {
    if (!this.llmService) {
      this.llmService = new LLMService();
    }
    return this.llmService;
  }

  /**
   * Fetch events from all sources
   * Call this periodically (e.g., every 6 hours via cron)
   */
  async fetchAllEvents(): Promise<number> {
    console.log('📰 Fetching events from all sources...');

    try {
      const [hnEvents, techEvents] = await Promise.allSettled([
        this.fetchHackerNews(),
        this.fetchTechNews()
      ]);

      const allEvents: FetchedEvent[] = [
        ...(hnEvents.status === 'fulfilled' ? hnEvents.value : []),
        ...(techEvents.status === 'fulfilled' ? techEvents.value : [])
      ];

      // Save unique events
      let savedCount = 0;
      for (const event of allEvents) {
        try {
          const exists = await NewsEvent.findOne({ url: event.url });
          if (!exists) {
            await NewsEvent.create({
              ...event,
              fetchedAt: new Date(),
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            });
            savedCount++;
          }
        } catch (err) {
          // Ignore duplicate errors
        }
      }

      console.log(`✅ Saved ${savedCount} new events`);
      return savedCount;
    } catch (error) {
      console.error('Event fetching error:', error);
      return 0;
    }
  }

  /**
   * Fetch top stories from Hacker News
   */
  async fetchHackerNews(): Promise<FetchedEvent[]> {
    try {
      // Fetch top stories
      const topStoriesRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
      const topStoryIds = await topStoriesRes.json() as number[];

      // Get first 20 stories
      const storyPromises = topStoryIds.slice(0, 20).map(async (id) => {
        const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        return res.json() as Promise<{ title?: string; url?: string; time?: number } | null>;
      });

      const stories = await Promise.all(storyPromises);

      // Convert to our format and extract tags
      const events: FetchedEvent[] = [];

      for (const story of stories) {
        if (!story || !story.title || !story.url) continue;

        const tags = await this.extractTagsFromTitle(story.title);

        events.push({
          title: story.title,
          description: story.title,
          source: 'hackernews',
          url: story.url,
          tags,
          publishedAt: story.time ? new Date(story.time * 1000) : undefined
        });
      }

      return events;
    } catch (error) {
      console.error('HackerNews fetch error:', error);
      return [];
    }
  }

  /**
   * Fetch tech news from various RSS-like sources
   */
  async fetchTechNews(): Promise<FetchedEvent[]> {
    // For now, we'll use predefined interesting tech topics
    // In production, you'd fetch from RSS feeds
    const manualEvents: FetchedEvent[] = [
      {
        title: 'React 19 est sorti avec de nouvelles fonctionnalités',
        source: 'manual',
        url: 'https://react.dev/blog',
        tags: ['react', 'javascript', 'frontend', 'tech'],
        publishedAt: new Date()
      },
      {
        title: 'Swift 6 améliore la concurrence et les performances',
        source: 'manual',
        url: 'https://swift.org/blog',
        tags: ['swift', 'ios', 'apple', 'mobile', 'tech'],
        publishedAt: new Date()
      },
      {
        title: 'Expo SDK 52 simplifie le développement React Native',
        source: 'manual',
        url: 'https://expo.dev/changelog',
        tags: ['expo', 'react native', 'mobile', 'javascript', 'tech'],
        publishedAt: new Date()
      },
      {
        title: 'Les tendances fitness 2025: HIIT, récupération active',
        source: 'manual',
        url: 'https://www.healthline.com/fitness',
        tags: ['fitness', 'sports', 'santé', 'hiit'],
        publishedAt: new Date()
      },
      {
        title: 'Claude 4 Opus disponible avec de meilleures capacités de raisonnement',
        source: 'manual',
        url: 'https://www.anthropic.com',
        tags: ['ia', 'intelligence artificielle', 'llm', 'claude', 'tech'],
        publishedAt: new Date()
      },
      {
        title: 'MongoDB 8.0 améliore les performances et la sécurité',
        source: 'manual',
        url: 'https://www.mongodb.com/blog',
        tags: ['mongodb', 'database', 'nosql', 'backend', 'tech'],
        publishedAt: new Date()
      },
      {
        title: 'TypeScript 5.4 apporte de nouvelles fonctionnalités de typage',
        source: 'manual',
        url: 'https://www.typescriptlang.org/docs',
        tags: ['typescript', 'javascript', 'programming', 'tech'],
        publishedAt: new Date()
      },
      {
        title: 'Next.js 15 améliore les Server Components',
        source: 'manual',
        url: 'https://nextjs.org/blog',
        tags: ['nextjs', 'react', 'javascript', 'frontend', 'tech'],
        publishedAt: new Date()
      }
    ];

    return manualEvents;
  }

  /**
   * Extract relevant tags from a title using LLM
   */
  private async extractTagsFromTitle(title: string): Promise<string[]> {
    try {
      const prompt = `Extrait les tags/mots-clés pertinents de ce titre d'article.
Retourne UNIQUEMENT un tableau JSON de tags en minuscules, maximum 5 tags.

Titre: "${title}"

Réponds UNIQUEMENT avec un tableau JSON comme: ["tag1", "tag2"]`;

      const response = await this.getLLMService().generate(prompt, '');
      const jsonMatch = response.match(/\[[\s\S]*?\]/);

      if (jsonMatch) {
        const tags = JSON.parse(jsonMatch[0]) as string[];
        return tags.map(t => t.toLowerCase().trim()).slice(0, 5);
      }

      // Fallback: extract keywords manually
      return this.extractKeywordsManually(title);
    } catch {
      return this.extractKeywordsManually(title);
    }
  }

  /**
   * Simple keyword extraction fallback
   */
  private extractKeywordsManually(title: string): string[] {
    const techKeywords = [
      'react', 'javascript', 'typescript', 'python', 'rust', 'go', 'swift',
      'ios', 'android', 'mobile', 'web', 'frontend', 'backend', 'api',
      'database', 'mongodb', 'sql', 'ai', 'ml', 'llm', 'gpt', 'claude',
      'startup', 'tech', 'programming', 'developer', 'software'
    ];

    const titleLower = title.toLowerCase();
    const found: string[] = [];

    for (const keyword of techKeywords) {
      if (titleLower.includes(keyword)) {
        found.push(keyword);
      }
    }

    return found.slice(0, 5);
  }

  /**
   * Add a manual event
   */
  async addManualEvent(
    title: string,
    url: string,
    tags: string[],
    description?: string
  ): Promise<void> {
    await NewsEvent.create({
      title,
      description,
      source: 'manual',
      url,
      tags: tags.map(t => t.toLowerCase()),
      fetchedAt: new Date(),
      publishedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
  }

  /**
   * Clean up expired events
   */
  async cleanupExpiredEvents(): Promise<number> {
    const result = await NewsEvent.deleteMany({
      expiresAt: { $lt: new Date() }
    });
    return result.deletedCount;
  }

  /**
   * Get event statistics
   */
  async getEventStats() {
    const total = await NewsEvent.countDocuments();
    const bySource = await NewsEvent.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]);
    const recent = await NewsEvent.countDocuments({
      fetchedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    return {
      total,
      bySource: Object.fromEntries(bySource.map(s => [s._id, s.count])),
      last24h: recent
    };
  }
}
