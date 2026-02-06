// =============================================================================
// OpenClaw DevEngine - Event System
// =============================================================================

import { IEventEmitter, EngineEventType, EventHandler, EngineEvent } from '../interfaces/index.js';

/**
 * Type-safe event emitter for the DevEngine.
 * Provides pub/sub functionality for monitoring execution progress.
 */
export class EngineEventEmitter implements IEventEmitter {
  private handlers: Map<EngineEventType, Set<EventHandler>> = new Map();
  private wildcardHandlers: Set<EventHandler> = new Set();
  private eventHistory: EngineEvent[] = [];
  private maxHistorySize: number;

  constructor(options: { maxHistorySize?: number } = {}) {
    this.maxHistorySize = options.maxHistorySize ?? 1000;
  }

  /**
   * Subscribe to a specific event type
   */
  on(event: EngineEventType, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  /**
   * Subscribe to all events
   */
  onAny(handler: EventHandler): void {
    this.wildcardHandlers.add(handler);
  }

  /**
   * Unsubscribe from a specific event type
   */
  off(event: EngineEventType, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  /**
   * Unsubscribe from all events
   */
  offAny(handler: EventHandler): void {
    this.wildcardHandlers.delete(handler);
  }

  /**
   * Subscribe to an event only once
   */
  once(event: EngineEventType, handler: EventHandler): void {
    const wrappedHandler: EventHandler = async (e) => {
      this.off(event, wrappedHandler);
      await handler(e);
    };
    this.on(event, wrappedHandler);
  }

  /**
   * Emit an event to all subscribers
   */
  async emit(event: EngineEventType, data: Record<string, unknown>): Promise<void> {
    const eventObj: EngineEvent = {
      type: event,
      timestamp: new Date(),
      data
    };

    // Store in history
    this.eventHistory.push(eventObj);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Notify specific handlers
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(eventObj);
        } catch (error) {
          console.error(`Event handler error for ${event}:`, error);
        }
      }
    }

    // Notify wildcard handlers
    for (const handler of this.wildcardHandlers) {
      try {
        await handler(eventObj);
      } catch (error) {
        console.error(`Wildcard event handler error:`, error);
      }
    }
  }

  /**
   * Get event history, optionally filtered by type
   */
  getHistory(eventType?: EngineEventType): EngineEvent[] {
    if (eventType) {
      return this.eventHistory.filter(e => e.type === eventType);
    }
    return [...this.eventHistory];
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Get count of subscribers for an event type
   */
  listenerCount(event: EngineEventType): number {
    return (this.handlers.get(event)?.size ?? 0) + this.wildcardHandlers.size;
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
  }

  /**
   * Wait for a specific event to occur
   */
  waitFor(event: EngineEventType, timeout?: number): Promise<EngineEvent> {
    return new Promise((resolve, reject) => {
      const timeoutId = timeout
        ? setTimeout(() => {
            this.off(event, handler);
            reject(new Error(`Timeout waiting for event: ${event}`));
          }, timeout)
        : null;

      const handler: EventHandler = async (e) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve(e);
      };

      this.once(event, handler);
    });
  }

  /**
   * Create a filtered event stream
   */
  filter(predicate: (event: EngineEvent) => boolean): FilteredEventEmitter {
    return new FilteredEventEmitter(this, predicate);
  }
}

/**
 * Filtered event emitter that only receives events matching a predicate
 */
class FilteredEventEmitter {
  private handlers: Set<EventHandler> = new Set();

  constructor(
    private parent: EngineEventEmitter,
    private predicate: (event: EngineEvent) => boolean
  ) {
    this.parent.onAny(async (event) => {
      if (this.predicate(event)) {
        for (const handler of this.handlers) {
          await handler(event);
        }
      }
    });
  }

  on(handler: EventHandler): void {
    this.handlers.add(handler);
  }

  off(handler: EventHandler): void {
    this.handlers.delete(handler);
  }
}

/**
 * Progress tracker built on top of events
 */
export class ProgressTracker {
  private totalTasks = 0;
  private completedTasks = 0;
  private failedTasks = 0;
  private currentPhase = '';
  private progressCallbacks: Array<(progress: ProgressInfo) => void> = [];

  constructor(emitter: EngineEventEmitter) {
    emitter.on('engine:start', async (e) => {
      this.totalTasks = (e.data.taskCount as number) || 0;
      this.completedTasks = 0;
      this.failedTasks = 0;
      this.notifyProgress();
    });

    emitter.on('phase:start', async (e) => {
      this.currentPhase = (e.data.phase as string) || '';
      this.notifyProgress();
    });

    emitter.on('task:complete', async () => {
      this.completedTasks++;
      this.notifyProgress();
    });

    emitter.on('task:failed', async () => {
      this.failedTasks++;
      this.notifyProgress();
    });
  }

  /**
   * Subscribe to progress updates
   */
  onProgress(callback: (progress: ProgressInfo) => void): void {
    this.progressCallbacks.push(callback);
  }

  /**
   * Get current progress
   */
  getProgress(): ProgressInfo {
    return {
      phase: this.currentPhase,
      totalTasks: this.totalTasks,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      percentage: this.totalTasks > 0 
        ? Math.round((this.completedTasks / this.totalTasks) * 100) 
        : 0
    };
  }

  private notifyProgress(): void {
    const progress = this.getProgress();
    for (const callback of this.progressCallbacks) {
      callback(progress);
    }
  }
}

export interface ProgressInfo {
  phase: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  percentage: number;
}

/**
 * Console logger that subscribes to events
 */
export class ConsoleEventLogger {
  constructor(emitter: EngineEventEmitter, verbose = false) {
    emitter.on('engine:start', async (e) => {
      console.log(`\n🚀 Starting execution with ${e.data.taskCount} tasks`);
    });

    emitter.on('phase:start', async (e) => {
      console.log(`\n📋 Phase: ${e.data.phase}`);
    });

    emitter.on('task:start', async (e) => {
      console.log(`  ⏳ ${e.data.taskId}: Starting (attempt ${e.data.attempt})`);
    });

    emitter.on('task:complete', async (e) => {
      console.log(`  ✅ ${e.data.taskId}: Completed in ${e.data.duration}ms`);
    });

    emitter.on('task:failed', async (e) => {
      console.log(`  ❌ ${e.data.taskId}: Failed after ${e.data.attempts} attempts`);
      if (verbose && e.data.error) {
        console.log(`     Error: ${e.data.error}`);
      }
    });

    emitter.on('task:retry', async (e) => {
      console.log(`  🔄 ${e.data.taskId}: Retrying (attempt ${(e.data.attempt as number) + 1})`);
    });

    emitter.on('engine:complete', async (e) => {
      console.log(`\n🎉 Execution complete: ${e.data.completed} succeeded, ${e.data.failed} failed`);
    });

    emitter.on('engine:error', async (e) => {
      console.error(`\n💥 Execution error: ${e.data.error}`);
    });

    if (verbose) {
      emitter.on('llm:request', async (e) => {
        console.log(`  🤖 LLM Request: ${(e.data.prompt as string)?.slice(0, 50)}...`);
      });

      emitter.on('checkpoint:saved', async (e) => {
        console.log(`  💾 Checkpoint saved: ${e.data.planId}`);
      });
    }
  }
}
