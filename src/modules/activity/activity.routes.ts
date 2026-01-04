import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ActivityExtractionService } from './activity-extraction.service';
import { EventMatchingService } from './event-matching.service';
import { EventFetcherService } from './event-fetcher.service';

let activityService: ActivityExtractionService | null = null;
let eventMatchingService: EventMatchingService | null = null;
let eventFetcherService: EventFetcherService | null = null;

function getActivityService(): ActivityExtractionService {
  if (!activityService) {
    activityService = new ActivityExtractionService();
  }
  return activityService;
}

function getEventMatchingService(): EventMatchingService {
  if (!eventMatchingService) {
    eventMatchingService = new EventMatchingService();
  }
  return eventMatchingService;
}

function getEventFetcherService(): EventFetcherService {
  if (!eventFetcherService) {
    eventFetcherService = new EventFetcherService();
  }
  return eventFetcherService;
}

export async function activityRoutes(app: FastifyInstance) {
  // Get user's activities/interests
  app.get('/profile/:userId', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = req.params as { userId: string };
      const profile = await getActivityService().getUserActivityProfile(userId);

      if (!profile) {
        return {
          success: true,
          activities: [],
          profileCompleteness: 0
        };
      }

      return {
        success: true,
        activities: profile.activities,
        profileCompleteness: profile.profileCompleteness,
        lastExtracted: profile.lastActivityExtractedAt,
        eventsMentioned: profile.eventsMentionedCount
      };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to get activity profile' });
    }
  });

  // Get top activities for a user
  app.get('/top/:userId', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = req.params as { userId: string };
      const { limit } = req.query as { limit?: string };

      const activities = await getActivityService().getTopActivities(
        userId,
        limit ? parseInt(limit) : 10
      );

      return {
        success: true,
        activities
      };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to get top activities' });
    }
  });

  // Get relevant events for a user
  app.get('/events/:userId', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = req.params as { userId: string };
      const { limit } = req.query as { limit?: string };

      const events = await getEventMatchingService().findRelevantEventsForUser(
        userId,
        limit ? parseInt(limit) : 5
      );

      return {
        success: true,
        events: events.map(e => ({
          title: e.title,
          description: e.description,
          url: e.url,
          source: e.source,
          tags: e.tags,
          relevanceScore: e.relevanceScore
        }))
      };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to get relevant events' });
    }
  });

  // Fetch new events from sources (admin/cron endpoint)
  app.post('/events/fetch', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const count = await getEventFetcherService().fetchAllEvents();
      return {
        success: true,
        message: `Fetched ${count} new events`
      };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to fetch events' });
    }
  });

  // Get event statistics
  app.get('/events/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await getEventFetcherService().getEventStats();
      return {
        success: true,
        ...stats
      };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to get event stats' });
    }
  });

  // Add a manual event
  app.post('/events/add', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { title, url, tags, description } = req.body as {
        title: string;
        url: string;
        tags: string[];
        description?: string;
      };

      if (!title || !url || !tags) {
        return reply.status(400).send({ error: 'title, url, and tags are required' });
      }

      await getEventFetcherService().addManualEvent(title, url, tags, description);

      return {
        success: true,
        message: 'Event added successfully'
      };
    } catch (error) {
      return reply.status(500).send({ error: 'Failed to add event' });
    }
  });
}
