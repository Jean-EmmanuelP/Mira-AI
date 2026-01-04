export class StatsService {
  private static instance: StatsService;
  private stats = {
    messagesProcessed: 0,
    memoriesStored: 0,
    averageResponseTime: 0,
    errors: 0,
    startTime: new Date(),
  };

  static getInstance(): StatsService {
    if (!StatsService.instance) {
      StatsService.instance = new StatsService();
    }
    return StatsService.instance;
  }

  recordMessage(duration: number) {
    this.stats.messagesProcessed++;
    this.stats.averageResponseTime =
      (this.stats.averageResponseTime * (this.stats.messagesProcessed - 1) + duration) /
      this.stats.messagesProcessed;
  }

  recordMemory() {
    this.stats.memoriesStored++;
  }

  recordError() {
    this.stats.errors++;
  }

  getStats() {
    const uptime = Date.now() - this.stats.startTime.getTime();
    return {
      ...this.stats,
      uptime: Math.floor(uptime / 1000),
      uptimeMinutes: Math.floor(uptime / 60000),
    };
  }
}
