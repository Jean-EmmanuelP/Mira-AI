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

  async retrieveRelevantMemories(
    userId: string,
    query: string,
    limit: number = 10
  ): Promise<ScoredMemory[]> {
    try {
      const queryEmbedding = await this.embedding.embed(query);
      const queryEntities = await this.extraction.extractEntities(query);

      const vectorResults = await this.qdrant.search(queryEmbedding, { userId }, limit * 2);

      const memoryIds = vectorResults
        .map((r: any) => r.payload?.memoryId)
        .filter(Boolean);

      if (memoryIds.length === 0) {
        const recent = await SemanticMemory.find({ userId })
          .sort({ lastMentioned: -1 })
          .limit(limit)
          .lean();

        return recent.map((m: any) => ({
          id: m._id.toString(),
          fact: m.fact,
          score: 0.5,
          reason: 'recent',
        }));
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
        };
      });

      return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    } catch (error) {
      console.error('Retrieval error:', error);
      return [];
    }
  }
}
