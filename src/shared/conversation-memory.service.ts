/**
 * Conversation Memory Service
 *
 * Implements semantic search over conversation history using embeddings.
 * Inspired by the "Advanced Chat Backend" pattern:
 * - Embeds each message for vector search
 * - Retrieves relevant messages by semantic similarity
 * - Combines recent + relevant for optimal context
 *
 * This service handles SHORT-TERM conversational memory.
 * For LONG-TERM facts, see the memory.service.ts (SemanticMemory).
 */

import { Message, IMessage } from '../database/schemas/message.schema';
import { EmbeddingService } from './embedding.service';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  embedding?: number[];
  timestamp: Date;
  similarity?: number;
}

export interface ContextWindow {
  recentMessages: ConversationMessage[];
  relevantMessages: ConversationMessage[];
  combined: ConversationMessage[];
  totalTokensEstimate: number;
}

export class ConversationMemoryService {
  private embeddingService = new EmbeddingService();

  // Similarity threshold for relevant message retrieval
  private readonly MIN_SIMILARITY = 0.3;

  // How many recent messages to always include
  private readonly RECENT_COUNT = 6;

  // How many relevant messages to retrieve
  private readonly RELEVANT_COUNT = 5;

  // Max tokens for context (rough estimate: 4 chars = 1 token)
  private readonly MAX_CONTEXT_TOKENS = 3000;

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length === 0 || b.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Generate and store embedding for a message
   * Called when saving new messages
   */
  async embedMessage(messageId: string, content: string): Promise<number[]> {
    try {
      // Truncate to avoid huge embeddings
      const truncated = content.substring(0, 512);
      const embedding = await this.embeddingService.embed(truncated);

      // Update the message with the embedding
      await Message.updateOne(
        { _id: messageId },
        { $set: { embedding } }
      );

      return embedding;
    } catch (error) {
      console.error('[ConversationMemory] Embedding error:', error);
      return [];
    }
  }

