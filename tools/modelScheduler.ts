import { ModelPoolsLoader } from './modelPoolsLoader';

interface SchedulerConfig {
  maxConcurrency: number;
  staggerDelayMs: number;
  cooldownMs: number;
}

interface ScheduledCall<T> {
  id: string;
  fn: () => Promise<T>;
  modelId: string;
  priority: number;
  resolve: (value: T) => void;
  reject: (error: any) => void;
}

export class ModelScheduler {
  private poolsLoader: ModelPoolsLoader;
  private config: SchedulerConfig;
  private queue: ScheduledCall<any>[] = [];
  private inflight = 0;
  private cooldowns = new Map<string, number>();
  private bulkModelIndex = 0;
  private lastStartTime = 0;

  constructor(poolsLoader: ModelPoolsLoader, config: Partial<SchedulerConfig> = {}) {
    this.poolsLoader = poolsLoader;
    this.config = {
      maxConcurrency: config.maxConcurrency || 3,
      staggerDelayMs: config.staggerDelayMs || 3000,
      cooldownMs: config.cooldownMs || 15000
    };
  }

  private isInCooldown(modelId: string): boolean {
    const cooldownUntil = this.cooldowns.get(modelId);
    if (!cooldownUntil) return false;
    return Date.now() < cooldownUntil;
  }

  private setCooldown(modelId: string): void {
    this.cooldowns.set(modelId, Date.now() + this.config.cooldownMs);
    console.warn(`  ⏱️  ${modelId} on cooldown for ${this.config.cooldownMs / 1000}s`);
  }

  private getNextBulkModel(): string {
    const roles = this.poolsLoader.getRoles();
    const bulkModels = roles.BULK_MODELS;

    if (bulkModels.length === 0) {
      throw new Error('No BULK models available');
    }

    // Round-robin through bulk models, skip those in cooldown
    let attempts = 0;
    while (attempts < bulkModels.length) {
      const model = bulkModels[this.bulkModelIndex];
      this.bulkModelIndex = (this.bulkModelIndex + 1) % bulkModels.length;

      if (!this.isInCooldown(model)) {
        return model;
      }
      attempts++;
    }

    // All in cooldown, return next anyway
    const model = bulkModels[this.bulkModelIndex];
    this.bulkModelIndex = (this.bulkModelIndex + 1) % bulkModels.length;
    console.warn(`  ⚠️  All BULK models in cooldown, using ${model} anyway`);
    return model;
  }

  // Schedule a call with staggering and concurrency limits
  async schedule<T>(
    fn: () => Promise<T>,
    options: { modelId?: string; priority?: number } = {}
  ): Promise<T> {
    const modelId = options.modelId || this.getNextBulkModel();
    const priority = options.priority || 0;

    return new Promise<T>((resolve, reject) => {
      const call: ScheduledCall<T> = {
        id: `${Date.now()}-${Math.random()}`,
        fn,
        modelId,
        priority,
        resolve,
        reject
      };

      this.queue.push(call);
      this.queue.sort((a, b) => b.priority - a.priority); // Higher priority first
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    // Check if we can start another call
    if (this.inflight >= this.config.maxConcurrency) {
      return;
    }

    if (this.queue.length === 0) {
      return;
    }

    // Apply stagger delay
    const now = Date.now();
    const timeSinceLastStart = now - this.lastStartTime;
    if (this.lastStartTime > 0 && timeSinceLastStart < this.config.staggerDelayMs) {
      const delay = this.config.staggerDelayMs - timeSinceLastStart;
      setTimeout(() => this.processQueue(), delay);
      return;
    }

    // Get next call
    const call = this.queue.shift();
    if (!call) return;

    // Check if model is in cooldown
    if (this.isInCooldown(call.modelId)) {
      // Requeue at lower priority
      call.priority = Math.max(call.priority - 1, -10);
      this.queue.push(call);
      this.queue.sort((a, b) => b.priority - a.priority);
      setTimeout(() => this.processQueue(), 1000);
      return;
    }

    // Execute call
    this.inflight++;
    this.lastStartTime = Date.now();

    call.fn()
      .then(result => {
        this.inflight--;
        call.resolve(result);
        this.poolsLoader.markSuccess(call.modelId);
        this.processQueue();
      })
      .catch(error => {
        this.inflight--;
        
        // Check if rate limit error
        if (this.isRateLimitError(error)) {
          this.setCooldown(call.modelId);
          this.poolsLoader.markFailure(call.modelId);
        }
        
        call.reject(error);
        this.processQueue();
      });

    // Try to start another immediately if capacity available
    if (this.inflight < this.config.maxConcurrency && this.queue.length > 0) {
      setTimeout(() => this.processQueue(), this.config.staggerDelayMs);
    }
  }

  private isRateLimitError(error: any): boolean {
    return (
      error?.response?.status === 429 ||
      error?.response?.status === 500 ||
      error?.message?.toLowerCase().includes('rate limit') ||
      error?.message?.toLowerCase().includes('too many requests')
    );
  }

  // Wait for all inflight calls to complete
  async waitForCompletion(): Promise<void> {
    while (this.inflight > 0 || this.queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Get scheduler stats
  getStats(): { inflight: number; queued: number; cooldowns: number } {
    const activeCooldowns = Array.from(this.cooldowns.values())
      .filter(until => Date.now() < until)
      .length;

    return {
      inflight: this.inflight,
      queued: this.queue.length,
      cooldowns: activeCooldowns
    };
  }
}

export function createScheduler(poolsLoader: ModelPoolsLoader, config?: Partial<SchedulerConfig>): ModelScheduler {
  return new ModelScheduler(poolsLoader, config);
}
