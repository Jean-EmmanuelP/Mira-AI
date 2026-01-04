import { GoogleGenerativeAI } from '@google/generative-ai';

export class LLMService {
  private client: GoogleGenerativeAI;
  private model: any;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not set in environment');
    }

    this.client = new GoogleGenerativeAI(apiKey);
    this.model = this.client.getGenerativeModel({ model: 'gemini-2.0-flash' });
  }

  async generate(systemPrompt: string, userMessage: string): Promise<string> {
    try {
      const fullPrompt = systemPrompt
        ? `System: ${systemPrompt}\n\nUser: ${userMessage}`
        : userMessage;

      const response = await this.model.generateContent(fullPrompt);
      const result = response.response;

      if (!result.text()) {
        throw new Error('No text response from Gemini');
      }

      return result.text();
    } catch (error) {
      console.error('Gemini Error:', error);
      throw error;
    }
  }

  async extract(prompt: string): Promise<any> {
    const fullPrompt = `You are a JSON extraction expert. Return valid JSON only, nothing else.

${prompt}`;

    try {
      const response = await this.generate('', fullPrompt);

      const jsonMatch = response.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      return JSON.parse(response);
    } catch (error) {
      console.warn('Failed to parse JSON from Gemini:', error);
      return {};
    }
  }

  async classify(prompt: string): Promise<string> {
    const fullPrompt = `Classify with a single word only: ${prompt}`;

    try {
      const response = await this.generate('', fullPrompt);
      return response.split('\n')[0].trim().toLowerCase().split(/[,\s]/)[0];
    } catch {
      return 'neutral';
    }
  }
}
