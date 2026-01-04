import { Reminder, IReminder } from '../../database/schemas/reminder.schema';
import { Event } from '../../database/schemas/event.schema';
import { LLMService } from '../../shared/llm.service';
import { timeService } from '../../shared/time.service';

interface DetectedEvent {
  type: string;
  title: string;
  date: Date | null;
  dateType: 'past' | 'future' | 'ongoing' | 'unknown';
  entities: string[];
  emotion?: string;
  importance: number;
}

export class ReminderService {
  private llmService: LLMService | null = null;

  private getLLMService(): LLMService {
    if (!this.llmService) {
      this.llmService = new LLMService();
    }
    return this.llmService;
  }

  /**
   * Detect events with dates from user message and create appropriate reminders
   */
  async processMessage(userId: string, message: string): Promise<void> {
    try {
      const events = await this.detectEvents(message);

      for (const event of events) {
        // Only create reminders for future events
        if (event.date && event.dateType === 'future') {
          await this.createEventReminders(userId, event, message);
        }

        // Store the event for context
        await this.storeEvent(userId, event, message);
      }
    } catch (error) {
      console.error('ReminderService processMessage error:', error);
    }
  }

  /**
   * Use LLM to detect events with dates from message
   */
  private async detectEvents(message: string): Promise<DetectedEvent[]> {
    const now = new Date();
    const prompt = `Analyze this message and extract any events or appointments mentioned.
Current date/time: ${now.toISOString()}

Message: "${message}"

For each event found, return:
- type: category (job_interview, trip, deadline, birthday, meeting, medical, exam, date, party, sports_event, other)
- title: short description (e.g., "Job interview at Google", "Trip to Paris")
- date: ISO date string if mentioned (parse "tomorrow", "next week", "le 15 janvier", etc.)
- dateType: "past", "future", "ongoing", or "unknown"
- entities: array of people, places, companies mentioned
- emotion: how they seem to feel about it (excited, nervous, stressed, happy, neutral)
- importance: 1-10 scale

Return JSON array. If no events found, return empty array [].

Examples:
- "J'ai un entretien chez Google demain" → [{type: "job_interview", title: "Entretien chez Google", date: "2026-01-06T09:00:00Z", dateType: "future", entities: ["Google"], emotion: "nervous", importance: 9}]
- "Je pars en vacances la semaine prochaine" → [{type: "trip", title: "Vacances", date: "2026-01-12T00:00:00Z", dateType: "future", entities: [], emotion: "excited", importance: 7}]
- "Mon chien Max a 3 ans aujourd'hui" → [{type: "birthday", title: "Anniversaire de Max", date: "${now.toISOString()}", dateType: "ongoing", entities: ["Max"], emotion: "happy", importance: 6}]`;

    try {
      const result = await this.getLLMService().extract(prompt);
      if (!Array.isArray(result)) return [];

      return result.map(e => ({
        type: e.type || 'other',
        title: e.title || 'Event',
        date: e.date ? new Date(e.date) : null,
        dateType: e.dateType || 'unknown',
        entities: e.entities || [],
        emotion: e.emotion,
        importance: e.importance || 5,
      }));
    } catch (error) {
      console.error('Event detection error:', error);
      return [];
    }
  }

