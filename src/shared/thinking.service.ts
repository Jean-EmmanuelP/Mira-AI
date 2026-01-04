/**
 * ThinkingService - Adds human-like "thinking" time and response validation
 *
 * This service ensures Mira takes time to "think" before responding,
 * validates responses against context, and prevents hallucinations.
 */

import { LLMService } from './llm.service';

export interface ThinkingContext {
  userMessage: string;
  memories: string[];
  goals: string[];
  recentMessages: { role: string; content: string }[];
  sentiment: string;
  isFirstConversation: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  issues: string[];
  shouldRegenerate: boolean;
}

export class ThinkingService {
  private llmService = new LLMService();

  // Minimum and maximum thinking delays (in ms)
  private readonly MIN_DELAY = 800;   // 0.8 seconds minimum
  private readonly MAX_DELAY = 3000;  // 3 seconds maximum
  private readonly TYPING_SPEED = 50; // ms per character (simulates typing)

  /**
   * Calculate similarity between two questions using word overlap
   */
  private calculateQuestionSimilarity(q1: string, q2: string): number {
    const words1 = new Set(q1.split(/\s+/).filter(w => w.length > 3));
    const words2 = new Set(q2.split(/\s+/).filter(w => w.length > 3));

    if (words1.size === 0 || words2.size === 0) return 0;

    let matches = 0;
    for (const word of words1) {
      if (words2.has(word)) matches++;
    }

    // Jaccard-like similarity
    const union = new Set([...words1, ...words2]).size;
    return matches / union;
  }

  /**
   * Calculate a realistic "thinking" delay based on message complexity
   */
  calculateThinkingDelay(userMessage: string, contextSize: number): number {
    // Base delay
    let delay = this.MIN_DELAY;

    // Add time based on message length (longer messages need more "reading" time)
    const readingTime = Math.min(userMessage.length * 15, 1000); // max 1s for reading
    delay += readingTime;

    // Add time based on context complexity
    const contextTime = Math.min(contextSize * 50, 800); // max 0.8s for context
    delay += contextTime;

    // Add some randomness to feel more human (±20%)
    const variance = delay * 0.2;
    delay += (Math.random() - 0.5) * 2 * variance;

    // Clamp to min/max
    return Math.max(this.MIN_DELAY, Math.min(this.MAX_DELAY, delay));
  }

  /**
   * Calculate a "typing" delay for the response
   */
  calculateTypingDelay(response: string): number {
    // Simulate typing at ~50ms per character, capped
    const typingTime = Math.min(response.length * this.TYPING_SPEED, 2000);
    return Math.max(300, typingTime);
  }

