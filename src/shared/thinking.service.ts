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
    ];

    for (const phrase of roboticPhrases) {
      if (responseLower.includes(phrase)) {
        issues.push(`Phrase robotique détectée: "${phrase}"`);
        shouldRegenerate = true;
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
