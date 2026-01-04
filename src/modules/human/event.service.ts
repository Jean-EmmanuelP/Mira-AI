import { Event, IEvent } from '../../database/schemas/event.schema';
import { LLMService } from '../../shared/llm.service';
import { EmbeddingService } from '../../shared/embedding.service';

interface ExtractedEvent {
  type: string;
  title: string;
  description?: string;
  date?: string;
  dateType: 'past' | 'future' | 'ongoing' | 'unknown';
  emotion?: string;
  emotionIntensity?: number;
  importance: number;
  relatedEntities: string[];
}

export class EventService {
  private llmService = new LLMService();
  private embeddingService = new EmbeddingService();

  /**
   * Extract events from a message
   */
  async extractEvents(
    userId: string,
    content: string,
    existingEvents: IEvent[]
  ): Promise<ExtractedEvent[]> {
    const existingEventsText =
      existingEvents.length > 0
        ? existingEvents.map((e) => `- ${e.title} (${e.type})`).join('\n')
        : 'Aucun événement connu';

    const today = new Date().toISOString().split('T')[0];

    const prompt = `Analyse ce message et extrais les ÉVÉNEMENTS mentionnés (passés, présents ou futurs).

Date d'aujourd'hui: ${today}

ÉVÉNEMENTS DÉJÀ CONNUS:
${existingEventsText}

MESSAGE:
"${content}"

Pour chaque événement, détermine:
- type: job_interview, exam, trip, deadline, birthday, meeting, medical, sports_event, date, other
- title: description courte de l'événement
- description: détails additionnels (optionnel)
- date: au format YYYY-MM-DD si mentionnée (sinon null)
- dateType: "past" si c'est arrivé, "future" si à venir, "ongoing" si en cours, "unknown" si pas clair
- emotion: l'émotion associée (stressed, excited, anxious, happy, sad, etc.)
- emotionIntensity: 1-10
- importance: 1-10 (job interview = 8-9, petit rendez-vous = 3-4)
- relatedEntities: personnes/lieux/choses mentionnés

IMPORTANT:
- Si l'événement existe déjà, indique-le avec "existingEventTitle" pour qu'on le mette à jour
- Extrais même les événements implicites ("mon entretien s'est bien passé" → entretien, passé, succès)

Réponds UNIQUEMENT en JSON:
{
  "events": [
    { "type": "...", "title": "...", ... },
    ...
  ],
  "eventUpdates": [
    { "existingEventTitle": "...", "updates": { "outcome": "success", ... } }
  ]
}`;

    try {
      const result = await this.llmService.extract(prompt);

      if (result && result.events) {
        return result.events.map((e: any) => ({
          type: e.type || 'other',
          title: e.title,
          description: e.description,
          date: e.date,
          dateType: e.dateType || 'unknown',
          emotion: e.emotion,
          emotionIntensity: e.emotionIntensity,
          importance: e.importance || 5,
          relatedEntities: e.relatedEntities || [],
        }));
      }
    } catch (e) {
      console.error('Event extraction error:', e);
    }

    return [];
  }

  /**
   * Store or update events
   */
  async processEvents(userId: string, content: string): Promise<void> {
    // Get existing events
    const existingEvents = await Event.find({ userId }).limit(20).lean();

    // Extract new events
    const extracted = await this.extractEvents(userId, content, existingEvents as IEvent[]);

    for (const event of extracted) {
      // Check if similar event exists
      const existingEvent = await this.findSimilarEvent(userId, event.title);

      if (existingEvent) {
        // Update existing event
        await Event.updateOne(
          { _id: existingEvent._id },
          {
            $set: {
              emotion: event.emotion || existingEvent.emotion,
              emotionIntensity: event.emotionIntensity || existingEvent.emotionIntensity,
              dateType: event.dateType,
              lastMentioned: new Date(),
            },
            $inc: { mentionCount: 1 },
          }
        );
        console.log(`🔄 Updated event: ${existingEvent.title}`);
      } else {
        // Create new event
        let eventDate: Date | undefined;
        if (event.date) {
          eventDate = new Date(event.date);
        }

        await Event.create({
          userId,
          type: event.type,
          title: event.title,
          description: event.description,
          date: eventDate,
          dateType: event.dateType,
          emotion: event.emotion,
          emotionIntensity: event.emotionIntensity,
          importance: event.importance,
          relatedEntities: event.relatedEntities,
          followUpNeeded: event.importance >= 6,
          lastMentioned: new Date(),
          mentionCount: 1,
        });
        console.log(`✅ New event created: ${event.title}`);
      }
    }
  }

  /**
   * Update event outcome
   */
  async updateEventOutcome(
    userId: string,
    eventTitle: string,
    outcome: 'success' | 'failure' | 'partial' | 'cancelled'
  ): Promise<void> {
    const event = await this.findSimilarEvent(userId, eventTitle);
    if (event) {
      await Event.updateOne(
        { _id: event._id },
        {
          $set: {
            outcome,
            dateType: 'past',
            followUpNeeded: false,
            lastMentioned: new Date(),
          },
        }
      );
      console.log(`🎯 Event outcome updated: ${eventTitle} → ${outcome}`);
    }
  }

  /**
   * Find similar event using embedding similarity
   */
  private async findSimilarEvent(
    userId: string,
    title: string
  ): Promise<IEvent | null> {
    const events = await Event.find({ userId }).lean();
    if (events.length === 0) return null;

    // Simple fuzzy matching for now
    const normalizedTitle = title.toLowerCase();

    for (const event of events) {
      const normalizedEventTitle = event.title.toLowerCase();

      // Direct match
      if (normalizedEventTitle.includes(normalizedTitle) ||
          normalizedTitle.includes(normalizedEventTitle)) {
        return event as IEvent;
      }

      // Key words match
      const titleWords = normalizedTitle.split(' ').filter(w => w.length > 3);
      const eventWords = normalizedEventTitle.split(' ').filter(w => w.length > 3);
      const matches = titleWords.filter(w => eventWords.includes(w));

      if (matches.length >= 2 || (matches.length >= 1 && titleWords.length <= 3)) {
        return event as IEvent;
      }
    }

    return null;
  }

  /**
   * Get events for context
   */
  async getRelevantEvents(userId: string, limit: number = 5): Promise<IEvent[]> {
    const now = new Date();

    // Get upcoming events and recent past events
    const upcoming = await Event.find({
      userId,
      dateType: 'future',
      date: { $gte: now },
    })
      .sort({ date: 1 })
      .limit(3)
      .lean();

    const recentPast = await Event.find({
      userId,
      dateType: 'past',
      importance: { $gte: 6 },
    })
      .sort({ lastMentioned: -1 })
      .limit(3)
      .lean();

    const pending = await Event.find({
      userId,
      outcome: null,
      followUpNeeded: true,
    })
      .sort({ importance: -1 })
      .limit(2)
      .lean();

    const combined = [...upcoming, ...recentPast, ...pending];

    // Deduplicate
    const seen = new Set<string>();
    return combined.filter((e) => {
      const key = e._id.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit) as IEvent[];
  }
}