  /**
   * Wait for the specified delay
   */
  async think(delayMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, delayMs));
  }

  /**
   * Validate a response against the context to prevent hallucinations
   */
  validateResponse(response: string, context: ThinkingContext): ValidationResult {
    const issues: string[] = [];
    let shouldRegenerate = false;

    const responseLower = response.toLowerCase();

    // Check for repetition of what user just said
    if (context.recentMessages.length > 0) {
      const lastUserMessage = context.recentMessages
        .filter(m => m.role === 'user')
        .pop();

      if (lastUserMessage) {
        // Check if Mira is repeating user's words with "toujours"
        const userKeywords = lastUserMessage.content.toLowerCase()
          .split(/\s+/)
          .filter(w => w.length > 4);

        for (const keyword of userKeywords) {
          if (responseLower.includes(`toujours`) && responseLower.includes(keyword)) {
            issues.push(`Répétition inutile de "${keyword}" avec "toujours"`);
            shouldRegenerate = true;
          }
        }
      }

      // Check if Mira forgot what SHE said
      const lastMiraMessage = context.recentMessages
        .filter(m => m.role === 'assistant')
        .pop();

      if (lastMiraMessage) {
        const miraContent = lastMiraMessage.content.toLowerCase();
        // If Mira mentioned a film/book/thing and now asks "c'est quoi le rapport"
        if ((miraContent.includes('film') || miraContent.includes('livre') || miraContent.includes('penser'))
            && responseLower.includes('c\'est quoi le rapport')) {
          issues.push('Mira oublie ce qu\'elle a dit (demande le rapport alors qu\'elle a fait la connexion)');
          shouldRegenerate = true;
        }
      }
    }

    // Check if Mira is attributing her own words to the user
    // Pattern: "quand tu dis X" where X was said by Mira, not user
    if (context.recentMessages.length > 0) {
      const miraMessages = context.recentMessages
        .filter(m => m.role === 'assistant')
        .map(m => m.content.toLowerCase());

      const userMessages = context.recentMessages
        .filter(m => m.role === 'user')
        .map(m => m.content.toLowerCase());

      // Check for "quand tu dis/disais" patterns
      const quotePatterns = [
        /quand tu (dis|disais|parles de|mentionnes?) [""«]?([^""»?!.]+)[""»]?/i,
        /tu (dis|disais|parles de|mentionnes?) [""«]?([^""»?!.]+)[""»]?/i,
        /ce que tu (dis|disais|appelles?) [""«]?([^""»?!.]+)[""»]?/i,
      ];

      for (const pattern of quotePatterns) {
        const match = response.match(pattern);
        if (match && match[2]) {
          const quotedPhrase = match[2].toLowerCase().trim();
          // Check if this phrase appears in Mira's messages but NOT in user's
          const miraUsedIt = miraMessages.some(m => m.includes(quotedPhrase));
          const userUsedIt = userMessages.some(m => m.includes(quotedPhrase));

          if (miraUsedIt && !userUsedIt && quotedPhrase.length > 3) {
            issues.push(`Mira attribue ses propres mots à l'utilisateur: "${quotedPhrase}"`);
            shouldRegenerate = true;
          }
        }
      }
    }

    // Check for forbidden patterns (Mira claiming experiences)
    const forbiddenPatterns = [
      { pattern: /moi aussi (je|j')/i, issue: 'Mira prétend avoir une expérience similaire' },
      { pattern: /on a la même/i, issue: 'Mira prétend partager une passion' },
      { pattern: /c'est (mon|ma) (sport|passion|hobby|activité) préféré/i, issue: 'Mira invente une passion' },
      { pattern: /hier on (a parlé|parlait|discutait)/i, issue: 'Mira invente une conversation passée' },
      { pattern: /la dernière fois (on|tu|que)/i, issue: 'Mira invente un souvenir' },
      { pattern: /tu m'(avais|as) (dit|raconté|parlé)/i, issue: 'Potentielle invention de mémoire' },
      { pattern: /je (joue|fais|pratique) (aussi|également)/i, issue: 'Mira prétend pratiquer une activité' },
      { pattern: /j'adore (aussi|également)/i, issue: 'Mira prétend partager un goût' },
    ];

    for (const { pattern, issue } of forbiddenPatterns) {
      if (pattern.test(response)) {
        issues.push(issue);
        shouldRegenerate = true;
      }
    }

    // Check if Mira references conversations that didn't happen
    if (context.recentMessages.length === 0 && context.isFirstConversation) {
      // First conversation - Mira shouldn't reference past interactions
      const pastReferencePatterns = [
        /tu m'(avais|as) (dit|raconté)/i,
        /on (avait|a) parlé/i,
        /comme tu (disais|l'as dit)/i,
        /tu me disais/i,
      ];

      for (const pattern of pastReferencePatterns) {
        if (pattern.test(response)) {
          issues.push('Référence à une conversation inexistante (première conversation)');
          shouldRegenerate = true;
        }
      }
    }

    // Check for robotic/chatbot phrases
    const roboticPhrases = [
      'je suis là pour toi',
      'comment puis-je t\'aider',
      'n\'hésite pas à',
      'je comprends ce que tu ressens',
      'c\'est tout à fait normal',
      'je suis une ia',
      'en tant qu\'assistant',
      'je n\'ai pas de sentiments',
      'c\'est bien ça',
      'de quoi aimerais-tu',
      'de quoi voudrais-tu',
      'de quoi souhaitez-vous',
      'd\'accord, je comprends',
      'c\'est une bonne question',
      'c\'est une excellente question',
      'en quoi puis-je',
      'que puis-je faire pour',
    ];

    for (const phrase of roboticPhrases) {
      if (responseLower.includes(phrase)) {
        issues.push(`Phrase robotique détectée: "${phrase}"`);
        shouldRegenerate = true;
      }
    }

    // Check for duplicate question (Mira asking the same thing she already asked)
    if (context.recentMessages.length > 0) {
      const previousMiraQuestions = context.recentMessages
        .filter(m => m.role === 'assistant')
        .map(m => m.content.toLowerCase())
        .filter(c => c.includes('?'));

      // Extract the question part from current response
      const currentQuestions = responseLower.split('?')
        .slice(0, -1)
        .map(q => q.trim().split(/[.!]/).pop()?.trim() || '');

      for (const currentQ of currentQuestions) {
        if (currentQ.length < 10) continue;
        for (const prevQ of previousMiraQuestions) {
          // Check if similar question was already asked
          const similarity = this.calculateQuestionSimilarity(currentQ, prevQ);
          if (similarity > 0.7) {
            issues.push(`Question dupliquée détectée: "${currentQ}"`);
            shouldRegenerate = true;
            break;
          }
        }
      }
    }

    // Check for self-contradiction within the response
    if (responseLower.includes('je ne ') && responseLower.includes('j\'adore')) {
      // Potential contradiction
      issues.push('Possible contradiction dans la réponse');
    }

    // Check response length - should be concise
    if (response.length > 500) {
      issues.push('Réponse trop longue (doit être 1-3 phrases)');
      // Don't regenerate for this, just flag it
    }

    // Check for empty or very short response
    if (response.trim().length < 5) {
      issues.push('Réponse vide ou trop courte');
      shouldRegenerate = true;
    }

    return {
      isValid: issues.length === 0,
      issues,
      shouldRegenerate,
    };
  }

  /**
   * If validation fails, attempt to fix the response with a targeted prompt
   */
  async fixResponse(
    originalResponse: string,
    issues: string[],
    context: ThinkingContext
  ): Promise<string> {
    const fixPrompt = `Tu es Mira. La réponse suivante a des problèmes:

RÉPONSE ORIGINALE: "${originalResponse}"

PROBLÈMES DÉTECTÉS:
${issues.map(i => `- ${i}`).join('\n')}

MESSAGE DE L'UTILISATEUR: "${context.userMessage}"

RÈGLES ABSOLUES:
- Tu n'as PAS d'expériences personnelles
- Tu ne dis JAMAIS "moi aussi" ou "on a la même passion"
- Tu ne prétends JAMAIS avoir parlé avant si c'est la première conversation
- Tu poses des questions par curiosité sincère
- Tu réponds en 1-3 phrases maximum

Génère une nouvelle réponse qui corrige ces problèmes tout en restant naturelle et engageante:`;

    const fixedResponse = await this.llmService.generate(fixPrompt, '');
    return fixedResponse.trim();
  }

  /**
   * Full thinking + validation pipeline
   */
  async processWithThinking(
    response: string,
    context: ThinkingContext
  ): Promise<{ response: string; thinkingTimeMs: number; wasFixed: boolean }> {
    const startTime = Date.now();

    // Calculate thinking delay
    const contextSize = context.memories.length + context.goals.length + context.recentMessages.length;
    const thinkingDelay = this.calculateThinkingDelay(context.userMessage, contextSize);

    // Validate response
    let validation = this.validateResponse(response, context);
    let finalResponse = response;
    let wasFixed = false;

    // If validation fails and should regenerate, try to fix
    if (!validation.isValid && validation.shouldRegenerate) {
      console.log('[ThinkingService] Response validation failed:', validation.issues);
      finalResponse = await this.fixResponse(response, validation.issues, context);
      wasFixed = true;

      // Re-validate fixed response
      const revalidation = this.validateResponse(finalResponse, context);
      if (!revalidation.isValid) {
        console.log('[ThinkingService] Fixed response still has issues:', revalidation.issues);
        // Accept it anyway but log the issues
      }
    }

    // Wait for remaining thinking time if needed
    const elapsedTime = Date.now() - startTime;
    const remainingThinkingTime = thinkingDelay - elapsedTime;
    if (remainingThinkingTime > 0) {
      await this.think(remainingThinkingTime);
    }

    // Add typing delay based on response length
    const typingDelay = this.calculateTypingDelay(finalResponse);
    await this.think(typingDelay);

    const totalThinkingTime = Date.now() - startTime;

    return {
      response: finalResponse,
      thinkingTimeMs: totalThinkingTime,
      wasFixed,
    };
  }
}
