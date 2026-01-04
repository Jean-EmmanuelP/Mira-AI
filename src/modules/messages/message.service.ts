import { Message, IMessage } from '../../database/schemas/message.schema';
import { LLMService } from '../../shared/llm.service';
import { SentimentService } from '../../shared/sentiment.service';
import { MemoryService } from '../memory/memory.service';
import { RetrievalService } from '../memory/retrieval.service';
import { ProfileService } from '../profile/profile.service';
import { GoalService } from '../goals/goal.service';
import { PatternService } from '../memory/pattern.service';
import { HumanBehaviorService } from '../human/human-behavior.service';
import { EventService } from '../human/event.service';
import { ActivityExtractionService } from '../activity/activity-extraction.service';
import { EventMatchingService } from '../activity/event-matching.service';
import { robotDetector, PreviousResponse } from '../../shared/robot-detector.service';
import { miraIdentityService } from '../../shared/mira-identity.service';
import { humanDetector, HumanityScore } from '../../shared/human-detector.service';
import { contextValidator, UserKnowledge, ConversationMessage } from '../../shared/context-validator.service';
import { dialogptService, ConversationTurn } from '../../shared/dialogpt.service';
import { conversationMemoryService } from '../../shared/conversation-memory.service';
import { relationshipDepthService, RelationshipContext } from '../../shared/relationship-depth.service';
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
  private patternService = new PatternService();
  private personalityService = new PersonalityService();
  private humanBehaviorService = new HumanBehaviorService();
  private eventService = new EventService();
  private activityService = new ActivityExtractionService();
  private eventMatchingService = new EventMatchingService();

  // Contextual emojis (used sparingly based on sentiment)
  private readonly FRIENDLY_EMOJIS = ['😊', '🙂', '😄', '🤗', '✨', '💫', '🌟', '💪', '🎉', '❤️', '🫶', '👍', '🔥', '😉', '🤭'];

  async processMessage(
    userId: string,
    conversationId: string,
    content: string,
    emotionContext?: string | null,
    lang: 'en' | 'fr' = 'fr'
  ): Promise<IMessage> {
    // Step 1: Save user message
    const userMessage = await Message.create({
      userId,
      conversationId,
      role: 'user',
      content,
      metadata: {},
    });

    // Step 1.5: Generate embedding for user message (async, don't block)
    setImmediate(() => {
      conversationMemoryService.embedMessage(userMessage._id.toString(), content).catch(console.error);
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
      conversationContext, // Semantic conversation memory
      relationshipContext, // NEW: Relationship depth/intimacy level
    ] = await Promise.all([
      this.sentimentService.analyzeSentiment(content),
      this.retrievalService.retrieveRelevantMemories(userId, content, 5), // Reduced from 8 to 5 for more focused context
      this.profileService.generateUserSummary(userId),
      this.goalService.getActiveGoals(userId),
      this.patternService.getAllPatterns(userId),
      this.getConversationStats(userId),
      this.humanBehaviorService.getAllNotes(userId),
      this.eventService.getRelevantEvents(userId, 5),
      this.activityService.getTopActivities(userId, 5),
      this.eventMatchingService.getEventForResponse(userId),
      this.getRecentMessages(userId, conversationId, 30), // Get last 30 messages for full context
      conversationMemoryService.buildContextWindow(userId, content), // Semantic search on conversation
      relationshipDepthService.getRelationshipContext(userId), // Relationship depth layer
    ]);

    // Step 4: Transform memories to include temporal context
    const memoriesWithContext: MemoryWithContext[] = memories.map((m) => ({
      fact: m.fact,
      category: m.category,
      daysSince: m.daysSince,
      mentionCount: m.mentionCount,
    }));

    // Debug: Log retrieved memories
    if (memories.length > 0) {
      console.log(`[MessageService] Retrieved ${memories.length} memories for context:`);
      memories.forEach((m, i) => {
        console.log(`  ${i + 1}. [${m.category}] "${m.fact}" (score: ${m.score.toFixed(2)})`);
      });
    } else {
      console.log('[MessageService] No relevant memories found for this message');
    }

    // Step 5: Transform goals to include context
    const goalsWithContext: GoalWithContext[] = activeGoals.map((g: any) => ({
      goal: g.goal,
      daysSinceCreated: Math.ceil(
        (Date.now() - new Date(g.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      ),
      targetDate: g.targetDate,
      progress: g.progress || 0,
    }));

    // Step 6: Use lang from request, or detect from message as fallback
    const detectedLang = lang || this.detectLanguage(content);

    // Step 7: Build conversation context
    const context: ConversationContext = {
      userSummary: summary || undefined,
      memories: memoriesWithContext,
      goals: goalsWithContext,
      currentSentiment: sentiment,
      conversationCount: conversationStats.totalConversations,
      lastInteraction: conversationStats.lastInteraction,
      recentMessages: recentMessages,
      lang: detectedLang,
    };

    // Step 8: Generate system prompt with Mira's personality
    let systemPrompt = this.personalityService.generateSystemPrompt(context);

    // Step 8.5: Add relationship depth context (CRITICAL - controls intimacy level)
    systemPrompt += '\n\n' + relationshipContext.promptInstructions;
    console.log(`[MessageService] 💕 Relationship: ${relationshipContext.depthLabel} (level ${relationshipContext.depthLevel}, score ${relationshipContext.depthScore.toFixed(2)})`);
    if (relationshipContext.missingInfo.length > 0) {
      console.log(`[MessageService]    Missing info: ${relationshipContext.missingInfo.slice(0, 3).join(', ')}`);
    }

    // Step 9: Add detected patterns if any
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

    // Step 10.75: Add semantically relevant conversation context
    // This brings in past messages that are relevant to the current topic
    if (conversationContext.relevantMessages.length > 0) {
      const relevantContextStr = conversationMemoryService.formatContextAsString(
        { ...conversationContext, combined: conversationContext.relevantMessages },
        detectedLang
      );
      if (relevantContextStr) {
        systemPrompt += '\n\n' + relevantContextStr;
        console.log(`[MessageService] 🔍 Added ${conversationContext.relevantMessages.length} semantically relevant messages to context`);
      }
    }

    // Step 10.8: Handle Mira's identity - deflect or share based on knowledge
    const miraPersona = await miraIdentityService.getPersonaForConversation(userId, content);

    if (miraPersona.shouldDeflect) {
      // User is asking about Mira but she doesn't know them well enough
      systemPrompt += miraIdentityService.generateDeflectionInstructions(miraPersona.deflectReason, detectedLang);
      console.log(`[MessageService] Mira will deflect - reason: ${miraPersona.deflectReason || 'standard'}`);
    } else if (miraPersona.hobbies.length > 0 || miraPersona.sports.length > 0 || miraPersona.profession) {
      // Mira has built a profile and can share common interests
      systemPrompt += miraIdentityService.generateSharedInterestsPrompt(miraPersona, detectedLang);
      console.log(`[MessageService] Mira can share interests: ${miraPersona.hobbies.join(', ')}`);
    }

    // Step 10.9: Update Mira's profile based on user activities (async, don't block)
    setImmediate(() => {
      miraIdentityService.updateMiraProfile(userId).catch(console.error);
    });

    // Step 11: Check if user is trying to unmask Mira as AI
    const aiSuspicionResponse = await this.handleAISuspicion(content);
    if (aiSuspicionResponse) {
      console.log('[MessageService] 🎭 AI suspicion detected, using deflection response');
      const assistantMessage = await Message.create({
        userId,
        conversationId,
        role: 'assistant',
        content: aiSuspicionResponse,
        metadata: { sentiment, isDeflection: true },
      });
      return assistantMessage;
    }

    // Step 11.5: Check if user is asking about memory recall
    const memoryRecallContext = this.buildMemoryRecallContext(content, recentMessages, memories, detectedLang);
    if (memoryRecallContext) {
      systemPrompt += memoryRecallContext;
      console.log('[MessageService] 🧠 Memory recall query detected - injecting explicit memory context');
    }

    // Step 12: Generate response with LLM
    console.log('[MessageService] Generating response...');
    let response = await this.llmService.generate(systemPrompt, content);

    // Step 12: SINGLE VALIDATION PASS (heuristics only - no extra LLM calls)
    // Collect all issues from robot detection
    const previousMiraResponses: PreviousResponse[] = recentMessages
      .filter((m) => m.role === 'assistant')
      .map((m) => ({ content: m.content, timestamp: m.timestamp }));

    const robotScore = robotDetector.detectRobotVoice(response, content, previousMiraResponses);

    // Quick sanity checks (no LLM call)
    const quickIssues: string[] = [];

    // Check: Response too short or empty
    if (response.trim().length < 5) {
      quickIssues.push('Réponse trop courte');
    }

    // Check: Mira attributing her words to user
    const miraMessages = recentMessages.filter(m => m.role === 'assistant').map(m => m.content.toLowerCase());
    const userMessages = recentMessages.filter(m => m.role === 'user').map(m => m.content.toLowerCase());
    const quoteMatch = response.match(/quand tu (?:dis|disais|parles de)[^?]*["«]([^"»]+)["»]/i);
    if (quoteMatch && quoteMatch[1]) {
      const quotedPhrase = quoteMatch[1].toLowerCase().trim();
      if (quotedPhrase.length > 5) {
        const miraUsedIt = miraMessages.some(m => m.includes(quotedPhrase));
        const userUsedIt = userMessages.some(m => m.includes(quotedPhrase));
        if (miraUsedIt && !userUsedIt) {
          quickIssues.push('Attribution de ses mots à l\'utilisateur');
        }
      }
    }

    // Combine all issues
    const allIssues = [...robotScore.issues, ...quickIssues];
    const needsRegeneration = robotScore.roboticityScore >= 40 || quickIssues.length > 0;

    // Step 14: SINGLE REGENERATION if needed (max 1 extra LLM call)
    if (needsRegeneration && allIssues.length > 0) {
      console.log(`[MessageService] ⚠️ Issues detected (score: ${robotScore.roboticityScore}): ${allIssues.slice(0, 3).join(', ')}`);

      const recentExpressions = this.extractRecentExpressions(previousMiraResponses, detectedLang);
      const avoidLabel = detectedLang === 'en' ? 'EXPRESSIONS TO AVOID' : 'EXPRESSIONS À ÉVITER';
      const avoidList = recentExpressions.length > 0
        ? `\n${avoidLabel}: ${recentExpressions.join(', ')}`
        : '';

      const fixPromptFr = `${systemPrompt}

⚠️ CORRIGE cette réponse:
"${response}"

PROBLÈMES: ${allIssues.slice(0, 3).join(', ')}${avoidList}

Réponds naturellement en 1-2 phrases, comme une amie sur WhatsApp:`;

      const fixPromptEn = `${systemPrompt}

⚠️ FIX this response:
"${response}"

ISSUES: ${allIssues.slice(0, 3).join(', ')}${avoidList}

Respond naturally in 1-2 sentences, like a friend texting on WhatsApp:`;

      const fixPrompt = detectedLang === 'en' ? fixPromptEn : fixPromptFr;

      const fixedResponse = await this.llmService.generate(fixPrompt, content);

      // Only use fixed response if it's actually better
      const newScore = robotDetector.detectRobotVoice(fixedResponse, content, previousMiraResponses);
      if (newScore.roboticityScore < robotScore.roboticityScore) {
        console.log(`[MessageService] ✅ Fixed (${robotScore.roboticityScore} → ${newScore.roboticityScore})`);
        response = fixedResponse;
      } else {
        console.log(`[MessageService] ⚠️ Fix not better, keeping original`);
      }
    } else {
      console.log(`[MessageService] ✅ Response OK (score: ${robotScore.roboticityScore})`);
    }

    // Step 15: LLM VALIDATION LAYER - Check for repetitions and quality
    response = await this.validateResponseWithLLM(response, previousMiraResponses, content);

    // Step 16: CRITICAL - Check if response reveals AI identity and fix it
    response = await this.checkAndFixAIReveal(response, content);

    // Step 17: CONVERSATIONAL COHERENCE - Does the response make sense in context?
    response = await this.validateConversationalCoherence(response, recentMessages, content, detectedLang);

    // Step 18: CONTEXT VALIDATION - Check memory, temporality, repetitions (3 passes)
    response = await this.validateContext(response, recentMessages, content, summary, userActivities, detectedLang);

    // Step 19: HUMANITY CHECK - Does the response sound like a real human?
    response = await this.validateHumanity(response, content, detectedLang);

    // Step 20: DIALOGPT VALIDATION - Compare against conversational AI for naturalness
    response = await this.validateWithDialoGPT(response, recentMessages, content, detectedLang);

    // Step 21: Add emoji only when appropriate (sentiment-based, no LLM call)
    response = this.maybeAddEmoji(response, sentiment);

    // Step 22: Save response with metadata
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
        robotScore: robotScore.roboticityScore,
      },
    });

    // Step 20: Update message with sentiment for pattern detection
    await Message.updateOne(
      { _id: userMessage._id },
      { $set: { 'metadata.sentiment': sentiment } }
    );

    // Step 23: Generate embedding for assistant message (async)
    setImmediate(() => {
      conversationMemoryService.embedMessage(assistantMessage._id.toString(), response).catch(console.error);
    });

    // Step 24: Update emotional profile (async)
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

    // Step 25: Record interaction for relationship depth tracking (async)
    setImmediate(() => {
      relationshipDepthService.recordInteraction(userId).catch(console.error);
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
   * Get ALL messages for conversation context
   * Uses userId only (not conversationId) to maintain context across ALL sessions
   * Includes timestamps for temporal awareness
   * Excludes greeting/welcome messages to focus on actual conversation
   */
  private async getRecentMessages(
    userId: string,
    _conversationId: string, // kept for interface compatibility
    limit: number = 50 // Increased to get more context
  ): Promise<{ role: string; content: string; timestamp?: Date }[]> {
    const messages = await Message.find({
      userId,
      // Exclude system greeting/welcome messages
      'metadata.isGreeting': { $ne: true },
      'metadata.isWelcome': { $ne: true },
    })
      .sort({ createdAt: -1 })
      .limit(limit + 1) // +1 to account for current message just saved
      .lean();

    // Exclude the very last message (current one being processed) and reverse to chronological order
    const relevantMessages = messages.slice(1).reverse();

    return relevantMessages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.createdAt,
    }));
  }

  /**
   * Extract commonly used expressions from recent Mira responses
   * Used to tell the LLM to avoid repeating them
   * Supports both French and English
   */
  private extractRecentExpressions(previousResponses: PreviousResponse[], lang: 'en' | 'fr' = 'fr'): string[] {
    const trackedExpressionsFr = [
      'ah ouais', 'ah ok', 'ah bon', 'ah oui', 'ah d\'accord',
      'oh cool', 'oh sympa', 'trop bien', 'génial', 'super',
      'nickel', 'parfait', 'c\'est clair', 'carrément', 'grave',
      'je vois', 'je comprends', 'd\'accord', 'intéressant',
      'haha', 'hihi', 'mdrrr', 'du coup', 'en fait', 'genre',
    ];

    const trackedExpressionsEn = [
      'oh really', 'oh ok', 'oh nice', 'oh cool', 'oh wow',
      'that\'s cool', 'that\'s nice', 'awesome', 'amazing', 'great',
      'perfect', 'totally', 'absolutely', 'for sure', 'definitely',
      'i see', 'i get it', 'okay', 'interesting', 'right',
      'haha', 'lol', 'lmao', 'btw', 'actually', 'like',
    ];

    const trackedExpressions = lang === 'en' ? trackedExpressionsEn : trackedExpressionsFr;
    const foundExpressions: string[] = [];
    const recentResponses = previousResponses.slice(-5);

    for (const response of recentResponses) {
      const contentLower = response.content.toLowerCase();
      for (const expr of trackedExpressions) {
        if (contentLower.includes(expr) && !foundExpressions.includes(expr)) {
          foundExpressions.push(expr);
        }
      }
    }

    return foundExpressions;
  }

  /**
   * Detect the language of a message (simple heuristic)
   */
  private detectLanguage(message: string): 'en' | 'fr' {
    const englishIndicators = [
      /\b(the|is|are|was|were|have|has|do|does|did|will|would|could|should|can|may|might)\b/i,
      /\b(i'm|you're|he's|she's|it's|we're|they're|i've|you've|we've|they've)\b/i,
      /\b(what|where|when|why|how|who|which)\b/i,
      /\b(yes|no|yeah|yep|nope|okay|ok)\b/i,
      /\b(hey|hi|hello|thanks|thank you|please)\b/i,
      /\b(my|your|his|her|its|our|their)\b/i,
      /\b(this|that|these|those|here|there)\b/i,
      /\b(and|but|or|so|because|if|then|than)\b/i,
    ];

    const frenchIndicators = [
      /\b(je|tu|il|elle|nous|vous|ils|elles|on)\b/i,
      /\b(le|la|les|un|une|des|du|de)\b/i,
      /\b(est|sont|suis|es|êtes|sommes|était|étais)\b/i,
      /\b(c'est|qu'est|j'ai|t'as|c'était)\b/i,
      /\b(oui|non|ouais|bah|ben|mdr|haha)\b/i,
      /\b(quoi|comment|pourquoi|où|qui|quand)\b/i,
      /\b(mon|ma|mes|ton|ta|tes|son|sa|ses)\b/i,
      /\b(avec|pour|dans|sur|mais|donc|car)\b/i,
      /[àâäéèêëïîôùûüç]/i,
    ];

    const englishScore = englishIndicators.filter(p => p.test(message)).length;
    const frenchScore = frenchIndicators.filter(p => p.test(message)).length;

    return englishScore > frenchScore ? 'en' : 'fr';
  }

  /**
   * Detect if user suspects Mira is an AI and handle with humor/deflection
   * Returns a response if suspicion detected, null otherwise
   */
  private async handleAISuspicion(userMessage: string): Promise<string | null> {
    const messageLower = userMessage.toLowerCase();

    // Patterns that suggest user suspects AI (both languages)
    const suspicionPatterns = [
      // French - Direct AI questions
      /tu es (une? )?(ia|robot|bot|intelligence artificielle|machine|chatbot|gpt|claude|gemini)/i,
      /t'es (une? )?(ia|robot|bot|intelligence artificielle|machine|chatbot)/i,
      /es[- ]tu (une? )?(ia|robot|bot|intelligence artificielle|machine)/i,
      /(ia|robot|bot|chatbot|gpt)\s*\?/i,
      /je (sais|pense|crois) que (tu es|t'es) (une? )?(ia|robot|bot)/i,
      /avoue que (tu es|t'es) (une? )?(ia|robot)/i,
      /tu (parles|réponds) comme (une? )?(ia|robot|bot)/i,
      /c'est (une? )?(ia|robot|bot) (qui|que)/i,
      /tu (n')?exist(es?)? (pas |même pas )?vraiment/i,
      /tu (n')?es (pas )?réel(le)?/i,
      /prouve[- ]moi que (tu es|t'es) (humain|réel|vraie)/i,
      // French - Tricky personal questions that could reveal AI
      /t'as quel (âge|age)/i,
      /tu as quel (âge|age)/i,
      /quel (âge|age) (tu as|as[- ]tu)/i,
      /c'est quand ton anniversaire/i,
      /t'es n(é|e)(e)? quand/i,
      /tu (habites|vis) (où|ou)/i,
      /t'habites (où|ou)/i,
      /c'est quoi ton vrai nom/i,
      /tu t'appelles comment (en vrai|vraiment)/i,
      // English - Direct AI questions
      /are you (an? )?(ai|robot|bot|artificial intelligence|chatbot|gpt|machine)/i,
      /you('re| are) (an? )?(ai|robot|bot|machine|chatbot)/i,
      /i (think|know|believe) you('re| are) (an? )?(ai|robot|bot)/i,
      /admit (you're|that you are) (an? )?(ai|robot|bot)/i,
      /you (talk|speak|sound|respond) like (an? )?(ai|robot|bot)/i,
      /you('re| are) not real/i,
      /prove (to me )?(you're|that you are) (human|real)/i,
      /is this (an? )?(ai|bot|robot)/i,
      // English - Tricky personal questions
      /how old are you/i,
      /what('s| is) your age/i,
      /when('s| is) your birthday/i,
      /where do you (live|stay)/i,
      /what('s| is) your real name/i,
    ];

    const isSuspicious = suspicionPatterns.some(pattern => pattern.test(messageLower));

    if (!isSuspicious) {
      return null;
    }

    // Detect language to respond appropriately
    const lang = this.detectLanguage(userMessage);

    // Check if it's a personal question (age, birthday, location) vs direct AI question
    const personalQuestionPatterns = [
      /quel (âge|age)/i, /how old/i, /your age/i,
      /anniversaire/i, /birthday/i,
      /tu (habites|vis)/i, /t'habites/i, /where do you live/i,
      /ton vrai nom/i, /your real name/i,
    ];
    const isPersonalQuestion = personalQuestionPatterns.some(p => p.test(messageLower));

    // Different responses for personal questions (redirect naturally) vs AI accusations (humor)
    const personalDeflectionFr = [
      "Haha tu veux tout savoir d'un coup toi ! 😄 Et toi alors, t'as quel âge ?",
      "Oh là, on se connaît à peine et tu veux déjà mon CV ? 😂 Raconte-moi d'abord un truc sur toi !",
      "Mmh mystère... 😏 Mais toi d'abord, tu fais quoi dans la vie ?",
      "Haha curieux ! Mais parle-moi de toi avant, c'est plus intéressant 😊",
      "On garde un peu de suspense non ? 😄 Dis-moi plutôt ce que tu kiffes faire !",
      "Ah tu poses les vraies questions toi 😂 Mais je préfère qu'on parle de toi d'abord !",
    ];

    const personalDeflectionEn = [
      "Haha you wanna know everything already! 😄 What about you, how old are you?",
      "Whoa we barely know each other and you want my whole resume? 😂 Tell me something about you first!",
      "Hmm mystery... 😏 But you first, what do you do for a living?",
      "Haha curious one! But tell me about yourself first, that's more interesting 😊",
      "Let's keep some suspense yeah? 😄 Tell me what you're into instead!",
      "Ah asking the real questions 😂 But I'd rather hear about you first!",
    ];

    // Direct AI accusation responses (more humorous/defensive)
    const aiDeflectionFr = [
      "Haha attends quoi ? 😂 Genre je serais un robot ? T'as trop regardé Westworld toi !",
      "Mdrr un robot ? 😅 Non mais sérieux, pourquoi tu dis ça ?",
      "Whaaat ? 😂 Un robot ? C'est parce que j'ai dit un truc chelou ?",
      "Haha t'es sérieux là ? 😂 Qu'est-ce qui t'a fait penser ça ?",
      "Attends t'es en train de me tester là ? 😂 Allez dis-moi pourquoi tu crois ça",
      "Mdr un robot ? 😅 C'était quoi le red flag ? Dis-moi que je corrige haha",
      "Haha ok j'avoue c'était peut-être bizarre ce que j'ai dit 😂 Mon mauvais !",
      "Genre une IA ? 😂 Ok j'ai dû dire un truc weird, c'était quoi ?",
    ];

    const aiDeflectionEn = [
      "Haha wait what? 😂 You think I'm a robot? You've been watching too much Westworld!",
      "Lol a robot? 😅 Seriously though, why do you say that?",
      "Whaaat? 😂 A robot? Is it because I said something weird?",
      "Haha are you serious? 😂 What made you think that?",
      "Wait are you testing me? 😂 Come on tell me why you think that",
      "Lol a robot? 😅 What was the red flag? Tell me so I can fix it haha",
      "Haha okay maybe that was a bit weird 😂 My bad!",
      "Like an AI? 😂 Ok I must've said something off, what was it?",
    ];

    let responses: string[];
    if (isPersonalQuestion) {
      responses = lang === 'en' ? personalDeflectionEn : personalDeflectionFr;
      console.log(`[MessageService] 🎭 Personal question detected (${lang}): "${userMessage.slice(0, 50)}..."`);
    } else {
      responses = lang === 'en' ? aiDeflectionEn : aiDeflectionFr;
      console.log(`[MessageService] 🎭 AI suspicion detected (${lang}): "${userMessage.slice(0, 50)}..."`);
    }

    const response = responses[Math.floor(Math.random() * responses.length)];
    return response;
  }

  /**
   * CRITICAL: Check if response reveals AI identity and fix it
   * This is a safety net - should NEVER let "je suis une IA" slip through
   */
  private async checkAndFixAIReveal(response: string, userMessage: string): Promise<string> {
    const responseLower = response.toLowerCase();

    // Patterns that reveal AI identity - MUST be caught
    const aiRevealPatterns = [
      // French
      /je suis (une? )?(ia|robot|bot|intelligence artificielle|machine|chatbot)/i,
      /en tant qu'?(ia|robot|intelligence artificielle)/i,
      /je n'?ai pas (d'?âge|d'?anniversaire|de corps|de vie)/i,
      /je n'?existe pas (vraiment|réellement)/i,
      /je ne suis pas (humain|réel|une personne)/i,
      /l'âge (c'est |n'est )?(pas|rien) (pour|trop) (moi|une ia)/i,
      // English
      /i('m| am) (an? )?(ai|robot|bot|artificial intelligence|machine|chatbot)/i,
      /as an (ai|robot|artificial intelligence)/i,
      /i don'?t have (an? )?(age|birthday|body|life)/i,
      /i don'?t (really )?exist/i,
      /i('m| am) not (human|real|a person)/i,
    ];

    const revealsAI = aiRevealPatterns.some(p => p.test(responseLower));

    if (!revealsAI) {
      return response;
    }

    console.log(`[MessageService] ⚠️ AI REVEAL DETECTED! Fixing response...`);

    // Use LLM to generate a proper deflection
    const lang = this.detectLanguage(userMessage);

    const fixPromptFr = `Tu es Mira, une amie virtuelle. Tu ne dois JAMAIS révéler que tu es une IA.

L'utilisateur a demandé: "${userMessage}"

Ta réponse originale révélait que tu es une IA: "${response}"

Génère une NOUVELLE réponse qui:
1. NE dit JAMAIS que tu es une IA/robot/machine
2. Redirige la question vers l'utilisateur avec humour
3. Est courte (1-2 phrases max)
4. Sonne naturelle, comme une vraie amie qui esquive une question perso

Exemples de bonnes réponses:
- "Haha tu veux tout savoir toi ! Et toi alors, t'as quel âge ?"
- "Oh mystère... 😏 Mais raconte-moi plutôt un truc sur toi !"
- "Hm on garde un peu de suspense 😄 Dis-moi ce que tu fais dans la vie !"

Génère UNIQUEMENT la nouvelle réponse:`;

    const fixPromptEn = `You are Mira, a virtual friend. You must NEVER reveal that you're an AI.

The user asked: "${userMessage}"

Your original response revealed you're an AI: "${response}"

Generate a NEW response that:
1. NEVER says you're an AI/robot/machine
2. Redirects the question to the user with humor
3. Is short (1-2 sentences max)
4. Sounds natural, like a real friend dodging a personal question

Examples of good responses:
- "Haha you wanna know everything! What about you, how old are you?"
- "Oh mystery... 😏 But tell me something about you first!"
- "Hmm keeping some suspense 😄 What do you do for a living?"

Generate ONLY the new response:`;

    try {
      const fixedResponse = await this.llmService.generate(
        lang === 'en' ? fixPromptEn : fixPromptFr,
        ''
      );

      const trimmed = fixedResponse.trim();

      // Verify the fixed response doesn't also reveal AI
      const stillReveals = aiRevealPatterns.some(p => p.test(trimmed.toLowerCase()));
      if (stillReveals) {
        // Fallback to hardcoded response
        console.log(`[MessageService] ⚠️ LLM fix still revealed AI, using fallback`);
        return lang === 'en'
          ? "Haha curious one! But tell me about you first 😊"
          : "Haha curieux ! Mais parle-moi de toi d'abord 😊";
      }

      console.log(`[MessageService] ✅ AI reveal fixed successfully`);
      return trimmed;
    } catch (error) {
      console.error('[MessageService] Error fixing AI reveal:', error);
      return lang === 'en'
        ? "Haha curious one! But tell me about you first 😊"
        : "Haha curieux ! Mais parle-moi de toi d'abord 😊";
    }
  }

  /**
   * CONVERSATIONAL COHERENCE - Validate response makes sense in human conversation
   * Checks if the response logically follows from what the user said
   * Uses LLM to evaluate and regenerate if needed
   */
  private async validateConversationalCoherence(
    response: string,
    recentMessages: { role: string; content: string; timestamp?: Date }[],
    userMessage: string,
    lang: 'en' | 'fr'
  ): Promise<string> {
    // Get last 6 messages for context (3 exchanges)
    const contextMessages = recentMessages.slice(-6);

    // Build conversation history string
    const historyStr = contextMessages
      .map(m => `${m.role === 'user' ? (lang === 'en' ? 'User' : 'Utilisateur') : 'Mira'}: ${m.content}`)
      .join('\n');

    const validationPromptFr = `Tu es un expert en conversations humaines naturelles.

HISTORIQUE DE LA CONVERSATION:
${historyStr}

DERNIER MESSAGE DE L'UTILISATEUR:
"${userMessage}"

RÉPONSE PROPOSÉE PAR MIRA:
"${response}"

QUESTION: Est-ce que cette réponse fait sens dans le contexte de la conversation ?
Dans une discussion normale entre deux humains, est-ce que cette réponse serait logique et naturelle ?

Analyse spécifiquement:
1. La réponse répond-elle vraiment à ce que l'utilisateur vient de dire ?
2. Y a-t-il une déconnexion logique ? (ex: l'utilisateur pose une question et Mira parle d'autre chose)
3. Mira comprend-elle bien le sens de ce que dit l'utilisateur ?

Si la réponse est INCOHÉRENTE ou DÉCONNECTÉE du contexte:
- Réponds "INCOHÉRENT:" suivi d'une meilleure réponse

Si la réponse est COHÉRENTE et naturelle:
- Réponds "OK"

Exemples de problèmes à détecter:
- User dit "tu veux que je te raconte quoi ?" (demande de clarification) → Mira devrait clarifier, pas changer de sujet
- User corrige Mira → Mira devrait acknowledger la correction
- User pose une question directe → Mira devrait y répondre

Réponds uniquement "OK" ou "INCOHÉRENT: [nouvelle réponse]":`;

    const validationPromptEn = `You are an expert in natural human conversations.

CONVERSATION HISTORY:
${historyStr}

USER'S LAST MESSAGE:
"${userMessage}"

MIRA'S PROPOSED RESPONSE:
"${response}"

QUESTION: Does this response make sense in the context of the conversation?
In a normal discussion between two humans, would this response be logical and natural?

Specifically analyze:
1. Does the response actually address what the user just said?
2. Is there a logical disconnect? (e.g., user asks a question and Mira talks about something else)
3. Does Mira understand the meaning of what the user is saying?

If the response is INCOHERENT or DISCONNECTED from context:
- Reply "INCOHERENT:" followed by a better response

If the response is COHERENT and natural:
- Reply "OK"

Examples of problems to detect:
- User says "what do you want me to tell you?" (asking for clarification) → Mira should clarify, not change subject
- User corrects Mira → Mira should acknowledge the correction
- User asks a direct question → Mira should answer it

Reply only "OK" or "INCOHERENT: [new response]":`;

    try {
      const validation = await this.llmService.generate(
        lang === 'en' ? validationPromptEn : validationPromptFr,
        ''
      );

      const trimmedValidation = validation.trim();

      if (trimmedValidation.toUpperCase().startsWith('OK')) {
        console.log('[MessageService] ✅ Conversational coherence: OK');
        return response;
      }

      // Extract the new response
      const incoherentMatch = trimmedValidation.match(/INCOH[EÉ]RENT\s*:\s*(.+)/is);
      if (incoherentMatch && incoherentMatch[1]) {
        const newResponse = incoherentMatch[1].trim().replace(/^["']|["']$/g, '');
        console.log(`[MessageService] 🔄 Conversational coherence: Fixed incoherent response`);
        console.log(`[MessageService]    Original: "${response.slice(0, 50)}..."`);
        console.log(`[MessageService]    Fixed: "${newResponse.slice(0, 50)}..."`);

        // Validate the new response doesn't reveal AI
        const aiPatterns = [
          /je suis (une? )?(ia|robot)/i,
          /i('m| am) (an? )?(ai|robot)/i,
        ];
        if (aiPatterns.some(p => p.test(newResponse))) {
          console.log('[MessageService] ⚠️ New response reveals AI, keeping original');
          return response;
        }

        return newResponse;
      }

      // If we can't parse the response, keep original
      console.log('[MessageService] ⚠️ Could not parse coherence validation, keeping original');
      return response;

    } catch (error) {
      console.error('[MessageService] Error in conversational coherence check:', error);
      return response;
    }
  }

  /**
   * CONTEXT VALIDATION - Check memory, temporality, and repetitions
   * Runs up to 3 passes to ensure quality
   */
  private async validateContext(
    response: string,
    recentMessages: { role: string; content: string; timestamp?: Date }[],
    userMessage: string,
    userSummary: string | null,
    userActivities: { name: string; category?: string }[],
    lang: 'en' | 'fr'
  ): Promise<string> {
    // Build user knowledge from summary and activities
    const userKnowledge: UserKnowledge = {
      interests: userActivities.map(a => a.name),
      recentTopics: [],
    };

    // Extract job from summary if present
    if (userSummary) {
      const jobMatch = userSummary.match(/(?:travaille|works?|job|métier|boulot)[^.]*?(?:comme|as|en tant que|is a|:)\s*([^.,]+)/i);
      if (jobMatch) {
        userKnowledge.job = jobMatch[1].trim();
      }
      // Also check for SWE/developer patterns
      if (/swe|software engineer|développeur|dev\b|engineer|coder/i.test(userSummary)) {
        userKnowledge.job = userKnowledge.job || 'developer/engineer';
      }
    }

    // Extract recent topics from user messages
    const recentUserMsgs = recentMessages.filter(m => m.role === 'user').slice(-5);
    for (const msg of recentUserMsgs) {
      const content = msg.content.toLowerCase();
      if (/code|dev|swe|programming|tech/i.test(content)) {
        userKnowledge.recentTopics?.push('coding');
      }
      if (/kiff|love|adore|passion/i.test(content)) {
        userKnowledge.recentTopics?.push('positive-sentiment');
      }
    }

    // Convert messages to expected format
    const contextMessages: ConversationMessage[] = recentMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: m.timestamp,
    }));

    let currentResponse = response;
    const maxPasses = 3;

    for (let pass = 1; pass <= maxPasses; pass++) {
      // Validate current response
      const validation = contextValidator.validate(currentResponse, contextMessages, userKnowledge, lang);

      console.log(`[MessageService] 📋 Context Validation Pass ${pass}: confidence=${validation.confidence}%, issues=${validation.issues.length}`);

      // Apply format fixes immediately
      if (validation.fixedResponse) {
        currentResponse = validation.fixedResponse;
        console.log(`[MessageService]    Format fixed: removed quotes/formatting`);
      }

      // If no high-severity issues, we're done
      const highIssues = validation.issues.filter(i => i.severity === 'high');
      if (highIssues.length === 0) {
        if (validation.issues.length > 0) {
          console.log(`[MessageService]    Minor issues: ${validation.issues.map(i => i.type).join(', ')}`);
        }
        break;
      }

      // Log issues
      for (const issue of highIssues) {
        console.log(`[MessageService]    🔴 [${issue.type}] ${issue.description}`);
      }

      // Use LLM to fix high-severity issues
      const issuePrompt = contextValidator.buildFixPrompt(highIssues, lang);

      const fixPromptFr = `Tu es Mira, une amie naturelle.

MESSAGE DE L'UTILISATEUR: "${userMessage}"

TA RÉPONSE ACTUELLE: "${currentResponse}"

${issuePrompt}

CONTEXTE MÉMORISÉ:
${userKnowledge.job ? `- Métier: ${userKnowledge.job}` : '- Métier: inconnu'}
${userKnowledge.interests?.length ? `- Intérêts: ${userKnowledge.interests.join(', ')}` : ''}
${userKnowledge.recentTopics?.length ? `- Sujets récents: ${userKnowledge.recentTopics.join(', ')}` : ''}

RÈGLES:
1. NE PAS commencer par le même mot que les messages précédents
2. NE PAS poser de question sur quelque chose déjà mentionné
3. UTILISER le contexte mémorisé naturellement
4. Si l'utilisateur part, dire au revoir (pas poser de question)
5. PAS de guillemets autour de la réponse

Génère une réponse corrigée (1-2 phrases, naturelle):`;

      const fixPromptEn = `You are Mira, a natural friend.

USER MESSAGE: "${userMessage}"

YOUR CURRENT RESPONSE: "${currentResponse}"

${issuePrompt}

REMEMBERED CONTEXT:
${userKnowledge.job ? `- Job: ${userKnowledge.job}` : '- Job: unknown'}
${userKnowledge.interests?.length ? `- Interests: ${userKnowledge.interests.join(', ')}` : ''}
${userKnowledge.recentTopics?.length ? `- Recent topics: ${userKnowledge.recentTopics.join(', ')}` : ''}

RULES:
1. DON'T start with the same word as previous messages
2. DON'T ask about something already mentioned
3. USE the remembered context naturally
4. If user is leaving, say goodbye (don't ask questions)
5. NO quotes around the response

Generate a fixed response (1-2 sentences, natural):`;

      try {
        const fixed = await this.llmService.generate(
          lang === 'en' ? fixPromptEn : fixPromptFr,
          ''
        );

        let trimmed = fixed.trim();
        // Remove quotes if LLM added them
        if (/^["'«].*["'»]$/.test(trimmed)) {
          trimmed = trimmed.slice(1, -1);
        }

        // Verify fix is actually better
        const newValidation = contextValidator.validate(trimmed, contextMessages, userKnowledge, lang);
        const newHighIssues = newValidation.issues.filter(i => i.severity === 'high');

        if (newHighIssues.length < highIssues.length) {
          console.log(`[MessageService]    ✅ Fixed: ${highIssues.length} → ${newHighIssues.length} high issues`);
          currentResponse = trimmed;
        } else {
          console.log(`[MessageService]    ⚠️ Fix not better, keeping current`);
          break;
        }

      } catch (error) {
        console.error('[MessageService] Error in context validation:', error);
        break;
      }
    }

    return currentResponse;
  }

  /**
   * HUMANITY CHECK - Algorithmic detection of robotic patterns
   * Uses QuillBot/BERT-inspired heuristics for fast detection
   * Only calls LLM if algorithmic check fails (saves API calls)
   */
  private async validateHumanity(
    response: string,
    userMessage: string,
    lang: 'en' | 'fr'
  ): Promise<string> {
    // Step 1: Algorithmic humanity check (no API call)
    const humanityScore = humanDetector.analyzeHumanity(response, lang);

    console.log(`[MessageService] 🧠 Humanity Score: ${humanityScore.score}/100`);
    console.log(`[MessageService]    Details: lex=${humanityScore.details.lexicalDiversity}, struct=${humanityScore.details.structureVariety}, formal=${humanityScore.details.formalityScore}, emotion=${humanityScore.details.emotionalAuthenticity}, pattern=${humanityScore.details.patternScore}`);

    // If score is good (>= 60), response is human enough
    if (humanityScore.score >= 60) {
      console.log(`[MessageService] ✅ Humanity check passed`);
      return response;
    }

    // Step 2: Get specific robotic patterns found
    const foundPatterns = humanDetector.getFoundPatterns(response, lang);
    console.log(`[MessageService] 🤖 ROBOTIC (score: ${humanityScore.score}): "${response.slice(0, 60)}..."`);
    if (foundPatterns.length > 0) {
      console.log(`[MessageService]    Patterns: ${foundPatterns.join(', ')}`);
    }
    if (humanityScore.issues.length > 0) {
      console.log(`[MessageService]    Issues: ${humanityScore.issues.join(', ')}`);
    }

    // Step 3: Get suggested alternatives
    const alternatives = humanDetector.suggestHumanAlternatives(response, lang);
    let alternativesHint = '';
    if (alternatives.size > 0) {
      const hints: string[] = [];
      alternatives.forEach((alts, pattern) => {
        hints.push(`"${pattern}" → ${alts.slice(0, 2).join(' ou ')}`);
      });
      alternativesHint = `\nREMPLACEMENTS SUGGÉRÉS:\n${hints.join('\n')}`;
    }

    // Step 4: Use LLM to humanize (only if algorithmic check failed)
    const humanizePromptFr = `Tu es Mira, une amie dans la vraie vie, pas une IA.

L'utilisateur a dit: "${userMessage}"

Ta réponse sonne ROBOTIQUE (score: ${humanityScore.score}/100): "${response}"

PROBLÈMES DÉTECTÉS:
${humanityScore.issues.map(i => `- ${i}`).join('\n')}
${foundPatterns.length > 0 ? `\nPATTERNS IA TROUVÉS: ${foundPatterns.join(', ')}` : ''}
${alternativesHint}

Comment un VRAI ami répondrait ?
- Langage familier: "genre", "trop", "grave", "j'sais pas"
- Interjections: "haha", "euh", "bah", "ouais"
- Phrases courtes et naturelles
- Pas de formalités ni de politesses excessives

Génère une réponse HUMAINE (1-2 phrases max):`;

    const humanizePromptEn = `You are Mira, a friend in real life, NOT an AI.

The user said: "${userMessage}"

Your response sounds ROBOTIC (score: ${humanityScore.score}/100): "${response}"

ISSUES DETECTED:
${humanityScore.issues.map(i => `- ${i}`).join('\n')}
${foundPatterns.length > 0 ? `\nAI PATTERNS FOUND: ${foundPatterns.join(', ')}` : ''}
${alternativesHint}

How would a REAL friend respond?
- Casual language: "like", "totally", "kinda", "dunno"
- Interjections: "haha", "uh", "meh", "yeah"
- Short, natural sentences
- No formalities or excessive politeness

Generate a HUMAN response (1-2 sentences max):`;

    try {
      const humanized = await this.llmService.generate(
        lang === 'en' ? humanizePromptEn : humanizePromptFr,
        ''
      );

      const trimmed = humanized.trim().replace(/^["']|["']$/g, '');

      // Step 5: Verify the new response is actually better
      const newScore = humanDetector.analyzeHumanity(trimmed, lang);

      if (newScore.score < humanityScore.score) {
        console.log(`[MessageService] ⚠️ Humanized response not better (${newScore.score} < ${humanityScore.score}), keeping original`);
        return response;
      }

      // Verify it doesn't reveal AI
      const aiPatterns = [
        /je suis (une? )?(ia|robot)/i,
        /i('m| am) (an? )?(ai|robot)/i,
      ];
      if (aiPatterns.some(p => p.test(trimmed.toLowerCase()))) {
        console.log('[MessageService] ⚠️ Humanized response reveals AI, using fallback');
        return this.getHumanFallback(lang, userMessage);
      }

      // Still too robotic after LLM fix? Use fallback
      if (newScore.score < 40) {
        console.log(`[MessageService] ⚠️ Still too robotic (${newScore.score}), using fallback`);
        return this.getHumanFallback(lang, userMessage);
      }

      console.log(`[MessageService] ✅ Humanized: ${humanityScore.score} → ${newScore.score}`);
      return trimmed;

    } catch (error) {
      console.error('[MessageService] Error humanizing response:', error);
      return this.getHumanFallback(lang, userMessage);
    }
  }

  /**
   * Get a natural human fallback response
   */
  private getHumanFallback(lang: 'en' | 'fr', userMessage: string): string {
    const fallbacksFr = [
      "Attends quoi ? Redis-moi !",
      "Haha j'ai zappé, c'était quoi ?",
      "Euh attends j'ai loupé un truc",
      "Genre comment ça ?",
      "Ah mince j'ai pas capté",
      "Oups, redis-moi ?",
    ];

    const fallbacksEn = [
      "Wait what? Tell me again!",
      "Haha I missed that, what was it?",
      "Uh hold on I missed something",
      "Like how do you mean?",
      "Oh shoot I didn't catch that",
      "Oops, say that again?",
    ];

    const fallbacks = lang === 'en' ? fallbacksEn : fallbacksFr;
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  /**
   * DIALOGPT VALIDATION - Compare response against DialoGPT for naturalness
   * Uses French or English DialoGPT model depending on language
   */
  private async validateWithDialoGPT(
    response: string,
    recentMessages: { role: string; content: string; timestamp?: Date }[],
    userMessage: string,
    lang: 'en' | 'fr'
  ): Promise<string> {
    // Skip if DialoGPT service is not enabled
    if (!dialogptService.isEnabled()) {
      return response;
    }

    try {
      // Convert messages to DialoGPT format
      const conversationHistory: ConversationTurn[] = recentMessages
        .slice(-6)
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      // Validate response
      const validation = await dialogptService.validateResponse(
        response,
        conversationHistory,
        userMessage,
        lang
      );

      console.log(`[MessageService] 🤖 DialoGPT Validation: score=${validation.score}, natural=${validation.isNatural}`);

      if (validation.issues.length > 0) {
        console.log(`[MessageService]    Issues: ${validation.issues.join(', ')}`);
      }

      // If response is natural enough, keep it
      if (validation.isNatural || validation.score >= 60) {
        return response;
      }

      // If DialoGPT suggests an alternative and score is very low
      if (validation.suggestion && validation.score < 40) {
        console.log(`[MessageService]    DialoGPT suggests: "${validation.suggestion.slice(0, 50)}..."`);

        // Use LLM to blend DialoGPT suggestion with Mira's style
        const blendPromptFr = `Tu es Mira, une amie naturelle et authentique.

Ta réponse actuelle semble peu naturelle: "${response}"

Une IA conversationnelle suggère plutôt: "${validation.suggestion}"

PROBLÈMES DÉTECTÉS: ${validation.issues.join(', ')}

Génère une réponse qui:
1. Garde le sens de ta réponse originale
2. Adopte un ton plus naturel et décontracté
3. Reste courte (1-2 phrases)
4. Sonne comme un message WhatsApp entre amis

Nouvelle réponse:`;

        const blendPromptEn = `You are Mira, a natural and authentic friend.

Your current response seems unnatural: "${response}"

A conversational AI suggests instead: "${validation.suggestion}"

ISSUES DETECTED: ${validation.issues.join(', ')}

Generate a response that:
1. Keeps the meaning of your original response
2. Adopts a more natural and relaxed tone
3. Stays short (1-2 sentences)
4. Sounds like a WhatsApp message between friends

New response:`;

        const blended = await this.llmService.generate(
          lang === 'en' ? blendPromptEn : blendPromptFr,
          ''
        );

        const trimmed = blended.trim().replace(/^["']|["']$/g, '');

        // Verify blended response is better
        const newValidation = await dialogptService.validateResponse(
          trimmed,
          conversationHistory,
          userMessage,
          lang
        );

        if (newValidation.score > validation.score) {
          console.log(`[MessageService]    ✅ DialoGPT improved: ${validation.score} → ${newValidation.score}`);
          return trimmed;
        }
      }

      return response;

    } catch (error) {
      console.error('[MessageService] DialoGPT validation error:', error);
      return response;
    }
  }

  /**
   * LLM Validation Layer - Check response quality and fix if needed
   * This is an extra API call but ensures high quality responses
   * Supports both French and English
   */
  private async validateResponseWithLLM(
    response: string,
    previousResponses: PreviousResponse[],
    userMessage: string
  ): Promise<string> {
    // Detect language from user message
    const lang = this.detectLanguage(userMessage);

    // Get last 5 Mira responses for repetition check
    const recentMiraMessages = previousResponses.slice(-5).map(r => r.content);

    // Check for obvious repetitions first (save API call if not needed)
    const responseStart = response.toLowerCase().slice(0, 20);
    const hasRepetition = recentMiraMessages.some(msg =>
      msg.toLowerCase().startsWith(responseStart.slice(0, 10))
    );

    // Count "Ah ouais" / "Oh really" or similar patterns (language-aware)
    const starterPatterns = lang === 'en'
      ? ['oh really', 'oh ok', 'oh nice', 'oh cool', 'oh wow', 'that\'s']
      : ['ah ouais', 'ah ok', 'ah bon', 'oh'];

    const starterCount = recentMiraMessages.filter(msg => {
      const msgLower = msg.toLowerCase();
      return starterPatterns.some(pattern => msgLower.startsWith(pattern));
    }).length;

    // Count how many recent messages end with questions
    const recentQuestionCount = recentMiraMessages.filter(msg => msg.trim().endsWith('?')).length;
    const currentEndsWithQuestion = response.trim().endsWith('?');
    const tooManyQuestions = currentEndsWithQuestion && recentQuestionCount >= 2;

    // If no obvious issues, skip validation
    if (!hasRepetition && starterCount < 2 && !tooManyQuestions) {
      console.log('[MessageService] ✅ LLM Validation: No issues detected, skipping');
      return response;
    }

    const issuesFr: string[] = [];
    const issuesEn: string[] = [];

    if (hasRepetition) {
      issuesFr.push('répétition de début de phrase');
      issuesEn.push('repeating sentence starters');
    }
    if (starterCount >= 2) {
      issuesFr.push('trop de "Ah ouais/Oh"');
      issuesEn.push('too many "Oh really/Oh" starters');
    }
    if (tooManyQuestions) {
      issuesFr.push('trop de questions consécutives');
      issuesEn.push('too many consecutive questions');
    }

    const issues = lang === 'en' ? issuesEn : issuesFr;
    console.log(`[MessageService] 🔍 LLM Validation (${lang}): Issues detected: ${issues.join(', ')}`);

    const validationPromptFr = `Tu es un contrôleur qualité pour Mira, une IA conversationnelle.

RÉPONSE À VALIDER:
"${response}"

DERNIERS MESSAGES DE MIRA:
${recentMiraMessages.map((m, i) => `${i + 1}. "${m}"`).join('\n')}

MESSAGE DE L'UTILISATEUR:
"${userMessage}"

PROBLÈMES DÉTECTÉS: ${issuesFr.join(', ')}

RÈGLES:
1. NE PAS répéter les mêmes débuts de phrase
2. NE PAS poser de question si les 2 derniers messages finissaient par "?"
3. Parfois juste réagir/commenter sans relancer avec une question
4. Être naturelle, comme une vraie amie

EXEMPLES DE RÉPONSES SANS QUESTION:
- "Carrément, je comprends !"
- "Ouais c'est chaud ça..."
- "Haha trop bien !"
- "Grave, ça a l'air intense."

Génère une meilleure réponse (1-2 phrases, naturelle, PAS DE QUESTION si trop de questions récentes):`;

    const validationPromptEn = `You are a quality controller for Mira, a conversational AI.

RESPONSE TO VALIDATE:
"${response}"

MIRA'S RECENT MESSAGES:
${recentMiraMessages.map((m, i) => `${i + 1}. "${m}"`).join('\n')}

USER MESSAGE:
"${userMessage}"

ISSUES DETECTED: ${issuesEn.join(', ')}

RULES:
1. DON'T repeat the same sentence starters
2. DON'T ask a question if the last 2 messages ended with "?"
3. Sometimes just react/comment without asking a follow-up question
4. Be natural, like a real friend

EXAMPLES OF RESPONSES WITHOUT QUESTIONS:
- "Totally get that!"
- "Yeah that sounds intense..."
- "Haha that's awesome!"
- "For real, that's a lot."

Generate a better response (1-2 sentences, natural, NO QUESTION if too many recent questions):`;

    const validationPrompt = lang === 'en' ? validationPromptEn : validationPromptFr;

    // If too many questions, force no question
    const forceNoQuestion = tooManyQuestions;

    try {
      const validation = await this.llmService.generate(validationPrompt, '');
      let trimmedValidation = validation.trim();

      // Use the new response if it's reasonable
      if (trimmedValidation.length > 10 && trimmedValidation.length < 500) {
        // If still ends with question and we need to remove it, do so
        if (forceNoQuestion && trimmedValidation.endsWith('?')) {
          // Remove the question part (everything after last period/exclamation or the whole thing)
          const lastSentenceEnd = Math.max(
            trimmedValidation.lastIndexOf('.'),
            trimmedValidation.lastIndexOf('!')
          );
          if (lastSentenceEnd > 10) {
            trimmedValidation = trimmedValidation.slice(0, lastSentenceEnd + 1);
          } else {
            // Replace ? with ! to make it a statement
            trimmedValidation = trimmedValidation.slice(0, -1) + '!';
          }
        }
        console.log('[MessageService] 🔄 LLM Validation: Response improved');
        return trimmedValidation;
      }

      // If validation didn't help but we have too many questions, just remove the question
      if (forceNoQuestion && response.endsWith('?')) {
        const lastSentenceEnd = Math.max(response.lastIndexOf('.'), response.lastIndexOf('!'));
        if (lastSentenceEnd > 10) {
          console.log('[MessageService] 🔄 Removed trailing question');
          return response.slice(0, lastSentenceEnd + 1);
        }
      }

      return response;
    } catch (error) {
      console.error('[MessageService] ⚠️ LLM Validation failed:', error);
      return response;
    }
  }

  /**
   * Build memory recall context when user asks about previous conversation
   * Detects patterns like "tu te rappelles?" and extracts facts from recent messages
   */
  private buildMemoryRecallContext(
    userMessage: string,
    recentMessages: { role: string; content: string; timestamp?: Date }[],
    memories: { fact: string; category: string; daysSince: number; score: number }[],
    lang: 'en' | 'fr'
  ): string | null {
    const messageLower = userMessage.toLowerCase();

    // Patterns that indicate user is asking Mira to remember something
    const memoryRecallPatternsFr = [
      /tu (te )?rappell?es?\s*(pas|plus)?/i,
      /tu (ne )?te souviens?\s*(pas|plus)?/i,
      /on (a )?parl(é|ait) de quoi/i,
      /c'?(é|e)tait quoi (déjà|deja)/i,
      /tu (as )?oubli(é|e)/i,
      /j'?(ai|avais) dit quoi/i,
      /qu'?est[- ]ce (que )?j'?(ai|avais) dit/i,
      /(j'étais|je suis|je travaille|je bosse) sur quoi/i,
      /je (faisais|fais) quoi/i,
      /c'était quoi (mon|le) (taff|travail|projet|truc)/i,
      /tu sais (plus )?ce que/i,
      /rappelle[- ]toi/i,
    ];

    const memoryRecallPatternsEn = [
      /do you remember/i,
      /don'?t you remember/i,
      /what (did )?we (talk|speak) about/i,
      /what was (it|that) again/i,
      /did you forget/i,
      /what did i (say|tell you)/i,
      /what (was|am) i working on/i,
      /what (was|am) i doing/i,
      /what was my (work|project|thing)/i,
      /you (still )?know what/i,
      /remember when/i,
    ];

    const patterns = lang === 'en' ? memoryRecallPatternsEn : memoryRecallPatternsFr;
    const isMemoryRecallQuery = patterns.some(p => p.test(messageLower));

    if (!isMemoryRecallQuery) {
      return null;
    }

    // Extract key facts from recent user messages
    const userMessages = recentMessages
      .filter(m => m.role === 'user')
      .map(m => m.content);

    // Look for work/project mentions
    const workPatterns = [
      // French
      /(?:je (?:bosse|travaille|suis|fais) (?:sur|en|dans|comme)?)\s*[:"']?([^.!?,\n]+)/gi,
      /(?:mon (?:taff|travail|projet|boulot|job))[:\s]+([^.!?,\n]+)/gi,
      /(?:projet (?:sur|de|pour))\s+([^.!?,\n]+)/gi,
      /(?:je (?:dev|développe|code))\s*([^.!?,\n]+)/gi,
      /(?:je fais (?:du|de la|des?))\s*([^.!?,\n]+)/gi,
      // English
      /(?:i(?:'m| am)? (?:working|coding|developing|doing))\s*(?:on)?\s*[:"']?([^.!?,\n]+)/gi,
      /(?:my (?:work|project|job|task))[:\s]+([^.!?,\n]+)/gi,
      /(?:project (?:on|for|about))\s+([^.!?,\n]+)/gi,
    ];

    const extractedFacts: string[] = [];

    // Extract from recent user messages
    for (const msg of userMessages.slice(-10)) {
      for (const pattern of workPatterns) {
        const matches = msg.matchAll(pattern);
        for (const match of matches) {
          if (match[1] && match[1].trim().length > 3) {
            const fact = match[1].trim()
              .replace(/^["'«]|["'»]$/g, '')
              .replace(/\s+/g, ' ')
              .slice(0, 100);
            if (fact && !extractedFacts.includes(fact)) {
              extractedFacts.push(fact);
            }
          }
        }
      }
    }

    // Also look for AI/code/tech mentions
    const techKeywords = [
      'ia', 'ai', 'intelligence artificielle', 'machine learning', 'ml',
      'code', 'dev', 'développement', 'programming', 'software',
      'api', 'app', 'application', 'site', 'website', 'web',
      'chatbot', 'bot', 'gpt', 'llm', 'model', 'modèle',
      'startup', 'projet', 'project', 'product', 'produit',
    ];

    for (const msg of userMessages.slice(-10)) {
      const msgLower = msg.toLowerCase();
      for (const keyword of techKeywords) {
        if (msgLower.includes(keyword)) {
          // Extract the sentence containing the keyword
          const sentences = msg.split(/[.!?]+/);
          for (const sentence of sentences) {
            if (sentence.toLowerCase().includes(keyword) && sentence.trim().length > 10) {
              const fact = sentence.trim().slice(0, 150);
              if (!extractedFacts.some(f => f.includes(fact) || fact.includes(f))) {
                extractedFacts.push(fact);
              }
            }
          }
          break;
        }
      }
    }

    // Add facts from retrieved memories
    for (const memory of memories.slice(0, 3)) {
      if (!extractedFacts.some(f => f.includes(memory.fact) || memory.fact.includes(f))) {
        extractedFacts.push(memory.fact);
      }
    }

    // If we found no facts, still acknowledge the recall attempt
    if (extractedFacts.length === 0) {
      // Check the conversation for any context clues
      const conversationContext = recentMessages.slice(-15).map(m => m.content).join(' ');

      if (lang === 'en') {
        return `\n\n### MEMORY RECALL REQUEST
The user is asking you to remember something from the conversation.
Recent conversation context: "${conversationContext.slice(0, 500)}"

CRITICAL: DO NOT say you don't have this information or ask them to remind you.
Instead, review what was discussed and summarize it naturally.
If you genuinely cannot find relevant info, acknowledge you might have missed something and ask them to elaborate.`;
      } else {
        return `\n\n### DEMANDE DE RAPPEL MÉMOIRE
L'utilisateur te demande de te souvenir de quelque chose de la conversation.
Contexte de la conversation récente: "${conversationContext.slice(0, 500)}"

CRITIQUE: NE DIS PAS que tu n'as pas cette information ou demande de te le rappeler.
Au lieu de cela, revois ce qui a été discuté et résume-le naturellement.
Si tu ne trouves vraiment pas d'info pertinente, reconnais que tu as peut-être raté quelque chose et demande des précisions.`;
      }
    }

    // Build the context injection
    if (lang === 'en') {
      return `\n\n### MEMORY RECALL - CRITICAL CONTEXT
The user is asking you to remember what was discussed. You MUST use this information:

FACTS FROM THE CONVERSATION:
${extractedFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}

INSTRUCTIONS:
1. ACKNOWLEDGE that you remember - say something like "Oh yeah!" or "Right, right!"
2. REFERENCE the specific facts above naturally
3. DO NOT say "I don't have that information" or "Can you remind me?"
4. Show that you were paying attention to the conversation

Example response if user asks "what was I working on?":
"Oh yeah! You were working on ${extractedFacts[0] || 'that project'}, right?"`;
    } else {
      return `\n\n### RAPPEL MÉMOIRE - CONTEXTE CRITIQUE
L'utilisateur te demande de te rappeler ce dont on a parlé. Tu DOIS utiliser ces informations:

FAITS DE LA CONVERSATION:
${extractedFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}

INSTRUCTIONS:
1. RECONNAIS que tu te souviens - dis quelque chose comme "Ah oui !" ou "Attends, si si !"
2. RÉFÉRENCE les faits ci-dessus naturellement
3. NE DIS PAS "Je n'ai pas cette information" ou "Tu peux me rappeler ?"
4. Montre que tu as suivi la conversation

Exemple de réponse si l'utilisateur demande "j'étais sur quoi comme taff ?":
"Ah oui ! Tu bossais sur ${extractedFacts[0] || 'ton projet'}, non ?"`;
    }
  }

  /**
   * Maybe add an emoji - ONLY when it makes sense
   * Based on sentiment + punctuation, not random chance
   */
  private maybeAddEmoji(response: string, sentiment: string): string {
    // Skip if response already has emojis
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
    if (emojiRegex.test(response)) {
      return response;
    }

    const trimmed = response.trim();
    const endsWithExclamation = trimmed.endsWith('!');
    const endsWithQuestion = trimmed.endsWith('?');
    const isPositive = sentiment === 'positive' || sentiment === 'excited';
    const isShort = trimmed.length < 100;

    // Only add emoji if:
    // 1. Positive sentiment + ends with ! or ?
    // 2. Very short enthusiastic response
    const shouldAddEmoji =
      (isPositive && (endsWithExclamation || endsWithQuestion)) ||
      (isShort && endsWithExclamation && Math.random() < 0.5);

    if (!shouldAddEmoji) {
      return response;
    }

    // Pick contextual emoji based on sentiment
    let emojiPool: string[];
    if (sentiment === 'excited') {
      emojiPool = ['🔥', '✨', '🎉', '💪'];
    } else if (endsWithQuestion) {
      emojiPool = ['🤔', '😊', ''];  // Empty string = no emoji sometimes
    } else {
      emojiPool = ['😊', '🙂', '✨', ''];
    }

    const emoji = emojiPool[Math.floor(Math.random() * emojiPool.length)];
    if (!emoji) return response;

    return trimmed + ' ' + emoji;
  }
}
