import { SemanticMemory } from '../../database/schemas/memory.schema';
import { EmbeddingService } from '../../shared/embedding.service';

export class DeduplicationService {
  private embeddingService = new EmbeddingService();

  async deduplicateFacts(
    userId: string,
    newFacts: Array<{ text: string; category: string; confidence: number }>
  ): Promise<
    Array<{ text: string; category: string; confidence: number; embedding: number[] }>
  > {
    const existingMemories = await SemanticMemory.find({ userId });

    const deduped = [];

    for (const newFact of newFacts) {
      let isDuplicate = false;

      for (const existing of existingMemories) {
        if (existing.fact.toLowerCase().trim() === newFact.text.toLowerCase().trim()) {
          await SemanticMemory.updateOne(
            { _id: existing._id },
            {
              $inc: { mentionCount: 1 },
              $set: { lastMentioned: new Date() },
            }
          );
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        const embedding = await this.embeddingService.embed(newFact.text);
        deduped.push({
          ...newFact,
          embedding,
        });
      }
    }

    return deduped;
  }
}
