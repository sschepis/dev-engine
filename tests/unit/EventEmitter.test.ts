// =============================================================================
// OpenClaw DevEngine - EventEmitter Unit Tests
// =============================================================================

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { 
  EngineEventEmitter, 
  ProgressTracker, 
  ConsoleEventLogger 
} from '../../src/core/EventEmitter.js';
import { EngineEvent, EventHandler } from '../../src/interfaces/index.js';

// Helper to create typed mock handlers
function createMockHandler(): { handler: EventHandler; mock: jest.Mock } {
  const mock = jest.fn();
  const handler: EventHandler = async (e) => { mock(e); };
  return { handler, mock };
}

describe('EngineEventEmitter', () => {
  let emitter: EngineEventEmitter;

  beforeEach(() => {
    emitter = new EngineEventEmitter();
  });

  describe('on() and emit()', () => {
    it('should call handler when event is emitted', async () => {
      const { handler, mock } = createMockHandler();
      
      emitter.on('task:start', handler);
      await emitter.emit('task:start', { taskId: 'test' });

      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock).toHaveBeenCalledWith(expect.objectContaining({
        type: 'task:start',
        data: { taskId: 'test' }
      }));
    });

    it('should not call handler for different event type', async () => {
      const { handler, mock } = createMockHandler();
      
      emitter.on('task:start', handler);
      await emitter.emit('task:complete', { taskId: 'test' });

      expect(mock).not.toHaveBeenCalled();
    });

    it('should call multiple handlers for same event', async () => {
      const { handler: handler1, mock: mock1 } = createMockHandler();
      const { handler: handler2, mock: mock2 } = createMockHandler();
      
      emitter.on('task:start', handler1);
      emitter.on('task:start', handler2);
      await emitter.emit('task:start', { taskId: 'test' });

      expect(mock1).toHaveBeenCalledTimes(1);
      expect(mock2).toHaveBeenCalledTimes(1);
    });

    it('should include timestamp in event', async () => {
      let receivedTimestamp: Date | undefined;
      const handler: EventHandler = async (e) => { receivedTimestamp = e.timestamp; };
      
      emitter.on('task:start', handler);
      await emitter.emit('task:start', {});

      expect(receivedTimestamp).toBeInstanceOf(Date);
    });
  });

  describe('off()', () => {
    it('should remove handler', async () => {
      const { handler, mock } = createMockHandler();
      
      emitter.on('task:start', handler);
      emitter.off('task:start', handler);
      await emitter.emit('task:start', {});

      expect(mock).not.toHaveBeenCalled();
    });

    it('should only remove specified handler', async () => {
      const { handler: handler1, mock: mock1 } = createMockHandler();
      const { handler: handler2, mock: mock2 } = createMockHandler();
      
      emitter.on('task:start', handler1);
      emitter.on('task:start', handler2);
      emitter.off('task:start', handler1);
      await emitter.emit('task:start', {});

      expect(mock1).not.toHaveBeenCalled();
      expect(mock2).toHaveBeenCalled();
    });
  });

  describe('once()', () => {
    it('should only call handler once', async () => {
      const { handler, mock } = createMockHandler();
      
      emitter.once('task:start', handler);
      await emitter.emit('task:start', {});
      await emitter.emit('task:start', {});

      expect(mock).toHaveBeenCalledTimes(1);
    });
  });

  describe('onAny()', () => {
    it('should receive all events', async () => {
      const { handler, mock } = createMockHandler();
      
      emitter.onAny(handler);
      await emitter.emit('task:start', { id: 1 });
      await emitter.emit('task:complete', { id: 2 });
      await emitter.emit('phase:start', { phase: 'test' });

      expect(mock).toHaveBeenCalledTimes(3);
    });
  });

  describe('offAny()', () => {
    it('should remove wildcard handler', async () => {
      const { handler, mock } = createMockHandler();
      
      emitter.onAny(handler);
      emitter.offAny(handler);
      await emitter.emit('task:start', {});

      expect(mock).not.toHaveBeenCalled();
    });
  });

  describe('getHistory()', () => {
    it('should record emitted events', async () => {
      await emitter.emit('task:start', { taskId: 'a' });
      await emitter.emit('task:complete', { taskId: 'a' });

      const history = emitter.getHistory();

      expect(history).toHaveLength(2);
      expect(history[0].type).toBe('task:start');
      expect(history[1].type).toBe('task:complete');
    });

    it('should filter by event type', async () => {
      await emitter.emit('task:start', { taskId: 'a' });
      await emitter.emit('task:complete', { taskId: 'a' });
      await emitter.emit('task:start', { taskId: 'b' });

      const history = emitter.getHistory('task:start');

      expect(history).toHaveLength(2);
      expect(history.every(e => e.type === 'task:start')).toBe(true);
    });

    it('should respect max history size', async () => {
      const smallEmitter = new EngineEventEmitter({ maxHistorySize: 3 });

      for (let i = 0; i < 5; i++) {
        await smallEmitter.emit('task:start', { index: i });
      }

      const history = smallEmitter.getHistory();
      expect(history).toHaveLength(3);
      // Should keep most recent
      expect(history[0].data.index).toBe(2);
    });
  });

  describe('clearHistory()', () => {
    it('should clear event history', async () => {
      await emitter.emit('task:start', {});
      await emitter.emit('task:start', {});

      emitter.clearHistory();

      expect(emitter.getHistory()).toHaveLength(0);
    });
  });

  describe('listenerCount()', () => {
    it('should count listeners for event type', () => {
      const h1: EventHandler = async () => {};
      const h2: EventHandler = async () => {};
      const h3: EventHandler = async () => {};
      
      emitter.on('task:start', h1);
      emitter.on('task:start', h2);
      emitter.on('task:complete', h3);

      expect(emitter.listenerCount('task:start')).toBe(2);
      expect(emitter.listenerCount('task:complete')).toBe(1);
    });

    it('should include wildcard handlers in count', () => {
      const h1: EventHandler = async () => {};
      const h2: EventHandler = async () => {};
      
      emitter.on('task:start', h1);
      emitter.onAny(h2);

      expect(emitter.listenerCount('task:start')).toBe(2);
    });
  });

  describe('removeAllListeners()', () => {
    it('should remove all handlers', async () => {
      const { handler: handler1, mock: mock1 } = createMockHandler();
      const { handler: handler2, mock: mock2 } = createMockHandler();
      const { handler: wildcardHandler, mock: wildcardMock } = createMockHandler();

      emitter.on('task:start', handler1);
      emitter.on('task:complete', handler2);
      emitter.onAny(wildcardHandler);

      emitter.removeAllListeners();

      await emitter.emit('task:start', {});
      await emitter.emit('task:complete', {});

      expect(mock1).not.toHaveBeenCalled();
      expect(mock2).not.toHaveBeenCalled();
      expect(wildcardMock).not.toHaveBeenCalled();
    });
  });

  describe('waitFor()', () => {
    it('should resolve when event is emitted', async () => {
      const promise = emitter.waitFor('task:complete');
      
      // Emit after a delay
      setTimeout(() => {
        emitter.emit('task:complete', { taskId: 'test' });
      }, 10);

      const event = await promise;

      expect(event.type).toBe('task:complete');
      expect(event.data.taskId).toBe('test');
    });

    it('should reject on timeout', async () => {
      const promise = emitter.waitFor('task:complete', 50);

      await expect(promise).rejects.toThrow('Timeout');
    });
  });

  describe('filter()', () => {
    it('should create filtered event stream', async () => {
      const events: EngineEvent[] = [];
      
      const filtered = emitter.filter(e => e.data.important === true);
      const handler: EventHandler = async (e) => { events.push(e); };
      filtered.on(handler);

      await emitter.emit('task:start', { important: true });
      await emitter.emit('task:start', { important: false });
      await emitter.emit('task:complete', { important: true });

      expect(events).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('should continue calling handlers even if one throws', async () => {
      const errorHandler: EventHandler = async () => { throw new Error('Handler error'); };
      const { handler: normalHandler, mock: normalMock } = createMockHandler();

      emitter.on('task:start', errorHandler);
      emitter.on('task:start', normalHandler);

      await emitter.emit('task:start', {});

      expect(normalMock).toHaveBeenCalled();
    });
  });
});

describe('ProgressTracker', () => {
  let emitter: EngineEventEmitter;
  let tracker: ProgressTracker;

  beforeEach(() => {
    emitter = new EngineEventEmitter();
    tracker = new ProgressTracker(emitter);
  });

  describe('getProgress()', () => {
    it('should track task completion', async () => {
      await emitter.emit('engine:start', { taskCount: 5 });
      await emitter.emit('task:complete', {});
      await emitter.emit('task:complete', {});

      const progress = tracker.getProgress();

      expect(progress.totalTasks).toBe(5);
      expect(progress.completedTasks).toBe(2);
      expect(progress.percentage).toBe(40);
    });

    it('should track failed tasks', async () => {
      await emitter.emit('engine:start', { taskCount: 5 });
      await emitter.emit('task:complete', {});
      await emitter.emit('task:failed', {});

      const progress = tracker.getProgress();

      expect(progress.completedTasks).toBe(1);
      expect(progress.failedTasks).toBe(1);
    });

    it('should track current phase', async () => {
      await emitter.emit('phase:start', { phase: 'planning' });

      const progress = tracker.getProgress();

      expect(progress.phase).toBe('planning');
    });
  });

  describe('onProgress()', () => {
    it('should notify on progress changes', async () => {
      const callback = jest.fn();
      tracker.onProgress(callback);

      await emitter.emit('engine:start', { taskCount: 2 });
      await emitter.emit('task:complete', {});

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        completedTasks: 1
      }));
    });
  });
});

