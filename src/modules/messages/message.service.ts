import { Message, IMessage } from '../../database/schemas/message.schema';
import { LLMService } from '../../shared/llm.service';
import { SentimentService } from '../../shared/sentiment.service';
import { MemoryService } from '../memory/memory.service';
import { RetrievalService } from '../memory/retrieval.service';
import { ProfileService } from '../profile/profile.service';
import { GoalService } from '../goals/goal.service';
import { ResponseService } from './response.service';

export class MessageService {
  private llmService = new LLMService();
  private sentimentService = new SentimentService();
  private memoryService = new MemoryService();
  private retrievalService = new RetrievalService();
  private profileService = new ProfileService();
  private goalService = new GoalService();
  private responseService = new ResponseService();

  async processMessage(
    userId: string,
    conversationId: string,
    content: string
  ): Promise<IMessage> {
    // Step 1: Save user message
    const userMessage = await Message.create({
      userId,
      conversationId,
      role: 'user',
      content,
      metadata: {},
    });

    // Step 2: Async memory & goal processing
    setImmediate(() => {
      this.memoryService.processMessage(userId, content).catch(console.error);
      this.goalService.detectGoals(userId, content).catch(console.error);
    });

    // Step 3: Analyze sentiment
    const sentiment = await this.sentimentService.analyzeSentiment(content);

    // Step 4: Retrieve context
    const memories = await this.retrievalService.retrieveRelevantMemories(userId, content, 5);
    const summary = await this.profileService.generateUserSummary(userId);

    // Step 5: Build system prompt
    const memoryContext = memories.map((m) => `- ${m.fact}`).join('\n');

    let context = '';
    if (summary) {
      context += `About the user:\n${summary}\n\n`;
    }
    if (memoryContext) {
      context += `What you remember:\n${memoryContext}`;
    }

    const systemPrompt = `You are Mira, an AI companion who genuinely remembers and cares.

${context}

Respond warmly and personally. Show you understand them. Keep responses concise but meaningful.`;

    // Step 6: Generate response
    let response = await this.llmService.generate(systemPrompt, content);

    // Step 7: Refine based on sentiment
    response = await this.responseService.refineResponse(response, sentiment);

    // Step 8: Save response
    const assistantMessage = await Message.create({
      userId,
      conversationId,
      role: 'assistant',
      content: response,
      metadata: {
        sentiment,
        retrievedMemories: memories.length,
      },
    });

    return assistantMessage;
  }

  async getConversation(userId: string, conversationId: string): Promise<IMessage[]> {
    return Message.find({
      userId,
      conversationId,
    }).sort({ createdAt: 1 });
  }
}
