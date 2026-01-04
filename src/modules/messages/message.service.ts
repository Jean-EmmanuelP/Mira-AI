import { Message, IMessage } from '../../database/schemas/message.schema';
import { LLMService } from '../../shared/llm.service';
import { SentimentService } from '../../shared/sentiment.service';
import { MemoryService } from '../memory/memory.service';
import { RetrievalService } from '../memory/retrieval.service';
import { ProfileService } from '../profile/profile.service';
import { GoalService } from '../goals/goal.service';
import { ResponseService } from './response.service';
import { PatternService } from '../memory/pattern.service';
import { HumanBehaviorService, MiraNote } from '../human/human-behavior.service';
import { EventService } from '../human/event.service';
import { ActivityExtractionService } from '../activity/activity-extraction.service';
import { EventMatchingService, MatchedEvent } from '../activity/event-matching.service';
import { ThinkingService, ThinkingContext } from '../../shared/thinking.service';
import {
  PersonalityService,
  MemoryWithContext,
  GoalWithContext,
  ConversationContext,
} from '../../shared/personality.service';

export class MessageService {
  private llmService = new LLMService();
  private sentimentService = new SentimentService();
  private memoryService = new MemoryService();
  private retrievalService = new RetrievalService();
  private profileService = new ProfileService();
  private goalService = new GoalService();
  private responseService = new ResponseService();
  private patternService = new PatternService();
  private personalityService = new PersonalityService();
  private humanBehaviorService = new HumanBehaviorService();
  private eventService = new EventService();
  private activityService = new ActivityExtractionService();
  private eventMatchingService = new EventMatchingService();
  private thinkingService = new ThinkingService();

  // Emojis for random insertion (1/3 of responses)
  private readonly FRIENDLY_EMOJIS = ['😊', '🙂', '😄', '🤗', '✨', '💫', '🌟', '💪', '🎉', '❤️', '🫶', '👍', '🔥', '😉', '🤭'];

