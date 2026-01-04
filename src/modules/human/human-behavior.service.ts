import { Event } from '../../database/schemas/event.schema';
import { EmotionalProfile } from '../../database/schemas/emotional-profile.schema';
import { SemanticMemory } from '../../database/schemas/memory.schema';
import { Message } from '../../database/schemas/message.schema';
import { LLMService } from '../../shared/llm.service';

export interface MiraNote {
  type: 'silence' | 'deadline' | 'contradiction' | 'celebration' | 'follow_up' | 'emotion_check';
  priority: number; // 1-10
  message: string;
  context?: any;
}

export class HumanBehaviorService {
  private llmService = new LLMService();

  /**
   * Detect unusual silence - Mira notices when you haven't talked in a while
   */
  async detectUnusualSilence(userId: string): Promise<MiraNote | null> {
    const profile = await EmotionalProfile.findOne({ userId });
    if (!profile) return null;

    const daysSinceLastInteraction = Math.ceil(
      (Date.now() - profile.lastInteraction.getTime()) / (1000 * 60 * 60 * 24)
    );

    // If user normally talks daily but hasn't in 3+ days
    if (profile.averageMessageFrequency >= 0.5 && daysSinceLastInteraction >= 3) {
      return {
        type: 'silence',
        priority: 6,
        message: `Je ne t'avais pas entendu depuis ${daysSinceLastInteraction} jours, tout va bien ?`,
        context: { daysSince: daysSinceLastInteraction },
      };
    }

    return null;
  }

