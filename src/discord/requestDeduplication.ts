/**
 * Request Deduplication - Ensures each Discord message/interaction is processed exactly once
 * 
 * Prevents duplicate progress messages and error messages when:
 * - Discord sends duplicate events
 * - Retry logic inadvertently re-processes the same request
 * - Multiple code paths trigger the same handler
 * 
 * PART E: Enforces exactly ONE progress message per jobId per channel
 */

export interface InFlightRequest {
  requestId: string;
  progressMessageId: string | null;
  startedAt: number;
  finalized: boolean;
  hasFinalResponse: boolean; // Set to true after sending final output (files/message)
  jobId?: string; // Track job association
}

/**
 * Discord message event deduplication
 * Prevents duplicate event processing with TTL-based cleanup
 */
interface DiscordEventEntry {
  key: string; // guildId:channelId:messageId
  timestamp: number;
}

class DiscordEventRegistry {
  private readonly events = new Map<string, DiscordEventEntry>();
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Check if we've already seen this Discord message event
   */
  hasSeen(guildId: string | null, channelId: string, messageId: string): boolean {
    this.cleanup();
    const key = `${guildId || 'dm'}:${channelId}:${messageId}`;
    return this.events.has(key);
  }

  /**
   * Mark Discord message event as seen
   */
  markSeen(guildId: string | null, channelId: string, messageId: string): void {
    const key = `${guildId || 'dm'}:${channelId}:${messageId}`;
    this.events.set(key, { key, timestamp: Date.now() });
  }

  /**
   * Remove old entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.events.entries()) {
      if (now - entry.timestamp > this.TTL_MS) {
        this.events.delete(key);
      }
    }
  }
}

export const discordEventRegistry = new DiscordEventRegistry();

/**
 * Global deduplication registry
 * Maps requestId → InFlightRequest state
 */
class RequestRegistry {
  private readonly requests = new Map<string, InFlightRequest>();
  private readonly TTL_MS = 30 * 60 * 1000; // 30 minutes - cleanup old entries

  /**
   * Try to register a new request. Returns null if already in-flight (duplicate).
   * Otherwise returns the registered request state.
   */
  register(requestId: string): InFlightRequest | null {
    // Cleanup old entries
    this.cleanup();

    // Check if already exists (either in-flight OR recently finalized)
    const existing = this.requests.get(requestId);
    if (existing) {
      // Reject duplicates within TTL window (prevents retry storms)
      const age = Date.now() - existing.startedAt;
      if (age < this.TTL_MS) {
        console.log(`⚠️ [DEDUP] Request ${requestId} already exists (finalized=${existing.finalized}, age=${Math.round(age/1000)}s), ignoring duplicate`);
        return null; // Duplicate - reject
      }
      // If older than TTL, allow re-registration (cleanup will remove old entry)
    }

    // Register new request
    const request: InFlightRequest = {
      requestId,
      progressMessageId: null,
      startedAt: Date.now(),
      finalized: false,
      hasFinalResponse: false,
    };
    this.requests.set(requestId, request);
    console.log(`✓ [DEDUP] Registered new request ${requestId}`);
    return request;
  }

  /**
   * Update progress message ID after it's created
   * Enforces ONE progress message per job
   */
  setProgressMessageId(requestId: string, messageId: string, jobId?: string): void {
    const request = this.requests.get(requestId);
    if (request) {
      request.progressMessageId = messageId;
      if (jobId) {
        request.jobId = jobId;
      }
      console.log(`✓ [DEDUP] Set progress message ${messageId} for request ${requestId}${jobId ? ` (job ${jobId})` : ''}`);
    }
  }

  /**
   * Get progress message ID for a job (enforces ONE message per job)
   */
  getProgressMessageForJob(jobId: string): string | null {
    for (const [, request] of this.requests.entries()) {
      if (request.jobId === jobId && request.progressMessageId) {
        return request.progressMessageId;
      }
    }
    return null;
  }

  /**
   * Mark request as finalized (completed or failed)
   */
  finalize(requestId: string): void {
    const request = this.requests.get(requestId);
    if (request) {
      request.finalized = true;
      console.log(`✓ [DEDUP] Finalized request ${requestId}`);
      // Keep in map for a bit to catch late duplicates, cleanup() will remove later
    }
  }

  /**
   * Check if request is already finalized
   */
  isFinalized(requestId: string): boolean {
    const request = this.requests.get(requestId);
    return request?.finalized ?? false;
  }

  /**
   * Mark that final response was sent (files/message delivered to user)
   */
  setFinalResponseSent(requestId: string): void {
    const request = this.requests.get(requestId);
    if (request) {
      request.hasFinalResponse = true;
      console.log(`✓ [DEDUP] Final response sent for request ${requestId}`);
    }
  }

  /**
   * Check if final response was already sent
   */
  hasFinalResponse(requestId: string): boolean {
    const request = this.requests.get(requestId);
    return request?.hasFinalResponse ?? false;
  }

  /**
   * Get request state
   */
  get(requestId: string): InFlightRequest | undefined {
    return this.requests.get(requestId);
  }

  /**
   * Cleanup old finalized requests
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [requestId, request] of this.requests.entries()) {
      if (request.finalized && now - request.startedAt > this.TTL_MS) {
        this.requests.delete(requestId);
        console.log(`🧹 [DEDUP] Cleaned up old request ${requestId}`);
      }
    }
  }

  /**
   * Get current size (for testing/debugging)
   */
  size(): number {
    return this.requests.size;
  }

  /**
   * Clear all (for testing)
   */
  clear(): void {
    this.requests.clear();
  }
}

// Singleton instance
export const requestRegistry = new RequestRegistry();
