import { ExtractionService } from './extraction.service';
import { DeduplicationService } from './deduplication.service';
import { StorageService } from './storage.service';
import { ProfileService } from '../profile/profile.service';

export class MemoryService {
  private extractionService = new ExtractionService();
  private deduplicationService = new DeduplicationService();
  private storageService = new StorageService();
  private profileService = new ProfileService();

  async processMessage(userId: string, content: string): Promise<void> {
    try {
      const facts = await this.extractionService.extractFacts(content);

      if (facts.length === 0) {
        return;
      }

      const deduped = await this.deduplicationService.deduplicateFacts(userId, facts);

      if (deduped.length > 0) {
        await this.storageService.storeMemories(userId, deduped);
        // Invalidate profile cache so new memories are reflected immediately
        await this.profileService.invalidateCache(userId);
        console.log(`✅ Stored ${deduped.length} new memories for user ${userId}`);
      }
    } catch (error) {
      console.error('Memory processing error:', error);
    }
  }

  async getRecentMemories(userId: string, limit: number = 10) {
    return this.storageService.getMemories(userId, limit);
  }
}
