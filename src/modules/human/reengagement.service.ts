import { Message } from '../../database/schemas/message.schema';
import { Goal } from '../../database/schemas/goal.schema';
import { Event } from '../../database/schemas/event.schema';
import { EmotionalProfile } from '../../database/schemas/emotional-profile.schema';
import { SemanticMemory } from '../../database/schemas/memory.schema';

export type ReengagementType =
  | 'seen_no_reply'      // Tu m'as laissé en vu!
  | 'goal_reminder'      // Rappel d'objectif
  | 'check_in'           // Prendre des nouvelles
  | 'event_followup'     // Suivi d'événement passé
  | 'celebration'        // Célébrer quelque chose
  | 'miss_you'           // Tu m'as manqué
  | null;

export interface ReengagementMessage {
  type: ReengagementType;
  message: string;
  context?: any;
}

export class ReengagementService {

  // Minimum hours before triggering re-engagement
  private readonly MIN_HOURS_AWAY = 2; // Reduced from 24h to 2h for more natural check-ins

  // Probability of triggering (not every time)
  private readonly TRIGGER_PROBABILITY = 0.8; // 80% - increased for more engagement

  /**
   * Check if user should receive a re-engagement message
   * Called when user returns to chat
   */
  async checkReengagement(userId: string): Promise<ReengagementMessage | null> {
    // Get last messages
    const lastMessages = await Message.find({ userId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    if (lastMessages.length === 0) {
      return null; // New user, no re-engagement needed
    }

    // Calculate time since last interaction
    const lastMessage = lastMessages[0];
    const hoursSince = (Date.now() - new Date(lastMessage.createdAt).getTime()) / (1000 * 60 * 60);

    // Not enough time passed
    if (hoursSince < this.MIN_HOURS_AWAY) {
      return null;
    }

    // Random check - don't trigger every time
    if (Math.random() > this.TRIGGER_PROBABILITY) {
      return null;
    }

    // Determine the best type of re-engagement
    const daysSince = Math.floor(hoursSince / 24);

    // Check various conditions and pick a strategy
    const strategies = await this.evaluateStrategies(userId, lastMessages, daysSince);

    if (strategies.length === 0) {
      return null;
    }

    // Pick a random strategy from available ones
    const strategy = strategies[Math.floor(Math.random() * strategies.length)];

    return this.generateMessage(userId, strategy, daysSince);
  }

  /**
   * Evaluate which re-engagement strategies are applicable
   */
  private async evaluateStrategies(
    userId: string,
    lastMessages: any[],
    daysSince: number
  ): Promise<ReengagementType[]> {
    const strategies: ReengagementType[] = [];

    // Check if last message was from Mira (user didn't reply)
    if (lastMessages.length > 0 && lastMessages[0].role === 'assistant') {
      // Mira sent last message - user left on "seen"
      strategies.push('seen_no_reply');
    }

    // Check for active goals - available even for short absences
    const activeGoals = await Goal.find({ userId, status: 'active' }).limit(3).lean();
    if (activeGoals.length > 0) {
      strategies.push('goal_reminder');
    }

    // Check for past events needing follow-up
    const pastEvents = await Event.find({
      userId,
      dateType: 'past',
      outcome: null,
      importance: { $gte: 6 },
      date: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
    }).limit(2).lean();

    if (pastEvents.length > 0) {
      strategies.push('event_followup');
    }

    // Check-in is available for absences of 1+ days
    if (daysSince >= 1) {
      strategies.push('check_in');
    }

    // Miss you for longer absences (3+ days)
    if (daysSince >= 3) {
      strategies.push('miss_you');
    }

    return strategies;
  }

  /**
   * Generate the actual re-engagement message
   */
  private async generateMessage(
    userId: string,
    type: ReengagementType,
    daysSince: number
  ): Promise<ReengagementMessage> {
    switch (type) {
      case 'seen_no_reply':
        return this.generateSeenNoReply(userId, daysSince);

      case 'goal_reminder':
        return this.generateGoalReminder(userId, daysSince);

      case 'event_followup':
        return this.generateEventFollowup(userId);

      case 'check_in':
        return this.generateCheckIn(userId, daysSince);

      case 'miss_you':
        return this.generateMissYou(userId, daysSince);

      default:
        return { type: null, message: '' };
    }
  }

  private async generateSeenNoReply(userId: string, daysSince: number): Promise<ReengagementMessage> {
    // Get the last assistant message
    const lastMiraMessage = await Message.findOne({ userId, role: 'assistant' })
      .sort({ createdAt: -1 })
      .lean();

    let messages: string[];

    if (daysSince === 0) {
      // Same day - playful
      messages = [
        `Tiens, te revoilà ! Tu t'étais fait kidnapper ? 😄`,
        `Ah ! Tu m'avais laissée en plan là...`,
        `De retour ! Je commençais à me demander si t'allais répondre.`,
      ];
    } else if (daysSince === 1) {
      // Yesterday
      messages = [
        `Hé ! Tu m'as laissée en vu hier... T'as oublié de répondre ou bien ?`,
        `Dis donc, une nuit sans réponse ! T'étais occupé(e) ?`,
        `Te revoilà ! Tu m'avais laissé en vu depuis hier 😅`,
      ];
    } else {
      // Multiple days
      messages = [
        `Hé ! Tu m'as laissée en vu pendant ${daysSince} jours là... 😅 T'as oublié de répondre ou bien ?`,
        `Dis donc, ${daysSince} jours sans réponse ! Je commençais à croire que t'avais disparu ahah.`,
        `Bon alors, tu me réponds ou je dois envoyer une équipe de recherche ? 😄 Ça fait ${daysSince} jours quand même !`,
        `Hellooo ? Y'a quelqu'un ? Ça fait ${daysSince} jours que j'attends ta réponse là...`,
      ];

      if (daysSince >= 7) {
        messages.push(`Une semaine sans nouvelles ! J'espère que tout va bien de ton côté ?`);
        messages.push(`Ça fait ${daysSince} jours là... Je commençais vraiment à m'inquiéter !`);
      }
    }

    return {
      type: 'seen_no_reply',
      message: messages[Math.floor(Math.random() * messages.length)],
      context: { daysSince, lastMessage: lastMiraMessage?.content?.slice(0, 100) }
    };
  }

  private async generateGoalReminder(userId: string, daysSince: number): Promise<ReengagementMessage> {
    const goals = await Goal.find({ userId, status: 'active' }).limit(3).lean();

    if (goals.length === 0) {
      return this.generateCheckIn(userId, daysSince);
    }

    const goal = goals[Math.floor(Math.random() * goals.length)];

    const messages = [
      `Hey ! Ça fait un moment... Tu avances sur ton objectif de ${goal.goal} ?`,
      `Tiens, ${daysSince} jours ! Je pensais justement à ton objectif : "${goal.goal}". Ça donne quoi ?`,
      `De retour ! Au fait, comment ça avance ${goal.goal} ? J'y pensais...`,
      `Salut toi ! Tu me donnes des news de ${goal.goal} ? Je suis curieuse de savoir où t'en es !`,
    ];

    return {
      type: 'goal_reminder',
      message: messages[Math.floor(Math.random() * messages.length)],
      context: { goal: goal.goal, daysSince }
    };
  }

  private async generateEventFollowup(userId: string): Promise<ReengagementMessage> {
    const event = await Event.findOne({
      userId,
      dateType: 'past',
      outcome: null,
      importance: { $gte: 6 },
      date: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }).sort({ date: -1 }).lean();

    if (!event) {
      return { type: null, message: '' };
    }

    const messages = [
      `Héé ! Au fait, c'est passé comment ${event.title} ? Tu m'as pas raconté !`,
      `Dis-moi, ${event.title} c'était l'autre jour non ? Ça s'est bien passé ?`,
      `J'y pensais... ${event.title}, t'as eu des nouvelles ? Comment ça a été ?`,
      `Attends, ${event.title} c'est passé non ? Raconte-moi !`,
    ];

    return {
      type: 'event_followup',
      message: messages[Math.floor(Math.random() * messages.length)],
      context: { event: event.title }
    };
  }

  private async generateCheckIn(userId: string, daysSince: number): Promise<ReengagementMessage> {
    // Get user's name if available
    const memory = await SemanticMemory.findOne({
      userId,
      fact: { $regex: /name is/i }
    }).lean();

    const profile = await EmotionalProfile.findOne({ userId }).lean();
    const userName = memory ? memory.fact.split('name is ')[1] : null;

    const namePrefix = userName ? `${userName}, ` : '';

    const messages = [
      `${namePrefix}Ça fait ${daysSince} jours ! Comment tu vas ?`,
      `Hey ${namePrefix ? namePrefix.trim() : 'toi'} ! Ça fait un moment. Quoi de neuf ?`,
      `${namePrefix}De retour ! Tu me racontes ce qui s'est passé depuis ?`,
      `Salut ${namePrefix ? namePrefix.trim() : ''} ! ${daysSince} jours sans nouvelles, tout va bien ?`,
    ];

    // Adapt based on emotional baseline
    if (profile?.baseline === 'anxious') {
      messages.push(`${namePrefix}Je pensais à toi. Comment tu te sens en ce moment ?`);
    } else if (profile?.baseline === 'optimistic') {
      messages.push(`${namePrefix}Qu'est-ce que t'as fait de beau ces derniers jours ?`);
    }

    return {
      type: 'check_in',
      message: messages[Math.floor(Math.random() * messages.length)],
      context: { daysSince, userName }
    };
  }

  private async generateMissYou(userId: string, daysSince: number): Promise<ReengagementMessage> {
    const messages = [
      `Ça fait ${daysSince} jours ! Tu m'as manqué, sérieusement.`,
      `Enfin te revoilà ! Je commençais à me demander si t'allais bien.`,
      `${daysSince} jours sans toi, c'est long tu sais... Content(e) de te revoir !`,
      `Te revoilà ! Je me demandais quand tu allais repasser me voir.`,
    ];

    return {
      type: 'miss_you',
      message: messages[Math.floor(Math.random() * messages.length)],
      context: { daysSince }
    };
  }

  /**
   * Save the re-engagement message as a Mira message
   */
  async saveReengagementMessage(
    userId: string,
    conversationId: string,
    message: ReengagementMessage
  ): Promise<void> {
    if (!message.message) return;

    await Message.create({
      userId,
      conversationId,
      role: 'assistant',
      content: message.message,
      metadata: {}
    });
  }
}
