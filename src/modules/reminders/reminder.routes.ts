import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { notificationService } from './notification.service';
import { reminderService } from './reminder.service';

export async function reminderRoutes(app: FastifyInstance) {
  /**
   * Get due notifications for a user
   * These are reminders that should be shown NOW
   */
  app.get('/notifications', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = req.query as { userId: string };
      if (!userId) {
        return reply.status(400).send({ error: 'userId required' });
      }

      const notifications = await notificationService.getDueNotifications(userId);

      return {
        success: true,
        count: notifications.length,
        notifications,
      };
    } catch (error) {
      console.error('Get notifications error:', error);
      return reply.status(500).send({ error: 'Failed to get notifications' });
    }
  });

  /**
   * Get upcoming reminders (scheduled for future)
   */
  app.get('/upcoming', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId, limit = '5' } = req.query as { userId: string; limit?: string };
      if (!userId) {
        return reply.status(400).send({ error: 'userId required' });
      }

      const reminders = await notificationService.getUpcoming(userId, parseInt(limit));

      return {
        success: true,
        count: reminders.length,
        reminders: reminders.map(r => ({
          id: r._id,
          type: r.type,
          title: r.title,
          scheduledFor: r.scheduledFor,
          priority: r.priority,
          metadata: r.metadata,
        })),
      };
    } catch (error) {
      console.error('Get upcoming error:', error);
      return reply.status(500).send({ error: 'Failed to get upcoming reminders' });
    }
  });

  /**
   * Get notification stats for a user
   */
  app.get('/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId } = req.query as { userId: string };
      if (!userId) {
        return reply.status(400).send({ error: 'userId required' });
      }

      const stats = await notificationService.getStats(userId);

      return {
        success: true,
        stats,
      };
    } catch (error) {
      console.error('Get stats error:', error);
      return reply.status(500).send({ error: 'Failed to get stats' });
    }
  });

  /**
   * Mark a notification as sent
   */
  app.post('/notifications/:id/sent', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = req.params as { id: string };
      await notificationService.markAsSent(id);
      return { success: true };
    } catch (error) {
      console.error('Mark sent error:', error);
      return reply.status(500).send({ error: 'Failed to mark as sent' });
    }
  });

  /**
   * Dismiss a notification
   */
  app.post('/notifications/:id/dismiss', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = req.params as { id: string };
      await notificationService.dismiss(id);
      return { success: true };
    } catch (error) {
      console.error('Dismiss error:', error);
      return reply.status(500).send({ error: 'Failed to dismiss' });
    }
  });

  /**
   * Snooze a notification
   */
  app.post('/notifications/:id/snooze', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = req.params as { id: string };
      const { hours = 2 } = req.body as { hours?: number };
      await notificationService.snooze(id, hours);
      return { success: true, snoozedUntil: new Date(Date.now() + hours * 60 * 60 * 1000) };
    } catch (error) {
      console.error('Snooze error:', error);
      return reply.status(500).send({ error: 'Failed to snooze' });
    }
  });

  /**
   * Manually trigger event detection on a message (for testing)
   */
  app.post('/detect', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { userId, message } = req.body as { userId: string; message: string };
      if (!userId || !message) {
        return reply.status(400).send({ error: 'userId and message required' });
      }

      await reminderService.processMessage(userId, message);

      // Return what was created
      const pending = await reminderService.getPendingReminders(userId);

      return {
        success: true,
        message: 'Event detection completed',
        remindersCreated: pending.length,
        reminders: pending.map(r => ({
          id: r._id,
          type: r.type,
          title: r.title,
          scheduledFor: r.scheduledFor,
        })),
      };
    } catch (error) {
      console.error('Detect error:', error);
      return reply.status(500).send({ error: 'Failed to detect events' });
    }
  });
}
