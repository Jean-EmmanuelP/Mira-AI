import { embed, embedMany } from 'ai';
import { google } from '@ai-sdk/google';

export class EmbeddingService {
  private embeddingModel = google.textEmbeddingModel('text-embedding-004');

  async embed(text: string): Promise<number[]> {
    try {
      if (!text || text.trim().length === 0) {
        return this.zeroVector(768);
      }

      const { embedding } = await embed({
        model: this.embeddingModel,
        value: text,
      });

      if (!embedding || embedding.length === 0) {
        console.warn('Empty embedding from Gemini, returning zero vector');
        return this.zeroVector(768);
      }

      return embedding;
    } catch (error) {
      console.error('Embedding Error:', error);
      return this.zeroVector(768);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      const validTexts = texts.filter(t => t && t.trim().length > 0);

      if (validTexts.length === 0) {
        return texts.map(() => this.zeroVector(768));
      }

      const { embeddings } = await embedMany({
        model: this.embeddingModel,
        values: validTexts,
      });

      // Map back results, using zero vectors for originally empty texts
      const result: number[][] = [];
      let validIndex = 0;

      for (const text of texts) {
        if (text && text.trim().length > 0) {
          result.push(embeddings[validIndex] || this.zeroVector(768));
          validIndex++;
        } else {
          result.push(this.zeroVector(768));
        }
      }

      return result;
    } catch (error) {
      console.error('Batch Embedding Error:', error);
      return texts.map(() => this.zeroVector(768));
    }
  }

  cosineSimilarity(vectorA: number[], vectorB: number[]): number {
    if (vectorA.length === 0 || vectorB.length === 0) {
      return 0;
    }

    let dotProduct = 0;
    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
    }

    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vectorA.length; i++) {
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  findMostSimilar(
    queryEmbedding: number[],
    textEmbeddings: Array<{ text: string; embedding: number[] }>,
    topN: number = 5
  ): Array<{ text: string; similarity: number }> {
    const scored = textEmbeddings.map((item) => ({
      text: item.text,
      similarity: this.cosineSimilarity(queryEmbedding, item.embedding),
    }));

    return scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topN);
  }

  private zeroVector(dimensions: number): number[] {
    return new Array(dimensions).fill(0);
  }
}
