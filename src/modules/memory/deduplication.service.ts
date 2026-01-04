import { SemanticMemory } from '../../database/schemas/memory.schema';
import { EmbeddingService } from '../../shared/embedding.service';

// Semantic similarity threshold - facts with similarity above this are considered duplicates
const SIMILARITY_THRESHOLD = 0.85;

export class DeduplicationService {
  private embeddingService = new EmbeddingService();

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  async deduplicateFacts(
    userId: string,
    newFacts: Array<{ text: string; category: string; confidence: number }>
  ): Promise<
    Array<{ text: string; category: string; confidence: number; embedding: number[] }>
  > {
    const existingMemories = await SemanticMemory.find({ userId });

    const deduped = [];

    for (const newFact of newFacts) {
      // Generate embedding for the new fact first
      const newEmbedding = await this.embeddingService.embed(newFact.text);

      let isDuplicate = false;
      let bestMatch: any = null;
      let bestSimilarity = 0;

      for (const existing of existingMemories) {
        // Check 1: Exact text match (fast path)
        if (existing.fact.toLowerCase().trim() === newFact.text.toLowerCase().trim()) {
          isDuplicate = true;
          bestMatch = existing;
          break;
        }

        // Check 2: Semantic similarity using embeddings
        if (existing.embedding && existing.embedding.length > 0) {
          const similarity = this.cosineSimilarity(newEmbedding, existing.embedding);

          if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            if (similarity >= SIMILARITY_THRESHOLD) {
              bestMatch = existing;
            }
          }
        }
      }

      // If semantic duplicate found, update the existing memory
      if (bestMatch && bestSimilarity >= SIMILARITY_THRESHOLD) {
        isDuplicate = true;
        await SemanticMemory.updateOne(
          { _id: bestMatch._id },
          {
            $inc: { mentionCount: 1 },
            $set: { lastMentioned: new Date() },
          }
        );
        console.log(`🔄 Semantic duplicate detected (${(bestSimilarity * 100).toFixed(1)}% similar): "${newFact.text}" ≈ "${bestMatch.fact}"`);
      }

      if (!isDuplicate) {
        deduped.push({
          ...newFact,
          embedding: newEmbedding,
        });
      }
    }

    return deduped;
  }
}
