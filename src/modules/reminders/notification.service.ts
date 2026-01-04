import { Reminder, IReminder } from '../../database/schemas/reminder.schema';
import { Message } from '../../database/schemas/message.schema';
import { LLMService } from '../../shared/llm.service';
import { timeService } from '../../shared/time.service';
import { reminderService } from './reminder.service';

export interface Notification {
  id: string;
  userId: string;
  message: string;
  type: IReminder['type'];
  priority: IReminder['priority'];
  eventTitle: string;
  scheduledFor: Date;
  metadata?: IReminder['metadata'];
}

export class NotificationService {
  private llmService: LLMService | null = null;

  private getLLMService(): LLMService {
    if (!this.llmService) {
      this.llmService = new LLMService();
    }
    return this.llmService;
  }

  /**
   * Get all due notifications for a user (or all users if no userId)
   */
  async getDueNotifications(userId?: string): Promise<Notification[]> {
    const now = new Date();

    const query: any = {
      status: 'pending',
      scheduledFor: { $lte: now },
    };

    if (userId) {
      query.userId = userId;
    }

    const dueReminders = await Reminder.find(query).sort({ scheduledFor: 1 });

    const notifications: Notification[] = [];

    for (const reminder of dueReminders) {
      const message = await this.generateNotificationMessage(reminder);
      notifications.push({
        id: reminder._id.toString(),
        userId: reminder.userId,
        message,
        type: reminder.type,
        priority: reminder.priority,
        eventTitle: reminder.title,
        scheduledFor: reminder.scheduledFor,
        metadata: reminder.metadata,
      });
    }

    return notifications;
  }

  /**
   * Generate a personalized notification message using LLM
   */
  private async generateNotificationMessage(reminder: IReminder): Promise<string> {
    // If already generated, return cached
    if (reminder.generatedMessage) {
      return reminder.generatedMessage;
    }

    const timeCtx = timeService.getTimeContext();

    // Get recent conversation context
    const recentMessages = await Message.find({ userId: reminder.userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const conversationContext = recentMessages
      .reverse()
      .map(m => `${m.role === 'user' ? 'User' : 'Mira'}: ${m.content}`)
      .join('\n');

    let promptType = '';
    let examples = '';

    if (reminder.type === 'event_before') {
      promptType = `This is a BEFORE reminder - the event "${reminder.title}" is coming up soon (${reminder.metadata?.originalDate?.toLocaleDateString('fr-FR')}).
You want to wish them luck, show you remember, and maybe calm any nerves.`;
      examples = `Examples:
- "Hey ! Ton entretien chez Google c'est demain, non ? Tu te sens comment ?"
- "Bonne chance pour demain ! Tu vas gérer"
- "J'espère que t'es prêt(e) pour ton truc demain ! Tu veux en parler ?"`;
    } else if (reminder.type === 'event_after') {
      promptType = `This is an AFTER reminder - the event "${reminder.title}" should have happened (${reminder.metadata?.originalDate?.toLocaleDateString('fr-FR')}).
You want to ask how it went, show genuine interest, and be supportive.`;
      examples = `Examples:
- "Alors, ça s'est passé comment ton entretien chez Google ?"
- "Hey ! Comment c'était finalement ?"
- "Tu me racontes ? J'ai pensé à toi !"`;
    } else if (reminder.type === 'goal_checkin') {
      promptType = `This is a goal check-in for "${reminder.title}".
You want to casually ask about their progress without being pushy.`;
      examples = `Examples:
- "Au fait, t'en es où avec ton marathon ?"
- "Tu continues à t'entraîner ?"`;
    }

    const prompt = `Tu es Mira, une amie virtuelle authentique.
Tu dois générer UN message de rappel naturel et personnel.

${promptType}

CONTEXTE ORIGINAL: "${reminder.context}"
HEURE ACTUELLE: ${timeCtx.formattedTime} (${timeCtx.periodFr}), ${timeCtx.dayOfWeekFr}
${reminder.metadata?.emotion ? `EMOTION DÉTECTÉE: ${reminder.metadata.emotion}` : ''}
${reminder.metadata?.entities?.length ? `PERSONNES/LIEUX: ${reminder.metadata.entities.join(', ')}` : ''}

${conversationContext ? `DERNIÈRE CONVERSATION:\n${conversationContext}` : ''}

${examples}

RÈGLES:
- 1-2 phrases max
- Naturel, comme un texto d'ami(e)
- Montre que tu te souviens des détails
- Utilise l'heure actuelle si pertinent (matin, soir, etc.)
- JAMAIS formel ou robotique
- Émojis ok mais pas obligatoire

Génère UNIQUEMENT le message, sans guillemets ni explication.`;

    try {
      const message = await this.getLLMService().generate(prompt, '');
      const cleanMessage = message.trim();

      // Cache the generated message
      await Reminder.findByIdAndUpdate(reminder._id, {
        generatedMessage: cleanMessage,
      });

      return cleanMessage;
    } catch (error) {
      console.error('Notification message generation error:', error);
      // Fallback messages
      if (reminder.type === 'event_before') {
        return `Hey ! Bonne chance pour ${reminder.title} demain !`;
      } else if (reminder.type === 'event_after') {
        return `Alors, ça s'est passé comment ${reminder.title} ?`;
      }
      return `Hey ! Je pensais à toi`;
    }
  }

  /**
   * Mark a notification as sent
   */
  async markAsSent(notificationId: string): Promise<void> {
    await reminderService.markAsSent(notificationId);
  }

  /**
   * Dismiss a notification
   */
  async dismiss(notificationId: string): Promise<void> {
    await reminderService.dismissReminder(notificationId);
  }

  /**
   * Snooze a notification
   */
  async snooze(notificationId: string, hours: number = 2): Promise<void> {
    await reminderService.snoozeReminder(notificationId, hours);
  }

  /**
   * Get upcoming reminders (not yet due) for a user
   */
  async getUpcoming(userId: string, limit: number = 5): Promise<IReminder[]> {
    const now = new Date();
    return Reminder.find({
      userId,
      status: 'pending',
      scheduledFor: { $gt: now },
    })
      .sort({ scheduledFor: 1 })
      .limit(limit);
  }

  /**
   * Get notification stats for a user
   */
  async getStats(userId: string): Promise<{
    pending: number;
    upcoming: number;
    sentLast7Days: number;
  }> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [pending, upcoming, sentLast7Days] = await Promise.all([
      Reminder.countDocuments({ userId, status: 'pending', scheduledFor: { $lte: now } }),
      Reminder.countDocuments({ userId, status: 'pending', scheduledFor: { $gt: now } }),
      Reminder.countDocuments({ userId, status: 'sent', sentAt: { $gte: sevenDaysAgo } }),
    ]);

    return { pending, upcoming, sentLast7Days };
  }
}

// Singleton
export const notificationService = new NotificationService();
