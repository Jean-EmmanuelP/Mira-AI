/**
 * ResponseValidatorService - Uses AI to validate that Mira's responses make sense
 *
 * This service adds an AI layer that reviews Mira's response before sending it,
 * checking for logical issues, hallucinations, and context mismatches.
 */

import { LLMService } from './llm.service';

export interface ValidationCheck {
  name: string;
  passed: boolean;
  issue?: string;
}

export interface AIValidationResult {
  isValid: boolean;
  checks: ValidationCheck[];
  suggestedFix?: string;
  shouldRegenerate: boolean;
}

export class ResponseValidatorService {
  private llmService: LLMService | null = null;

  /**
   * Get LLM service lazily (only when needed, after dotenv is loaded)
   */
  private getLLMService(): LLMService {
    if (!this.llmService) {
      this.llmService = new LLMService();
    }
    return this.llmService;
  }

  /**
   * Use AI to validate that the response makes sense given the conversation context
   */
  async validateWithAI(
    response: string,
    userMessage: string,
    recentMessages: { role: string; content: string }[],
    isFirstConversation: boolean
  ): Promise<AIValidationResult> {
    // Build conversation history for context
    const conversationHistory = recentMessages
      .slice(-10) // Last 10 messages
      .map((m) => `${m.role === 'user' ? 'USER' : 'MIRA'}: ${m.content}`)
      .join('\n');

    const validationPrompt = `Tu es un expert en validation de conversations IA. Analyse si la réponse de MIRA fait sens dans le contexte.

CONTEXTE DE LA CONVERSATION:
${conversationHistory || '(Début de conversation)'}

MESSAGE DE L'UTILISATEUR:
USER: ${userMessage}

RÉPONSE DE MIRA À VALIDER:
MIRA: ${response}

PREMIÈRE CONVERSATION: ${isFirstConversation ? 'OUI' : 'NON'}

Vérifie ces points:

1. COHÉRENCE: La réponse répond-elle à ce que l'utilisateur a dit?
2. MÉMOIRE: Mira confond-elle ses propres mots avec ceux de l'utilisateur?
3. RÉPÉTITION: Mira repose-t-elle une question qu'elle a déjà posée?
4. HALLUCINATION: Mira invente-t-elle des souvenirs ou expériences qu'elle n'a pas?
5. LOGIQUE: La réponse est-elle logique et fait-elle sens?
6. NATUREL: La réponse sonne-t-elle naturelle et humaine?

Réponds STRICTEMENT dans ce format JSON:
{
  "valid": true/false,
  "checks": [
    {"name": "COHERENCE", "passed": true/false, "issue": "description si problème"},
    {"name": "MEMOIRE", "passed": true/false, "issue": "description si problème"},
    {"name": "REPETITION", "passed": true/false, "issue": "description si problème"},
    {"name": "HALLUCINATION", "passed": true/false, "issue": "description si problème"},
    {"name": "LOGIQUE", "passed": true/false, "issue": "description si problème"},
    {"name": "NATUREL", "passed": true/false, "issue": "description si problème"}
  ],
  "fix": "suggestion de correction si invalide, sinon null",
  "regenerate": true/false
}`;

    try {
      const result = await this.getLLMService().generate('', validationPrompt);

      // Parse JSON response
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log('[ResponseValidator] Could not parse AI validation response');
        return this.defaultValidResult();
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const checks: ValidationCheck[] = (parsed.checks || []).map((c: any) => ({
        name: c.name,
        passed: c.passed,
        issue: c.issue,
      }));

      return {
        isValid: parsed.valid === true,
        checks,
        suggestedFix: parsed.fix || undefined,
        shouldRegenerate: parsed.regenerate === true,
      };
    } catch (error) {
      console.log('[ResponseValidator] AI validation error:', error);
      return this.defaultValidResult();
    }
  }

