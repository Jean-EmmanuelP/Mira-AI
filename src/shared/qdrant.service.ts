import axios, { AxiosRequestConfig } from 'axios';

export class QdrantService {
  private baseUrl: string;
  private collectionName = 'mira_memories';
  private apiKey: string | null;

  constructor() {
    const host = process.env.QDRANT_HOST || 'localhost';
    const port = process.env.QDRANT_PORT || '6333';
    this.apiKey = process.env.QDRANT_API_KEY || null;

    // Qdrant Cloud uses HTTPS, local uses HTTP
    const protocol = this.apiKey ? 'https' : 'http';
    this.baseUrl = `${protocol}://${host}:${port}`;
  }

  private getHeaders(): AxiosRequestConfig['headers'] {
    if (this.apiKey) {
      return { 'api-key': this.apiKey };
    }
    return {};
  }

  async ensureCollection(): Promise<void> {
    try {
      await axios.get(`${this.baseUrl}/collections/${this.collectionName}`, {
        headers: this.getHeaders(),
      });
      console.log('✅ Qdrant collection exists');
    } catch (error: any) {
      if (error.response?.status === 404) {
        await axios.put(
          `${this.baseUrl}/collections/${this.collectionName}`,
          {
            vectors: {
              size: 768,
              distance: 'Cosine',
            },
          },
          { headers: this.getHeaders() }
        );
        console.log('✅ Qdrant collection created');
      } else {
        console.error('Qdrant connection error:', error.message);
      }
    }
  }

  async upsert(id: string, vector: number[], payload: any): Promise<void> {
    try {
      await axios.put(
        `${this.baseUrl}/collections/${this.collectionName}/points`,
        {
          points: [
            {
              id: this.hashString(id),
              vector,
              payload,
            },
          ],
        },
        { headers: this.getHeaders() }
      );
    } catch (error: any) {
      console.error('Qdrant upsert error:', error.message);
    }
  }

  async search(vector: number[], filter?: any, limit: number = 10): Promise<any[]> {
    try {
      const body: any = {
        vector,
        limit,
        with_payload: true,
      };

      if (filter?.userId) {
        body.filter = {
          must: [
            {
              key: 'userId',
              match: { value: filter.userId },
            },
          ],
        };
      }

      const response = await axios.post(
        `${this.baseUrl}/collections/${this.collectionName}/points/search`,
        body,
        { headers: this.getHeaders() }
      );

      return response.data.result || [];
    } catch (error: any) {
      console.error('Qdrant search error:', error.message);
      return [];
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await axios.post(
        `${this.baseUrl}/collections/${this.collectionName}/points/delete`,
        { points: [this.hashString(id)] },
        { headers: this.getHeaders() }
      );
    } catch (error: any) {
      console.error('Qdrant delete error:', error.message);
    }
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}
