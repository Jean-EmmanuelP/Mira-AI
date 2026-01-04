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
    const prompt = `Extract all factual information from this text.
For each fact, provide: text (the statement), category (personal/professional/health/goals/preferences/relationship), confidence (0-1), entities (people, places).

Return JSON array: [{ text, category, confidence, entities }]

Text: "${content}"`;

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
