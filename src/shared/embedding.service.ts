import { GoogleGenerativeAI } from '@google/generative-ai';

export class EmbeddingService {
  private client: GoogleGenerativeAI;
  private embeddingModel: any;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not set');
    }

    this.client = new GoogleGenerativeAI(apiKey);
    this.embeddingModel = this.client.getGenerativeModel({
      model: 'text-embedding-004',
    });
  }

  async embed(text: string): Promise<number[]> {
    try {
      if (!text || text.trim().length === 0) {
        return this.zeroVector(768);
      }

      const response = await this.embeddingModel.embedContent({
        content: {
          parts: [{ text }],
        },
      });

      const embedding = response.embedding?.values;

      if (!embedding || embedding.length === 0) {
        console.warn('Empty embedding from Gemini, returning zero vector');
        return this.zeroVector(768);
      }

      return embedding;
    } catch (error) {
      console.error('Gemini Embedding Error:', error);
      return this.zeroVector(768);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      const embeddings: number[][] = [];

      for (const text of texts) {
        const embedding = await this.embed(text);
        embeddings.push(embedding);
      }

      return embeddings;
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
