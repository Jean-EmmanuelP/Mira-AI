import { LLMService } from '../../shared/llm.service';

export interface ExtractedFact {
  text: string;
  category: string;
  confidence: number;
  entities?: string[];
}

export class ExtractionService {
  private llmService = new LLMService();

  async extractFacts(content: string): Promise<ExtractedFact[]> {
    const prompt = `You are extracting memories about a person from their message. These will be stored long-term to help remember who they are.

Extract ALL meaningful information, including:
1. **Identity**: Name, age, location, occupation, family members
2. **Relationships**: People they mention (pets count!), their relationship to them
3. **Emotions & State**: How they're feeling, what's stressing them, what excites them
4. **Goals & Plans**: Upcoming events, things they want to do, deadlines
5. **Preferences**: Likes, dislikes, habits, routines
6. **Context**: Why they're sharing this, what matters to them

For EACH fact, provide:
- text: A complete, self-contained statement (e.g., "Sophie has a dog named Max" not just "has dog Max")
- category: personal | professional | health | goals | preferences | relationship | emotional
- confidence: 0-1 (how certain is this fact)
- entities: Array of named entities (people, pets, places, companies)

IMPORTANT: Capture emotional context! "stressed about interview" is more valuable than just "has interview".

Return ONLY a JSON array: [{ text, category, confidence, entities }]

Message: "${content}"`;

    try {
      const facts = await this.llmService.extract(prompt);
      return Array.isArray(facts) ? facts : [];
    } catch (error) {
      console.error('Extraction error:', error);
      return [];
    }
  }

  async extractEntities(content: string): Promise<string[]> {
    const prompt = `Extract all named entities (people, places, things) from this text.
Return JSON array: ["entity1", "entity2", ...]

Text: "${content}"`;

    try {
      const result = await this.llmService.extract(prompt);
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }
}