  /**
   * Create before and after reminders for a future event
   */
  private async createEventReminders(
    userId: string,
    event: DetectedEvent,
    originalMessage: string
  ): Promise<void> {
    if (!event.date) return;

    const eventDate = new Date(event.date);
    const now = new Date();

    // Don't create reminders for events more than 30 days away
    const daysUntil = (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysUntil > 30) {
      console.log(`⏭️ Event too far away (${Math.round(daysUntil)} days), skipping reminders`);
      return;
    }

    // Check for duplicate reminders
    const existingReminder = await Reminder.findOne({
      userId,
      title: event.title,
      status: 'pending',
      'metadata.originalDate': eventDate,
    });

    if (existingReminder) {
      console.log(`⏭️ Reminder already exists for: ${event.title}`);
      return;
    }

    // Calculate reminder times
    const reminders: { type: IReminder['type']; scheduledFor: Date; priority: IReminder['priority'] }[] = [];

    // BEFORE reminder: morning of the event day or evening before
    if (daysUntil >= 1) {
      // Evening before (7pm)
      const eveningBefore = new Date(eventDate);
      eveningBefore.setDate(eveningBefore.getDate() - 1);
      eveningBefore.setHours(19, 0, 0, 0);

      if (eveningBefore > now) {
        reminders.push({
          type: 'event_before',
          scheduledFor: eveningBefore,
          priority: event.importance >= 8 ? 'high' : 'medium',
        });
      }
    } else if (daysUntil > 0) {
      // Same day but event is later - remind 2 hours before
      const twoHoursBefore = new Date(eventDate.getTime() - 2 * 60 * 60 * 1000);
      if (twoHoursBefore > now) {
        reminders.push({
          type: 'event_before',
          scheduledFor: twoHoursBefore,
          priority: 'high',
        });
      }
    }

    // AFTER reminder: evening of event day or next morning
    const eveningAfter = new Date(eventDate);
    eveningAfter.setHours(20, 0, 0, 0);

    if (eveningAfter <= eventDate) {
      // If event is in the evening, remind next morning
      eveningAfter.setDate(eveningAfter.getDate() + 1);
      eveningAfter.setHours(10, 0, 0, 0);
    }

    reminders.push({
      type: 'event_after',
      scheduledFor: eveningAfter,
      priority: event.importance >= 7 ? 'high' : 'medium',
    });

    // Create the reminders
    for (const reminder of reminders) {
      await Reminder.create({
        userId,
        type: reminder.type,
        title: event.title,
        context: originalMessage,
        scheduledFor: reminder.scheduledFor,
        priority: reminder.priority,
        status: 'pending',
        metadata: {
          eventType: event.type,
          entities: event.entities,
          originalDate: eventDate,
          emotion: event.emotion,
        },
      });

      console.log(
        `📅 Created ${reminder.type} reminder for "${event.title}" at ${reminder.scheduledFor.toISOString()}`
      );
    }
  }

  /**
   * Store event in database for context
   */
  private async storeEvent(userId: string, event: DetectedEvent, originalMessage: string): Promise<void> {
    // Check if similar event exists
    const existing = await Event.findOne({
      userId,
      title: { $regex: new RegExp(event.title.substring(0, 20), 'i') },
      type: event.type,
    });

    if (existing) {
      // Update existing event
      existing.lastMentioned = new Date();
      existing.mentionCount += 1;
      if (event.date) existing.date = event.date;
      if (event.emotion) existing.emotion = event.emotion;
      await existing.save();
    } else {
      // Create new event
      await Event.create({
        userId,
        type: event.type,
        title: event.title,
        description: originalMessage,
        date: event.date || undefined,
        dateType: event.dateType,
        emotion: event.emotion,
        importance: event.importance,
        relatedEntities: event.entities,
        followUpNeeded: event.dateType === 'future',
      });

      console.log(`📌 Stored event: ${event.title} (${event.type})`);
    }
  }

  /**
   * Get all pending reminders for a user
   */
  async getPendingReminders(userId: string): Promise<IReminder[]> {
    return Reminder.find({
      userId,
      status: 'pending',
    }).sort({ scheduledFor: 1 });
  }

  /**
   * Mark a reminder as sent
   */
  async markAsSent(reminderId: string): Promise<void> {
    await Reminder.findByIdAndUpdate(reminderId, {
      status: 'sent',
      sentAt: new Date(),
    });
  }

  /**
   * Dismiss a reminder
   */
  async dismissReminder(reminderId: string): Promise<void> {
    await Reminder.findByIdAndUpdate(reminderId, {
      status: 'dismissed',
    });
  }

  /**
   * Snooze a reminder (reschedule for later)
   */
  async snoozeReminder(reminderId: string, hours: number = 2): Promise<void> {
    const newTime = new Date(Date.now() + hours * 60 * 60 * 1000);
    await Reminder.findByIdAndUpdate(reminderId, {
      status: 'pending',
      scheduledFor: newTime,
    });
  }
}

// Singleton
export const reminderService = new ReminderService();