  /**
   * Generate a corrected response based on validation feedback
   */
  async regenerateResponse(
    originalResponse: string,
    validationResult: AIValidationResult,
    userMessage: string,
    systemPrompt: string
  ): Promise<string> {
    const failedChecks = validationResult.checks
      .filter((c) => !c.passed)
      .map((c) => `- ${c.name}: ${c.issue}`)
      .join('\n');

    const regeneratePrompt = `${systemPrompt}

⚠️ ATTENTION: Ta réponse précédente a été rejetée par le validateur.

RÉPONSE REJETÉE: "${originalResponse}"

PROBLÈMES DÉTECTÉS:
${failedChecks}

${validationResult.suggestedFix ? `SUGGESTION: ${validationResult.suggestedFix}` : ''}

Génère une nouvelle réponse qui corrige ces problèmes tout en restant naturelle et engageante.
Réponds UNIQUEMENT avec la nouvelle réponse, sans explication.`;

    const newResponse = await this.getLLMService().generate(regeneratePrompt, userMessage);
    return newResponse.trim();
  }

  /**
   * Quick heuristic checks (fast, no API call)
   */
  quickCheck(
    response: string,
    userMessage: string,
    recentMessages: { role: string; content: string }[]
  ): { passed: boolean; issues: string[] } {
    const issues: string[] = [];
    const responseLower = response.toLowerCase();
    const userMessageLower = userMessage.toLowerCase();

    // Check 1: Response is not empty
    if (response.trim().length < 5) {
      issues.push('Réponse trop courte');
    }

    // Check 2: Not repeating user's exact words back
    if (
      userMessage.length > 20 &&
      responseLower.includes(userMessageLower.substring(0, 30))
    ) {
      issues.push('Réponse répète les mots de l\'utilisateur');
    }

    // Check 3: Not asking what the user just explained
    const lastMiraMessage = recentMessages
      .filter((m) => m.role === 'assistant')
      .pop();

    if (lastMiraMessage) {
      // Check if Mira asked a question and user answered, but Mira asks the same thing
      const lastMiraQuestions = lastMiraMessage.content.match(/[^.!]*\?/g) || [];
      const currentQuestions = response.match(/[^.!]*\?/g) || [];

      for (const currentQ of currentQuestions) {
        for (const lastQ of lastMiraQuestions) {
          if (this.isSimilarQuestion(currentQ, lastQ)) {
            issues.push(`Répétition de question: "${currentQ.trim()}"`);
            break;
          }
        }
      }
    }

    // Check 4: Not saying "quand tu dis X" when X was said by Mira
    const miraMessages = recentMessages
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content.toLowerCase());

    const userMessages = recentMessages
      .filter((m) => m.role === 'user')
      .map((m) => m.content.toLowerCase());

    const quotePattern = /quand tu (?:dis|disais|parles de)[^?]*["«]([^"»]+)["»]/gi;
    let match;
    while ((match = quotePattern.exec(response)) !== null) {
      const quotedPhrase = match[1].toLowerCase().trim();
      if (quotedPhrase.length > 5) {
        const miraUsedIt = miraMessages.some((m) => m.includes(quotedPhrase));
        const userUsedIt = userMessages.some((m) => m.includes(quotedPhrase));

        if (miraUsedIt && !userUsedIt) {
          issues.push(`Mira attribue ses propres mots à l'utilisateur: "${quotedPhrase}"`);
        }
      }
    }

    return {
      passed: issues.length === 0,
      issues,
    };
  }

  /**
   * Check if two questions are semantically similar
   */
  private isSimilarQuestion(q1: string, q2: string): boolean {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[?!.,]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 3);

    const words1 = new Set(normalize(q1));
    const words2 = new Set(normalize(q2));

    if (words1.size === 0 || words2.size === 0) return false;

    let matches = 0;
    for (const word of words1) {
      if (words2.has(word)) matches++;
    }

    const similarity = matches / Math.max(words1.size, words2.size);
    return similarity > 0.6;
  }

  /**
   * Default valid result (when validation fails or is skipped)
   */
  private defaultValidResult(): AIValidationResult {
    return {
      isValid: true,
      checks: [],
      shouldRegenerate: false,
    };
  }
}

export const responseValidator = new ResponseValidatorService();
