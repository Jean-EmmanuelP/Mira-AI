import { SemanticMemory } from '../../database/schemas/memory.schema';
import { QdrantService } from '../../shared/qdrant.service';
import { EmbeddingService } from '../../shared/embedding.service';
import { RelevanceService, ScoredMemory } from './relevance.service';
import { ExtractionService } from './extraction.service';

export class RetrievalService {
  private qdrant = new QdrantService();
  private embedding = new EmbeddingService();
  private relevance = new RelevanceService();
  private extraction = new ExtractionService();

  // Patterns indicating user is asking about memory directly
  private readonly MEMORY_RECALL_PATTERNS = [
    /tu te souviens/i,
    /tu te rappelles/i,
    /tu sais (encore|toujours)/i,
    /je t'(ai|avais) (dit|parlé)/i,
    /mon (métier|job|boulot|travail)/i,
    /ma (passion|vie|famille)/i,
    /mes (hobbies|passions|projets)/i,
    /c'est quoi (mon|ma|mes)/i,
    /what('s| is) my/i,
    /do you remember/i,
    /did i tell you/i,
  ];

  /**
   * Check if user is asking Mira to recall something
   */
  private isMemoryRecallQuery(query: string): boolean {
    return this.MEMORY_RECALL_PATTERNS.some(pattern => pattern.test(query));
  }

  /**
   * Get recent memories (by date, not by relevance)
   * Used when user asks "tu te souviens mon métier?"
   */
  async getRecentMemories(userId: string, limit: number = 10): Promise<ScoredMemory[]> {
    try {
      const memories = await SemanticMemory.find({ userId })
        .sort({ lastMentioned: -1, createdAt: -1 })
        .limit(limit)
        .lean();

      return memories.map((memory: any) => {
        const daysSince = this.relevance.daysBetween(new Date(memory.lastMentioned));
        // Score based purely on recency for these queries
        const recencyScore = Math.exp(-daysSince / 14); // Faster decay (14 days instead of 30)

        return {
          id: memory._id.toString(),
          fact: memory.fact,
          score: recencyScore,
          reason: `recent:${daysSince}d`,
          category: memory.category,
          daysSince,
          mentionCount: memory.mentionCount,
        };
      });
    } catch (error) {
      console.error('Recent memory retrieval error:', error);
      return [];
    }
  }

  /**
   * Main retrieval function - chooses strategy based on query type
   */
  async retrieveRelevantMemories(
    userId: string,
    query: string,
    limit: number = 10
  ): Promise<ScoredMemory[]> {
    try {
      // If user is directly asking about memory, prioritize RECENT memories
      if (this.isMemoryRecallQuery(query)) {
        console.log('[RetrievalService] Memory recall query detected - using recency-first strategy');
        const recentMemories = await this.getRecentMemories(userId, limit);

        // Also do a quick vector search to find specifically mentioned items
        const vectorMemories = await this.searchByRelevance(userId, query, limit);

        // Merge: recent first, then fill with relevant
        const seen = new Set<string>();
        const merged: ScoredMemory[] = [];

        // Add recent memories first (top 5)
        for (const m of recentMemories.slice(0, 5)) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            merged.push({ ...m, score: m.score + 0.3 }); // Boost recent
          }
        }

        // Add vector matches
        for (const m of vectorMemories) {
          if (!seen.has(m.id)) {
            seen.add(m.id);
            merged.push(m);
          }
        }

        return merged.slice(0, limit);
      }

      // Normal case: use vector similarity
      return this.searchByRelevance(userId, query, limit);
    } catch (error) {
      console.error('Retrieval error:', error);
      return [];
    }
  }

  /**
   * Vector-based relevance search (original logic)
   */
  private async searchByRelevance(
    userId: string,
    query: string,
    limit: number
  ): Promise<ScoredMemory[]> {
    const queryEmbedding = await this.embedding.embed(query);
    const queryEntities = await this.extraction.extractEntities(query);

    const vectorResults = await this.qdrant.search(queryEmbedding, { userId }, limit * 2);

    const memoryIds = vectorResults
      .map((r: any) => r.payload?.memoryId)
      .filter(Boolean);

    if (memoryIds.length === 0) {
      return [];
    }

    const memories = await SemanticMemory.find({
      _id: { $in: memoryIds },
    }).lean();

    const scored: ScoredMemory[] = memories.map((memory: any) => {
      const vectorResult = vectorResults.find(
        (r: any) => r.payload?.memoryId === memory._id.toString()
      );

      const vectorSim = vectorResult?.score || 0;
      const daysSince = this.relevance.daysBetween(new Date(memory.lastMentioned));

      const score = this.relevance.calculateScore(
        vectorSim,
        memory.mentionCount,
        daysSince,
        memory.confidence,
        memory.fact.split(' '),
        queryEntities
      );

      return {
        id: memory._id.toString(),
        fact: memory.fact,
        score,
        reason: `vector:${(vectorSim * 100).toFixed(0)}%`,
        category: memory.category,
        daysSince,
        mentionCount: memory.mentionCount,
      };
    });

    const RELEVANCE_THRESHOLD = 0.45; // Slightly lowered

    return scored
      .filter((m) => m.score >= RELEVANCE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