  /**
   * Backfill embeddings for messages that don't have them
   * Run this periodically or on startup
   */
  async backfillEmbeddings(userId: string, limit: number = 100): Promise<number> {
    try {
      const messagesWithoutEmbedding = await Message.find({
        userId,
        embedding: { $exists: false },
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      if (messagesWithoutEmbedding.length === 0) return 0;

      console.log(`[ConversationMemory] Backfilling ${messagesWithoutEmbedding.length} embeddings...`);

      // Batch embed for efficiency
      const contents = messagesWithoutEmbedding.map(m => m.content.substring(0, 512));
      const embeddings = await this.embeddingService.embedBatch(contents);

      // Update each message
      for (let i = 0; i < messagesWithoutEmbedding.length; i++) {
        await Message.updateOne(
          { _id: messagesWithoutEmbedding[i]._id },
          { $set: { embedding: embeddings[i] } }
        );
      }

      console.log(`[ConversationMemory] Backfilled ${messagesWithoutEmbedding.length} embeddings`);
      return messagesWithoutEmbedding.length;
    } catch (error) {
      console.error('[ConversationMemory] Backfill error:', error);
      return 0;
    }
  }

  /**
   * Retrieve semantically relevant messages from conversation history
   */
  async retrieveRelevantMessages(
    userId: string,
    queryEmbedding: number[],
    excludeIds: string[] = [],
    limit: number = 5
  ): Promise<ConversationMessage[]> {
    try {
      // Get messages with embeddings
      const messages = await Message.find({
        userId,
        embedding: { $exists: true, $ne: [] },
        _id: { $nin: excludeIds },
        'metadata.isGreeting': { $ne: true },
        'metadata.isWelcome': { $ne: true },
      })
        .sort({ createdAt: -1 })
        .limit(200) // Search in last 200 messages
        .lean();

      if (messages.length === 0) return [];

      // Calculate similarities
      const scored = messages.map(msg => ({
        id: msg._id.toString(),
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        embedding: msg.embedding,
        timestamp: msg.createdAt,
        similarity: this.cosineSimilarity(queryEmbedding, msg.embedding || []),
      }));

      // Filter by minimum similarity, sort, and return top N
      return scored
        .filter(m => m.similarity >= this.MIN_SIMILARITY)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    } catch (error) {
      console.error('[ConversationMemory] Retrieval error:', error);
      return [];
    }
  }

  /**
   * Get the most recent messages (always included for immediate context)
   */
  async getRecentMessages(
    userId: string,
    limit: number = 6
  ): Promise<ConversationMessage[]> {
    try {
      const messages = await Message.find({
        userId,
        'metadata.isGreeting': { $ne: true },
        'metadata.isWelcome': { $ne: true },
      })
        .sort({ createdAt: -1 })
        .limit(limit + 1) // +1 to potentially skip current message
        .lean();

      return messages.slice(1).reverse().map(msg => ({
        id: msg._id.toString(),
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        embedding: msg.embedding,
        timestamp: msg.createdAt,
      }));
    } catch (error) {
      console.error('[ConversationMemory] Recent messages error:', error);
      return [];
    }
  }

  /**
   * Build optimal context window combining recent + relevant messages
   * This is the main method to call before generating a response
   */
  async buildContextWindow(
    userId: string,
    currentMessage: string
  ): Promise<ContextWindow> {
    try {
      // 1. Get embedding for current query
      const queryEmbedding = await this.embeddingService.embed(currentMessage.substring(0, 512));

      // 2. Get recent messages (always included)
      const recentMessages = await this.getRecentMessages(userId, this.RECENT_COUNT);
      const recentIds = recentMessages.map(m => m.id);

      // 3. Get semantically relevant messages (excluding recent ones)
      const relevantMessages = await this.retrieveRelevantMessages(
        userId,
        queryEmbedding,
        recentIds,
        this.RELEVANT_COUNT
      );

      // 4. Combine and deduplicate
      const combined = this.combineAndSort(recentMessages, relevantMessages);

      // 5. Trim to fit token limit
      const trimmed = this.trimToTokenLimit(combined, this.MAX_CONTEXT_TOKENS);

      // Estimate tokens
      const totalChars = trimmed.reduce((sum, m) => sum + m.content.length, 0);
      const totalTokensEstimate = Math.ceil(totalChars / 4);

      return {
        recentMessages,
        relevantMessages,
        combined: trimmed,
        totalTokensEstimate,
      };
    } catch (error) {
      console.error('[ConversationMemory] Build context error:', error);
      return {
        recentMessages: [],
        relevantMessages: [],
        combined: [],
        totalTokensEstimate: 0,
      };
    }
  }

  /**
   * Combine recent and relevant messages, removing duplicates
   * Sort chronologically for natural conversation flow
   */
  private combineAndSort(
    recent: ConversationMessage[],
    relevant: ConversationMessage[]
  ): ConversationMessage[] {
    const seen = new Set<string>();
    const combined: ConversationMessage[] = [];

    // Add all recent first
    for (const msg of recent) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        combined.push(msg);
      }
    }

    // Add relevant (not already in recent)
    for (const msg of relevant) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id);
        combined.push(msg);
      }
    }

    // Sort chronologically
    return combined.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  /**
   * Trim messages to fit within token limit
   */
  private trimToTokenLimit(
    messages: ConversationMessage[],
    maxTokens: number
  ): ConversationMessage[] {
    const result: ConversationMessage[] = [];
    let totalTokens = 0;

    for (const msg of messages) {
      const msgTokens = Math.ceil(msg.content.length / 4);
      if (totalTokens + msgTokens > maxTokens) break;
      result.push(msg);
      totalTokens += msgTokens;
    }

    return result;
  }

  /**
   * Format context window as string for prompt injection
   */
  formatContextAsString(context: ContextWindow, lang: 'en' | 'fr' = 'fr'): string {
    if (context.combined.length === 0) return '';

    const header = lang === 'en'
      ? '### Relevant Conversation History'
      : '### Historique de Conversation Pertinent';

    const lines = context.combined.map(m => {
      const role = m.role === 'user'
        ? (lang === 'en' ? 'User' : 'Utilisateur')
        : 'Mira';
      return `${role}: ${m.content}`;
    });

    return `${header}\n${lines.join('\n')}`;
  }

  /**
   * Get conversation statistics
   */
  async getStats(userId: string): Promise<{
    totalMessages: number;
    messagesWithEmbedding: number;
    oldestMessage: Date | null;
    newestMessage: Date | null;
  }> {
    try {
      const [total, withEmbedding, oldest, newest] = await Promise.all([
        Message.countDocuments({ userId }),
        Message.countDocuments({ userId, embedding: { $exists: true, $ne: [] } }),
        Message.findOne({ userId }).sort({ createdAt: 1 }).select('createdAt').lean(),
        Message.findOne({ userId }).sort({ createdAt: -1 }).select('createdAt').lean(),
      ]);

      return {
        totalMessages: total,
        messagesWithEmbedding: withEmbedding,
        oldestMessage: oldest?.createdAt || null,
        newestMessage: newest?.createdAt || null,
      };
    } catch (error) {
      console.error('[ConversationMemory] Stats error:', error);
      return {
        totalMessages: 0,
        messagesWithEmbedding: 0,
        oldestMessage: null,
        newestMessage: null,
      };
    }
  }
}

export const conversationMemoryService = new ConversationMemoryService();
