import { SemanticMemory, ISemanticMemory } from '../../database/schemas/memory.schema';
import { QdrantService } from '../../shared/qdrant.service';

export class StorageService {
  private qdrant = new QdrantService();

  async storeMemories(
    userId: string,
    facts: Array<{
      text: string;
      category: string;
      confidence: number;
      embedding: number[];
    }>
  ): Promise<ISemanticMemory[]> {
    const stored = [];

    for (const fact of facts) {
      const memory = await SemanticMemory.create({
        userId,
        fact: fact.text,
        category: fact.category,
        confidence: fact.confidence,
        embedding: fact.embedding,
        mentionCount: 1,
        firstMentioned: new Date(),
        lastMentioned: new Date(),
      });

      await this.qdrant.upsert(memory._id.toString(), fact.embedding, {
        userId,
        fact: fact.text,
        category: fact.category,
        confidence: fact.confidence,
        memoryId: memory._id.toString(),
      });

      stored.push(memory);
    }

    return stored;
  }

  async getMemories(userId: string, limit: number = 50): Promise<ISemanticMemory[]> {
    return SemanticMemory.find({ userId })
      .sort({ lastMentioned: -1 })
      .limit(limit)
      .lean() as Promise<ISemanticMemory[]>;
  }
}