  /**
   * Track upcoming deadlines and events - Mira remembers what's coming
   */
  async getUpcomingEvents(userId: string): Promise<MiraNote[]> {
    const notes: MiraNote[] = [];
    const today = new Date();
    const in7Days = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    const upcomingEvents = await Event.find({
      userId,
      date: { $gte: today, $lte: in7Days },
      dateType: 'future',
      importance: { $gte: 6 },
    }).sort({ date: 1 });

    for (const event of upcomingEvents) {
      const daysUntil = Math.ceil(
        (event.date!.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      let message: string;
      if (daysUntil === 0) {
        message = `C'est aujourd'hui ${event.title} ! Comment tu te sens ?`;
      } else if (daysUntil === 1) {
        message = `${event.title} c'est demain ! Tu es prête ?`;
      } else {
        message = `${event.title} approche (dans ${daysUntil} jours). Comment ça va de ce côté ?`;
      }

      notes.push({
        type: 'deadline',
        priority: event.importance,
        message,
        context: { event, daysUntil },
      });
    }

    return notes;
  }

  /**
   * Detect contradictions in what user says vs what we know
   */
  async detectContradictions(
    userId: string,
    newStatement: string
  ): Promise<MiraNote | null> {
    // Get existing facts
    const existingFacts = await SemanticMemory.find({
      userId,
      category: { $in: ['personal', 'preferences', 'goals'] },
    })
      .sort({ mentionCount: -1 })
      .limit(20)
      .lean();

    if (existingFacts.length === 0) return null;

    const factsText = existingFacts.map((f) => f.fact).join('\n');

    const prompt = `Analyse si cette nouvelle affirmation contredit des faits connus.

FAITS CONNUS:
${factsText}

NOUVELLE AFFIRMATION:
"${newStatement}"

Si une contradiction existe, réponds en JSON:
{ "hasContradiction": true, "oldFact": "le fait contredit", "newFact": "la nouvelle affirmation", "question": "question naturelle pour clarifier" }

Si pas de contradiction:
{ "hasContradiction": false }`;

    try {
      const result = await this.llmService.extract(prompt);
      if (result && result.hasContradiction) {
        return {
          type: 'contradiction',
          priority: 7,
          message: result.question,
          context: { oldFact: result.oldFact, newFact: result.newFact },
        };
      }
    } catch (e) {
      console.error('Contradiction detection error:', e);
    }

    return null;
  }

  /**
   * Celebrate victories - Mira is happy when good things happen
   */
  async checkForVictories(userId: string): Promise<MiraNote[]> {
    const notes: MiraNote[] = [];

    // Find events that recently got a successful outcome
    const recentSuccesses = await Event.find({
      userId,
      outcome: 'success',
      importance: { $gte: 7 },
      updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24h
    });

    for (const event of recentSuccesses) {
      notes.push({
        type: 'celebration',
        priority: 9,
        message: this.generateCelebration(event.title, event.type),
        context: { event },
      });
    }

    return notes;
  }

  private generateCelebration(title: string, type: string): string {
    const celebrations: Record<string, string[]> = {
      job_interview: [
        `Tu as décroché le job ?! C'est génial, je suis tellement contente pour toi !`,
        `Oh wow, félicitations ! Tout ce stress, ça en valait la peine !`,
      ],
      exam: [
        `Tu as réussi ! Bravo, tu as travaillé tellement dur pour ça !`,
        `Génial ! Je savais que tu pouvais le faire !`,
      ],
      default: [
        `C'est super nouvelle pour ${title} ! Je suis vraiment contente !`,
        `Wow, ${title} s'est bien passé ! Félicitations !`,
      ],
    };

    const options = celebrations[type] || celebrations.default;
    return options[Math.floor(Math.random() * options.length)];
  }

  /**
   * Check for events needing follow-up
   */
  async getEventsNeedingFollowUp(userId: string): Promise<MiraNote[]> {
    const notes: MiraNote[] = [];

    // Past events without outcome that were important
    const pendingEvents = await Event.find({
      userId,
      dateType: 'past',
      outcome: null,
      followUpNeeded: true,
      importance: { $gte: 6 },
    })
      .sort({ date: -1 })
      .limit(3);

    for (const event of pendingEvents) {
      notes.push({
        type: 'follow_up',
        priority: event.importance - 1,
        message: `Au fait, comment s'est passé ${event.title} ?`,
        context: { event },
      });
    }

    return notes;
  }

  /**
   * Check emotional state compared to previous interactions
   */
  async checkEmotionalContext(
    userId: string,
    currentTopic: string,
    currentEmotion: string
  ): Promise<MiraNote | null> {
    // Find previous mentions of this topic
    const previousMessages = await Message.find({
      userId,
      role: 'user',
      content: { $regex: currentTopic, $options: 'i' },
      'metadata.sentiment': { $exists: true },
    })
      .sort({ createdAt: -1 })
      .limit(5);

    if (previousMessages.length < 2) return null;

    const previousEmotions = previousMessages.map((m) => (m as any).metadata?.sentiment);
    const lastEmotion = previousEmotions[1]; // Skip current (index 0)

    // If emotion changed significantly
    if (lastEmotion && lastEmotion !== currentEmotion) {
      const wasNegative = ['stressed', 'anxious', 'sad', 'frustrated'].includes(lastEmotion);
      const isNowPositive = ['happy', 'excited', 'relieved', 'calm'].includes(currentEmotion);

      if (wasNegative && isNowPositive) {
        return {
          type: 'emotion_check',
          priority: 5,
          message: `Tu as l'air d'aller mieux qu'avant à ce sujet, c'est cool !`,
          context: { previousEmotion: lastEmotion, currentEmotion },
        };
      } else if (!wasNegative && !isNowPositive) {
        return {
          type: 'emotion_check',
          priority: 6,
          message: `La dernière fois qu'on a parlé de ça, tu semblais plus serein. Quelque chose a changé ?`,
          context: { previousEmotion: lastEmotion, currentEmotion },
        };
      }
    }

    return null;
  }

  /**
   * Update emotional profile after interaction
   */
  async updateEmotionalProfile(
    userId: string,
    sentiment: string,
    topics: string[]
  ): Promise<void> {
    let profile = await EmotionalProfile.findOne({ userId });

    if (!profile) {
      profile = new EmotionalProfile({
        userId,
        baseline: 'neutral',
        triggers: [],
        copingMechanisms: [],
        averageMessageFrequency: 0,
        lastInteraction: new Date(),
        conversationStreak: 1,
        longestStreak: 1,
        totalConversations: 1,
        emotionHistory: [],
      });
    }

    // Update interaction stats
    const daysSinceLast = Math.ceil(
      (Date.now() - profile.lastInteraction.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceLast <= 1) {
      profile.conversationStreak += 1;
      if (profile.conversationStreak > profile.longestStreak) {
        profile.longestStreak = profile.conversationStreak;
      }
    } else {
      profile.conversationStreak = 1;
    }

    profile.lastInteraction = new Date();
    profile.totalConversations += 1;

    // Update average frequency (rolling average)
    const createdAtTime = profile.createdAt?.getTime() || Date.now();
    const accountAge = Math.max(
      1,
      Math.ceil((Date.now() - createdAtTime) / (1000 * 60 * 60 * 24))
    );
    profile.averageMessageFrequency = profile.totalConversations / accountAge;

    // Update emotion history (keep last 50)
    profile.emotionHistory.push({
      date: new Date(),
      dominantEmotion: sentiment,
      intensity: this.emotionToIntensity(sentiment),
    });
    if (profile.emotionHistory.length > 50) {
      profile.emotionHistory = profile.emotionHistory.slice(-50);
    }

    // Update triggers
    for (const topic of topics) {
      const existingTrigger = profile.triggers.find((t) => t.topic === topic);
      if (existingTrigger) {
        const emotions = existingTrigger.emotions as any;
        emotions.set(sentiment, (emotions.get(sentiment) || 0) + 0.1);
        existingTrigger.occurrences += 1;
      } else {
        profile.triggers.push({
          topic,
          emotions: { [sentiment]: 0.5 } as any,
          occurrences: 1,
        });
      }
    }

    // Keep triggers manageable
    if (profile.triggers.length > 20) {
      profile.triggers = profile.triggers
        .sort((a, b) => b.occurrences - a.occurrences)
        .slice(0, 20);
    }

    // Determine baseline from emotion history
    if (profile.emotionHistory.length >= 10) {
      const emotionCounts: Record<string, number> = {};
      profile.emotionHistory.slice(-10).forEach((e) => {
        emotionCounts[e.dominantEmotion] = (emotionCounts[e.dominantEmotion] || 0) + 1;
      });
      const dominant = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0];
      if (dominant) {
        profile.baseline = this.emotionToBaseline(dominant[0]);
      }
    }

    await profile.save();
  }

  private emotionToIntensity(emotion: string): number {
    const intensities: Record<string, number> = {
      happy: 7,
      excited: 9,
      calm: 4,
      neutral: 5,
      stressed: 7,
      anxious: 8,
      sad: 7,
      frustrated: 8,
      angry: 9,
      relieved: 6,
    };
    return intensities[emotion] || 5;
  }

  private emotionToBaseline(emotion: string): string {
    const positiveEmotions = ['happy', 'excited', 'calm', 'relieved'];
    const negativeEmotions = ['stressed', 'anxious', 'sad', 'frustrated', 'angry'];

    if (positiveEmotions.includes(emotion)) return 'optimistic';
    if (negativeEmotions.includes(emotion)) return 'anxious';
    return 'neutral';
  }

  /**
   * Get all active notes for this interaction
   */
  async getAllNotes(userId: string): Promise<MiraNote[]> {
    const [silence, upcoming, followUp, victories] = await Promise.all([
      this.detectUnusualSilence(userId),
      this.getUpcomingEvents(userId),
      this.getEventsNeedingFollowUp(userId),
      this.checkForVictories(userId),
    ]);

    const notes: MiraNote[] = [
      ...(silence ? [silence] : []),
      ...upcoming,
      ...followUp,
      ...victories,
    ];

    // Sort by priority
    return notes.sort((a, b) => b.priority - a.priority);
  }
}
