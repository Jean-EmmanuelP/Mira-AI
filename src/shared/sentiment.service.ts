import { LLMService } from './llm.service';

export class SentimentService {
  private llmService = new LLMService();

  async analyzeSentiment(text: string): Promise<string> {
    const prompt = `Classify sentiment of this text in one word: positive, negative, neutral, stressed, happy, sad, excited.

Text: "${text}"`;

    try {
      return await this.llmService.classify(prompt);
    } catch {
      return 'neutral';
    }
  }
}
