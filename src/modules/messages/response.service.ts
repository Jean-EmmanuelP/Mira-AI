import { LLMService } from '../../shared/llm.service';

export class ResponseService {
  private llmService = new LLMService();

  async refineResponse(baseResponse: string, sentiment: string): Promise<string> {
    if (sentiment === 'stressed' || sentiment === 'sad' || sentiment === 'negative') {
      const prompt = `The user seems to be feeling ${sentiment}.
Make this response more empathetic and supportive, while keeping it concise:

"${baseResponse}"`;

      try {
        return await this.llmService.generate('', prompt);
      } catch {
        return baseResponse;
      }
    }

    return baseResponse;
  }

  async addPersonalTouch(response: string, userSummary: string): Promise<string> {
    if (!userSummary || userSummary.length < 10) return response;

    const prompt = `Add a subtle personal touch to this response that shows understanding of:
${userSummary}

Response: "${response}"

Make it warmer and slightly more personal, but keep it natural and concise.`;

    try {
      return await this.llmService.generate('', prompt);
    } catch {
      return response;
    }
  }
}