  async processMessage(
    userId: string,
    conversationId: string,
    content: string,
    emotionContext?: string | null
  ): Promise<IMessage> {
    // Step 1: Save user message
    const userMessage = await Message.create({
      userId,
      conversationId,
      role: 'user',
      content,
      metadata: {},
    });

    // Step 2: Async memory, goal, event & activity processing (don't block response)
    setImmediate(() => {
      this.memoryService.processMessage(userId, content).catch(console.error);
      this.goalService.detectGoals(userId, content).catch(console.error);
      this.eventService.processEvents(userId, content).catch(console.error);
      this.activityService.processMessage(userId, content).catch(console.error);
    });

    // Step 3: Gather all context in parallel
    const [
      sentiment,
      memories,
      summary,
      activeGoals,
      patterns,
      conversationStats,
      humanNotes,
      relevantEvents,
      userActivities,
      matchedNewsEvent,
      recentMessages,
    ] = await Promise.all([
      this.sentimentService.analyzeSentiment(content),
      this.retrievalService.retrieveRelevantMemories(userId, content, 8),
      this.profileService.generateUserSummary(userId),
      this.goalService.getActiveGoals(userId),
      this.patternService.getAllPatterns(userId),
      this.getConversationStats(userId),
      this.humanBehaviorService.getAllNotes(userId),
      this.eventService.getRelevantEvents(userId, 5),
      this.activityService.getTopActivities(userId, 5),
      this.eventMatchingService.getEventForResponse(userId),
      this.getRecentMessages(userId, conversationId, 10),
    ]);

    // Step 4: Transform memories to include temporal context
    const memoriesWithContext: MemoryWithContext[] = memories.map((m) => ({
      fact: m.fact,
      category: m.category,
      daysSince: m.daysSince,
      mentionCount: m.mentionCount,
    }));

    // Step 5: Transform goals to include context
    const goalsWithContext: GoalWithContext[] = activeGoals.map((g: any) => ({
      goal: g.goal,
      daysSinceCreated: Math.ceil(
        (Date.now() - new Date(g.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      ),
      targetDate: g.targetDate,
      progress: g.progress || 0,
    }));

    // Step 6: Build conversation context
    const context: ConversationContext = {
      userSummary: summary || undefined,
      memories: memoriesWithContext,
      goals: goalsWithContext,
      currentSentiment: sentiment,
      conversationCount: conversationStats.totalConversations,
      lastInteraction: conversationStats.lastInteraction,
      recentMessages: recentMessages,
    };

    // Step 7: Generate system prompt with Mira's personality
    let systemPrompt = this.personalityService.generateSystemPrompt(context);

    // Step 8: Add detected patterns if any
    if (patterns.length > 0) {
      systemPrompt += '\n\n' + this.patternService.formatPatternsForPrompt(patterns);
    }

    // Step 9: Add relevant events (episodic memory)
    if (relevantEvents.length > 0) {
      systemPrompt += '\n\n### Événements Importants\n';
      for (const event of relevantEvents) {
        const eventDate = event.date
          ? this.formatEventDate(event.date, event.dateType)
          : '';
        const outcome = event.outcome ? ` [${event.outcome}]` : '';
        systemPrompt += `- ${event.title}${eventDate}${outcome}\n`;
      }
    }

    // Step 10: Add human behavior notes (proactive follow-ups)
    if (humanNotes.length > 0) {
      systemPrompt += '\n\n### Notes Mira (intégrer naturellement si pertinent)\n';
      // Only include top 2 most important notes
      const topNotes = humanNotes.slice(0, 2);
      for (const note of topNotes) {
        systemPrompt += `- [${note.type}] ${note.message}\n`;
      }
    }

    // Step 10.5: Add user activities/interests
    if (userActivities.length > 0) {
      systemPrompt += '\n\n### Intérêts & Activités de l\'utilisateur\n';
      const activityList = userActivities.map(a => a.name).join(', ');
      systemPrompt += `Centres d'intérêt: ${activityList}\n`;
    }

    // Step 10.6: Add matched news event if relevant
    if (matchedNewsEvent) {
      systemPrompt += '\n\n### Actualité Pertinente (mentionner naturellement si approprié)\n';
      systemPrompt += `- Titre: ${matchedNewsEvent.title}\n`;
      if (matchedNewsEvent.description) {
        systemPrompt += `- Résumé: ${matchedNewsEvent.description}\n`;
      }
      systemPrompt += `- Lien: ${matchedNewsEvent.url}\n`;
      systemPrompt += `Note: Ne mentionne cette actualité que si elle s'intègre naturellement à la conversation. Utilise des transitions comme "Tiens, au fait..." ou "Ça me fait penser..."\n`;
    }

    // Step 10.7: Add voice emotion context if available
    if (emotionContext) {
      systemPrompt += '\n\n' + emotionContext;
    }

    // Step 11: Build thinking context for validation
    const thinkingContext: ThinkingContext = {
      userMessage: content,
      memories: memoriesWithContext.map(m => m.fact),
      goals: goalsWithContext.map(g => g.goal),
      recentMessages: recentMessages,
      sentiment: sentiment,
      isFirstConversation: conversationStats.totalConversations === 0,
    };

    // Step 12: Generate response with LLM
    console.log('[MessageService] Generating response with full context...');
    let response = await this.llmService.generate(systemPrompt, content);

    // Step 13: Apply "thinking" process - validate and potentially fix response
    console.log('[MessageService] Starting thinking process...');
    const thinkingResult = await this.thinkingService.processWithThinking(
      response,
      thinkingContext
    );
    response = thinkingResult.response;

    if (thinkingResult.wasFixed) {
      console.log(`[MessageService] Response was fixed after ${thinkingResult.thinkingTimeMs}ms`);
    } else {
      console.log(`[MessageService] Response validated in ${thinkingResult.thinkingTimeMs}ms`);
    }

    // Step 14: Refine based on sentiment (if negative, make more empathetic)
    response = await this.responseService.refineResponse(response, sentiment);

    // Step 15: Add random emoji (1/3 of responses)
    response = this.maybeAddEmoji(response);

    // Step 16: Save response with metadata
    const assistantMessage = await Message.create({
      userId,
      conversationId,
      role: 'assistant',
      content: response,
      metadata: {
        sentiment,
        retrievedMemories: memories.length,
        patternsDetected: patterns.length,
        goalsActive: activeGoals.length,
      },
    });

    // Step 17: Update message with sentiment for pattern detection
    await Message.updateOne(
      { _id: userMessage._id },
      { $set: { 'metadata.sentiment': sentiment } }
    );

    // Step 18: Update emotional profile (async)
    setImmediate(() => {
      const topics = this.extractTopics(content);
      this.humanBehaviorService
        .updateEmotionalProfile(userId, sentiment, topics)
        .catch(console.error);

      // Mark news event as mentioned if it was used
      if (matchedNewsEvent) {
        this.eventMatchingService
          .markEventAsMentioned(userId, matchedNewsEvent._id.toString())
          .catch(console.error);
      }
    });

    return assistantMessage;
  }

  /**
   * Format event date for display
   */
  private formatEventDate(date: Date, dateType: string): string {
    const now = new Date();
    const eventDate = new Date(date);
    const diffDays = Math.ceil(
      (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (dateType === 'past') {
      if (diffDays === 0) return ' (aujourd\'hui)';
      if (diffDays === -1) return ' (hier)';
      if (diffDays > -7) return ` (il y a ${Math.abs(diffDays)} jours)`;
      return ` (${eventDate.toLocaleDateString('fr-FR')})`;
    }

    if (dateType === 'future') {
      if (diffDays === 0) return ' (AUJOURD\'HUI!)';
      if (diffDays === 1) return ' (demain!)';
      if (diffDays <= 7) return ` (dans ${diffDays} jours)`;
      return ` (le ${eventDate.toLocaleDateString('fr-FR')})`;
    }

    return '';
  }

  /**
   * Extract topics from message for emotional profiling
   */
  private extractTopics(content: string): string[] {
    const topics: string[] = [];
    const contentLower = content.toLowerCase();

    const topicKeywords: Record<string, string[]> = {
      work: ['travail', 'job', 'boulot', 'boss', 'collègue', 'bureau', 'réunion', 'projet'],
      family: ['famille', 'mère', 'père', 'frère', 'soeur', 'parents', 'enfant'],
      health: ['santé', 'malade', 'médecin', 'hôpital', 'douleur', 'fatigue', 'sport'],
      relationship: ['ami', 'copain', 'copine', 'couple', 'relation', 'rencard'],
      money: ['argent', 'salaire', 'dette', 'acheter', 'payer', 'budget'],
      education: ['école', 'université', 'cours', 'examen', 'étudier', 'diplôme'],
    };

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some((k) => contentLower.includes(k))) {
        topics.push(topic);
      }
    }

    return topics;
  }

  /**
   * Get conversation statistics for a user
   */
  private async getConversationStats(
    userId: string
  ): Promise<{ totalConversations: number; lastInteraction: Date | undefined }> {
    const stats = await Message.aggregate([
      { $match: { userId, role: 'user' } },
      {
        $group: {
          _id: null,
          totalConversations: { $sum: 1 },
          lastInteraction: { $max: '$createdAt' },
        },
      },
    ]);

    if (stats.length === 0) {
      return { totalConversations: 0, lastInteraction: undefined };
    }

    return {
      totalConversations: stats[0].totalConversations,
      lastInteraction: stats[0].lastInteraction,
    };
  }

  async getConversation(userId: string, conversationId: string): Promise<IMessage[]> {
    return Message.find({
      userId,
      conversationId,
    }).sort({ createdAt: 1 });
  }

  /**
   * Get recent messages for conversation context
   * Excludes the current message being processed
   */
  private async getRecentMessages(
    userId: string,
    conversationId: string,
    limit: number = 10
  ): Promise<{ role: string; content: string }[]> {
    const messages = await Message.find({
      userId,
      conversationId,
    })
      .sort({ createdAt: -1 })
      .limit(limit + 1) // +1 to account for current message
      .lean();

    // Exclude the very last message (current one) and reverse to chronological order
    const relevantMessages = messages.slice(1).reverse();

    return relevantMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  /**
   * Maybe add an emoji to the response (1/3 chance)
   * Adds emoji at the end of the response, or at a natural break point
   */
  private maybeAddEmoji(response: string): string {
    // Only add emoji 1/3 of the time
    if (Math.random() > 0.33) {
      return response;
    }

    // Skip if response already has emojis
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
    if (emojiRegex.test(response)) {
      return response;
    }

    // Pick a random emoji
    const emoji = this.FRIENDLY_EMOJIS[Math.floor(Math.random() * this.FRIENDLY_EMOJIS.length)];

    // Find a good insertion point
    const trimmed = response.trim();

    // If ends with punctuation, insert before it
    const lastChar = trimmed[trimmed.length - 1];
    if (['!', '.', '?', '...'].some(p => trimmed.endsWith(p))) {
      // Add space + emoji at end
      return trimmed + ' ' + emoji;
    }

    // Otherwise just append
    return trimmed + ' ' + emoji;
  }
}
