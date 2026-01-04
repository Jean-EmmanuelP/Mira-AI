export interface ScoredMemory {
  id: string;
  fact: string;
  score: number;
  reason: string;
}

export class RelevanceService {
  calculateScore(
    vectorSimilarity: number,
    mentionCount: number,
    daysSince: number,
    confidence: number,
    entities: string[],
    queryEntities: string[]
  ): number {
    let score = 0;

    // Vector similarity (50%)
    score += vectorSimilarity * 0.5;

    // Entity match (30%)
    const matches = entities.filter((e) =>
      queryEntities.some((qe) => qe.toLowerCase().includes(e.toLowerCase()))
    );
    score += (matches.length / Math.max(queryEntities.length, 1)) * 0.3;

    // Recency (15%) - decay over 30 days
    const recency = Math.exp(-daysSince / 30);
    score += recency * 0.15;

    // Confidence (5%)
    score += confidence * 0.05;

    return Math.min(score, 1.0);
  }

  daysBetween(date1: Date, date2: Date = new Date()): number {
    const diffTime = Math.abs(date2.getTime() - date1.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
}
