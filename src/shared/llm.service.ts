import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { anthropic } from '@ai-sdk/anthropic';
import { mistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';

interface ModelConfig {
  name: string;
  model: any;
  enabled: boolean;
}

// Create DeepSeek provider (OpenAI-compatible API)
const deepseek = createOpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY || '',
});

export class LLMService {
  private models: ModelConfig[];

  constructor() {
    this.models = this.initializeModels();

    const enabledModels = this.models.filter(m => m.enabled).map(m => m.name);
    if (enabledModels.length === 0) {
      throw new Error('No LLM API keys configured. Set at least one of: GOOGLE_GENERATIVE_AI_API_KEY, ANTHROPIC_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY');
    }

    console.log(`🤖 LLM Models enabled: ${enabledModels.join(', ')}`);
  }

  private initializeModels(): ModelConfig[] {
    return [
      {
        name: 'Gemini',
        model: google('gemini-2.0-flash'),
        enabled: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      },
      {
        name: 'Claude',
        model: anthropic('claude-3-5-haiku-latest'),
        enabled: !!process.env.ANTHROPIC_API_KEY,
      },
      {
        name: 'DeepSeek',
        model: deepseek('deepseek-chat'),
        enabled: !!process.env.DEEPSEEK_API_KEY,
      },
      {
        name: 'Mistral',
        model: mistral('mistral-large-latest'),
        enabled: !!process.env.MISTRAL_API_KEY,
      },
    ];
  }

  async generate(systemPrompt: string, userMessage: string): Promise<string> {
    const enabledModels = this.models.filter(m => m.enabled);
    let lastError: Error | null = null;

    for (const { name, model } of enabledModels) {
      try {
        const { text } = await generateText({
          model,
          system: systemPrompt || undefined,
          prompt: userMessage,
        });

        if (!text) {
          throw new Error(`No text response from ${name}`);
        }

        if (enabledModels[0].name !== name) {
          console.log(`✅ Used ${name} (fallback)`);
        }

        return text;
      } catch (error: any) {
        console.warn(`${name} failed:`, error.message);
        lastError = error;
      }
    }

    console.error('All configured models failed');
    throw lastError || new Error('All LLM models failed');
  }

  async extract(prompt: string): Promise<any> {
    const systemPrompt = 'You are a JSON extraction expert. Return valid JSON only, nothing else.';

    try {
      const response = await this.generate(systemPrompt, prompt);

      const jsonMatch = response.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      return JSON.parse(response);
    } catch (error) {
      console.warn('Failed to parse JSON:', error);
      return {};
    }
  }

  async classify(prompt: string): Promise<string> {
    try {
      const response = await this.generate('', `Classify with a single word only: ${prompt}`);
      return response.split('\n')[0].trim().toLowerCase().split(/[,\s]/)[0];
    } catch {
      return 'neutral';
    }
  }
}
