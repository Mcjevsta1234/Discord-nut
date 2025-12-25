/**
 * Web Generation Queue Manager
 * 
 * Handles sequential execution of website generation jobs
 * to avoid parallel generation overload.
 */

interface WebQueueItem {
  userId: string;
  username: string;
  execute: () => Promise<void>;
}

class WebQueue {
  private queue: WebQueueItem[] = [];
  private processing = false;
  private activeJob: WebQueueItem | null = null;

  /**
   * Add a job to the queue and start processing if not already running
   */
  async enqueue(item: WebQueueItem): Promise<void> {
    console.log(`[webQueue] Enqueue job for user ${item.username} (userId: ${item.userId})`);
    console.log(`[webQueue] Queue length before enqueue: ${this.queue.length}`);
    
    this.queue.push(item);
    
    console.log(`[webQueue] Queue length after enqueue: ${this.queue.length}`);
    console.log(`[webQueue] Processing flag: ${this.processing}`);
    
    // Kick off processing if not already running
    this.kick();
  }

  /**
   * Kick off queue processing if not already active
   */
  private kick(): void {
    if (this.processing) {
      console.log('[webQueue] Already processing, skipping kick');
      return;
    }
    
    console.log('[webQueue] Kicking off queue processing');
    this.processing = true;
    
    // Start processing loop in background
    void this.processLoop();
  }

  /**
   * Get current queue status for display
   */
  getQueueStatus(): { active: string | null; queue: Array<{ position: number; username: string }> } {
    return {
      active: this.activeJob?.username || null,
      queue: this.queue.map((item, index) => ({
        position: index + 1,
        username: item.username,
      })),
    };
  }

  /**
   * Process queued jobs sequentially
   */
  private async processLoop(): Promise<void> {
    console.log('[webQueue] Starting process loop');
    
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        this.activeJob = item;
        
        console.log(`[webQueue] Starting job for user ${item.username} (userId: ${item.userId})`);
        const startTime = Date.now();

        try {
          await item.execute();
          const duration = Date.now() - startTime;
          console.log(`[webQueue] ✓ Job completed for ${item.username} in ${duration}ms`);
        } catch (error) {
          const duration = Date.now() - startTime;
          console.error(`[webQueue] ✗ Job failed for ${item.username} after ${duration}ms:`, error);
          if (error instanceof Error) {
            console.error(`[webQueue] Error stack:`, error.stack);
          }
        }

        this.activeJob = null;
      }
    } finally {
      console.log('[webQueue] Process loop ending');
      this.processing = false;
      
      // If more jobs were added while we were finishing, kick again
      if (this.queue.length > 0) {
        console.log(`[webQueue] More jobs queued (${this.queue.length}), restarting processing`);
        this.kick();
      }
    }
  }

  /**
   * Check if a user already has a job in the queue
   */
  hasUserInQueue(userId: string): boolean {
    return this.queue.some(item => item.userId === userId) ||
           (this.activeJob !== null && this.activeJob.userId === userId);
  }
}

// Singleton instance
export const webQueue = new WebQueue();