describe('ConsoleEventLogger', () => {
  let emitter: EngineEventEmitter;
  let logMock: jest.Mock;

  beforeEach(() => {
    emitter = new EngineEventEmitter();
    logMock = jest.fn();
    console.log = logMock as unknown as typeof console.log;
  });

  it('should log engine start', async () => {
    new ConsoleEventLogger(emitter);

    await emitter.emit('engine:start', { taskCount: 5 });

    expect(logMock).toHaveBeenCalledWith(expect.stringContaining('5 tasks'));
  });

  it('should log task completion', async () => {
    new ConsoleEventLogger(emitter);

    await emitter.emit('task:complete', { taskId: 'test-task', duration: 100 });

    expect(logMock).toHaveBeenCalledWith(expect.stringContaining('test-task'));
  });

  it('should log phase changes', async () => {
    new ConsoleEventLogger(emitter);

    await emitter.emit('phase:start', { phase: 'planning' });

    expect(logMock).toHaveBeenCalledWith(expect.stringContaining('planning'));
  });

  it('should log LLM requests in verbose mode', async () => {
    new ConsoleEventLogger(emitter, true);

    await emitter.emit('llm:request', { prompt: 'test prompt here' });

    expect(logMock).toHaveBeenCalledWith(expect.stringContaining('LLM Request'));
  });
});
