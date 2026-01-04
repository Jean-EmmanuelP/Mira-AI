/**
 * DialoGPT Service
 *
 * Uses Hugging Face Inference API to run DialoGPT models for conversational validation.
 * - French: emil2000/dialogpt-for-french-language (fine-tuned on 36k French conversations)
 * - English: microsoft/DialoGPT-medium (trained on 147M Reddit conversations)
 *
 * Used as an additional validation layer to check if responses sound natural
 * in a conversational context.
 */

import { HfInference } from '@huggingface/inference';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface DialoGPTResponse {
  generatedText: string;
  isNatural: boolean;
  confidence: number;
  alternativeSuggestion?: string;
}

export class DialoGPTService {
  private hf: HfInference | null = null;
  private enabled: boolean = false;

  // Model IDs
  private readonly FRENCH_MODEL = 'emil2000/dialogpt-for-french-language';
  private readonly ENGLISH_MODEL = 'microsoft/DialoGPT-medium';

  constructor() {
    const apiKey = process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;

    if (apiKey) {
      this.hf = new HfInference(apiKey);
      this.enabled = true;
      console.log('🤖 DialoGPT Service enabled (Hugging Face Inference API)');
    } else {
      console.log('⚠️ DialoGPT Service disabled (no HUGGINGFACE_API_KEY or HF_TOKEN)');
    }
  }

  /**
   * Check if service is enabled
   */
  isEnabled(): boolean {
    return this.enabled && this.hf !== null;
  }

  /**
   * Generate a conversational response using DialoGPT
   * Used to compare against Mira's response for naturalness validation
   */
  async generateResponse(
    conversationHistory: ConversationTurn[],
    lang: 'en' | 'fr' = 'fr'
  ): Promise<string | null> {
    if (!this.isEnabled()) return null;

    try {
      const model = lang === 'fr' ? this.FRENCH_MODEL : this.ENGLISH_MODEL;

      // Build conversation context in DialoGPT format
      // DialoGPT uses <|endoftext|> as separator
      const contextParts: string[] = [];
      for (const turn of conversationHistory.slice(-6)) { // Last 6 turns for context
        contextParts.push(turn.content);
      }
      const prompt = contextParts.join('<|endoftext|>') + '<|endoftext|>';

      const response = await this.hf!.textGeneration({
        model,
        inputs: prompt,
        parameters: {
          max_new_tokens: 100,
          temperature: 0.7,
          top_p: 0.9,
          do_sample: true,
          return_full_text: false,
        },
      });

      // Clean up the response
      let generated = response.generated_text || '';
      // Remove end of text tokens and clean up
      generated = generated.split('<|endoftext|>')[0].trim();
      generated = generated.replace(/^\s*[-–—]\s*/, ''); // Remove leading dashes

      return generated || null;

    } catch (error: any) {
      console.warn('[DialoGPT] Generation error:', error.message);
      return null;
    }
  }

  /**
   * Score how natural a response is in conversational context
   * Compares Mira's response style against DialoGPT patterns
   */
  async scoreNaturalness(
    miraResponse: string,
    conversationHistory: ConversationTurn[],
    userMessage: string,
    lang: 'en' | 'fr' = 'fr'
  ): Promise<DialoGPTResponse> {
    if (!this.isEnabled()) {
      return {
        generatedText: '',
        isNatural: true, // Assume natural if service not available
        confidence: 50,
      };
    }

    try {
      // Generate what DialoGPT would say
      const historyWithUser = [
        ...conversationHistory,
        { role: 'user' as const, content: userMessage },
      ];

      const dialogptResponse = await this.generateResponse(historyWithUser, lang);

      if (!dialogptResponse) {
        return {
          generatedText: '',
          isNatural: true,
          confidence: 50,
        };
      }

      // Compare responses for naturalness
      const analysis = this.compareResponses(miraResponse, dialogptResponse, lang);

      return {
        generatedText: dialogptResponse,
        isNatural: analysis.score >= 60,
        confidence: analysis.score,
        alternativeSuggestion: analysis.score < 50 ? dialogptResponse : undefined,
      };

    } catch (error: any) {
      console.warn('[DialoGPT] Scoring error:', error.message);
      return {
        generatedText: '',
        isNatural: true,
        confidence: 50,
      };
    }
  }

  /**
   * Compare Mira's response to DialoGPT's for style similarity
   */
  private compareResponses(
    miraResponse: string,
    dialogptResponse: string,
    lang: 'en' | 'fr'
  ): { score: number; issues: string[] } {
    const issues: string[] = [];
    let score = 70; // Start with neutral score

    const miraLower = miraResponse.toLowerCase();
    const dialogptLower = dialogptResponse.toLowerCase();

    // Check 1: Length similarity
    const miraWords = miraResponse.split(/\s+/).length;
    const dialogptWords = dialogptResponse.split(/\s+/).length;
    const lengthRatio = Math.min(miraWords, dialogptWords) / Math.max(miraWords, dialogptWords);

    if (lengthRatio < 0.3) {
      // Very different lengths - might indicate unnatural response
      if (miraWords > dialogptWords * 3) {
        issues.push(lang === 'en' ? 'Response much longer than typical' : 'Réponse beaucoup plus longue que la normale');
        score -= 10;
      }
    }

    // Check 2: Formality markers (Mira should be casual)
    const formalMarkersFr = ['veuillez', 'souhaitez', 'permettez', 'concernant', 'effectivement'];
    const formalMarkersEn = ['please allow', 'would you like', 'regarding', 'concerning', 'indeed'];
    const formalMarkers = lang === 'en' ? formalMarkersEn : formalMarkersFr;

    const miraFormalCount = formalMarkers.filter(m => miraLower.includes(m)).length;
    if (miraFormalCount > 0) {
      issues.push(lang === 'en' ? 'Contains formal language' : 'Contient du langage formel');
      score -= miraFormalCount * 15;
    }

    // Check 3: Conversational markers (good signs)
    const casualMarkersFr = ['haha', 'mdr', 'genre', 'trop', 'grave', 'ouais', 'bah', 'euh'];
    const casualMarkersEn = ['haha', 'lol', 'like', 'yeah', 'oh', 'uh', 'hmm', 'cool'];
    const casualMarkers = lang === 'en' ? casualMarkersEn : casualMarkersFr;

    const miraCasualCount = casualMarkers.filter(m => miraLower.includes(m)).length;
    const dialogptCasualCount = casualMarkers.filter(m => dialogptLower.includes(m)).length;

    if (miraCasualCount >= dialogptCasualCount) {
      score += 10; // Mira is casual enough
    } else if (miraCasualCount === 0 && dialogptCasualCount > 0) {
      issues.push(lang === 'en' ? 'Lacks casual markers' : 'Manque de marqueurs familiers');
      score -= 10;
    }

    // Check 4: Question patterns
    const miraHasQuestion = miraResponse.includes('?');
    const dialogptHasQuestion = dialogptResponse.includes('?');

    // Both have or don't have questions - consistent style
    if (miraHasQuestion === dialogptHasQuestion) {
      score += 5;
    }

    // Check 5: Emoji usage (Mira uses them, DialoGPT doesn't)
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    const miraEmojis = (miraResponse.match(emojiRegex) || []).length;

    // Too many emojis can seem robotic
    if (miraEmojis > 3) {
      issues.push(lang === 'en' ? 'Too many emojis' : 'Trop d\'emojis');
      score -= 10;
    }

    // Normalize score
    score = Math.max(0, Math.min(100, score));

    return { score, issues };
  }

  /**
   * Get a more natural alternative if Mira's response seems off
   * Blends DialoGPT style with Mira's personality
   */
  async suggestAlternative(
    miraResponse: string,
    conversationHistory: ConversationTurn[],
    userMessage: string,
    lang: 'en' | 'fr' = 'fr'
  ): Promise<string | null> {
    if (!this.isEnabled()) return null;

    const result = await this.scoreNaturalness(
      miraResponse,
      conversationHistory,
      userMessage,
      lang
    );

    if (result.isNatural) {
      return null; // No alternative needed
    }

    console.log(`[DialoGPT] Suggesting alternative (confidence: ${result.confidence})`);
    return result.alternativeSuggestion || null;
  }

  /**
   * Validate response naturalness and return issues
   */
  async validateResponse(
    response: string,
    conversationHistory: ConversationTurn[],
    userMessage: string,
    lang: 'en' | 'fr' = 'fr'
  ): Promise<{
    isNatural: boolean;
    score: number;
    issues: string[];
    suggestion?: string;
  }> {
    if (!this.isEnabled()) {
      return { isNatural: true, score: 70, issues: [] };
    }

    const result = await this.scoreNaturalness(
      response,
      conversationHistory,
      userMessage,
      lang
    );

    const analysis = this.compareResponses(response, result.generatedText || '', lang);

    return {
      isNatural: result.isNatural,
      score: result.confidence,
      issues: analysis.issues,
      suggestion: result.alternativeSuggestion,
    };
  }
}

export const dialogptService = new DialoGPTService();
