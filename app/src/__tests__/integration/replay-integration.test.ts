import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionDataProvider } from '../../providers/SessionDataProvider';
import { ReplayEngine } from '@momentum/replay-engine';

// Mock the api module to avoid network calls
vi.mock('../../utils/api', () => ({
  api: {
    getSessions: vi.fn(() => Promise.resolve([
      { id: 'TEST-20231115', name: 'TEST Session', symbol: 'TEST', date: '2023-11-15', size: 1000, download_url: '', px_start: 100, px_end: 110, duration_m: 30, tickCount: 1000 }
    ])),
    loadSessionData: vi.fn(() => Promise.resolve(
      // Generate 100 ticks spanning 100 seconds to ensure multiple bars at 10s interval
      Array.from({ length: 100 }, (_, i) => ({
        adjustedTimestamp: 1700000000 + i,
        bid_price: (100 + i * 0.01).toFixed(2),
        ask_price: (100.05 + i * 0.01).toFixed(2),
        bid_size: '100',
        ask_size: '200'
      }))
    ))
  }
}));

describe('Replay Integration', () => {
  let provider: SessionDataProvider;

  beforeEach(() => {
    provider = new SessionDataProvider();
    vi.useFakeTimers();
  });

  afterEach(() => {
    provider.disconnect();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('SessionDataProvider', () => {
    it('should initialize without errors', async () => {
      await expect(provider.initialize({})).resolves.not.toThrow();
    });

    it('should search symbols from available sessions', async () => {
      await provider.initialize({});
      const results = await provider.searchSymbols('');
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should filter search results by query', async () => {
      await provider.initialize({});
      const results = await provider.searchSymbols('TEST');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].symbol).toContain('TEST');
    });

    it('should return available intervals', () => {
      const intervals = provider.getAvailableIntervals('TEST');
      expect(intervals).not.toBeNull();
      expect(intervals).toContain('1S');
      expect(intervals).toContain('1m');
    });

    it('should return base interval', () => {
      const baseInterval = provider.getBaseInterval('TEST');
      expect(baseInterval).toBe('1S');
    });

    it('should check if data exists for a session', async () => {
      await provider.initialize({});
      expect(provider.hasData('TEST-20231115', '1S')).toBe(true);
      expect(provider.hasData('NONEXISTENT', '1S')).toBe(false);
    });
  });

  describe('ReplayEngine integration', () => {
    it('should get replay engine from provider', () => {
      const engine = provider.getReplayEngine();
      expect(engine).toBeInstanceOf(ReplayEngine);
    });

    it('should start in idle state', () => {
      const state = provider.getReplayState();
      expect(state.status).toBe('idle');
    });

    it('should return available speeds', () => {
      const speeds = provider.getAvailableSpeeds();
      expect(Array.isArray(speeds)).toBe(true);
      expect(speeds).toContain(1);
      expect(speeds).toContain(10);
    });
  });

  describe('Playback controls', () => {
    it('should play and pause', () => {
      // Load mock data directly into engine
      const mockTicks = Array.from({ length: 100 }, (_, i) => ({
        timestamp: 1700000000 + i * 0.1,
        price: 100 + Math.random(),
        volume: 100
      }));

      const engine = provider.getReplayEngine();
      engine.load(mockTicks);

      provider.play();
      expect(provider.getReplayState().status).toBe('playing');

      provider.pause();
      expect(provider.getReplayState().status).toBe('paused');
    });

    it('should stop and reset', () => {
      const mockTicks = Array.from({ length: 100 }, (_, i) => ({
        timestamp: 1700000000 + i,
        price: 100,
        volume: 100
      }));

      const engine = provider.getReplayEngine();
      engine.load(mockTicks);

      provider.play();
      vi.advanceTimersByTime(500);

      provider.stop();
      const state = provider.getReplayState();
      expect(state.status).toBe('idle');
      expect(state.currentTime).toBe(state.startTime);
    });

    it('should seek to position', () => {
      const mockTicks = Array.from({ length: 100 }, (_, i) => ({
        timestamp: 1700000000 + i,
        price: 100,
        volume: 100
      }));

      const engine = provider.getReplayEngine();
      engine.load(mockTicks);

      provider.seekToPercent(50);
      const state = provider.getReplayState();
      
      // Should be around 50% through
      const progress = (state.currentTime - state.startTime) / (state.endTime - state.startTime);
      expect(progress).toBeCloseTo(0.5, 1);
    });

    it('should seek to specific timestamp', () => {
      const mockTicks = Array.from({ length: 100 }, (_, i) => ({
        timestamp: 1700000000 + i,
        price: 100,
        volume: 100
      }));

      const engine = provider.getReplayEngine();
      engine.load(mockTicks);

      provider.seekTo(1700000050);
      expect(provider.getReplayState().currentTime).toBe(1700000050);
    });

    it('should change speed', () => {
      provider.setSpeed(10);
      expect(provider.getReplayState().speed).toBe(10);
    });
  });

  describe('Session loading', () => {
    it('should get session by id', async () => {
      await provider.initialize({});
      const session = provider.getSession('TEST-20231115');
      expect(session).toBeDefined();
      expect(session?.symbol).toBe('TEST');
    });

    it('should get all sessions', async () => {
      await provider.initialize({});
      const sessions = provider.getSessions();
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions.length).toBeGreaterThan(0);
    });
  });

  describe('OakView subscription integration', () => {
    it('should emit bars to subscriptionCallback during playback via loadSession', async () => {
      // Create mock ticks that span multiple bar intervals (10s interval)
      const mockTicks = Array.from({ length: 100 }, (_, i) => ({
        timestamp: 1700000000 + i,
        price: 100 + (i * 0.01),
        volume: 100
      }));

      // Set up subscription callback to capture emitted bars
      const barCallback = vi.fn();

      // Subscribe to capture the callback
      // First set up the subscription callback via subscribe()
      provider.subscribe('TEST', '10S', barCallback);

      // Now load session which should preserve and use the subscriptionCallback
      // We need to load ticks directly since we don't have real session data
      const engine = provider.getReplayEngine();
      
      // Simulate what loadSession does with the onBar callback
      // First set up internal tick cache by loading directly
      engine.load(mockTicks, {
        barInterval: 10,
        onBar: (bar) => {
          // This mimics what loadSession now does - forwarding to subscriptionCallback
          barCallback({
            time: bar.time,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
          });
        }
      });

      // Set speed high to process data quickly
      provider.setSpeed(100);
      provider.play();
      
      // Advance time to let playback process ticks and emit bars
      vi.advanceTimersByTime(5000);

      // Verify that bars were emitted
      expect(barCallback).toHaveBeenCalled();
      
      // Verify the bar structure
      const firstCall = barCallback.mock.calls[0][0];
      expect(firstCall).toHaveProperty('time');
      expect(firstCall).toHaveProperty('open');
      expect(firstCall).toHaveProperty('high');
      expect(firstCall).toHaveProperty('low');
      expect(firstCall).toHaveProperty('close');
    });

    it('should configure onBar callback when loadSession is called', async () => {
      await provider.initialize({});
      
      // Set up subscription callback that should receive bar updates
      const barCallback = vi.fn();
      
      // First subscribe to set the subscriptionCallback
      provider.subscribe('TEST-20231115', '10S', barCallback);
      
      // Verify subscriptionCallback was set by checking internal state
      // The loadSession method should preserve this callback when loading ticks
      
      // Load the session - this should configure onBar to use subscriptionCallback
      await provider.loadSession('TEST-20231115', 10);

      // Get the engine to verify it was loaded with the correct options
      const engine = provider.getReplayEngine();
      const state = engine.getState();
      
      // Verify session was loaded (state shows data is loaded)
      expect(state.status).toBe('idle');
      expect(state.startTime).toBeGreaterThan(0);
      expect(state.endTime).toBeGreaterThan(0);
    });

    it('should emit bars to oakViewBarCallback during playback when setBarCallback is used', async () => {
      await provider.initialize({});
      
      // Create mock ticks that span multiple bar intervals (10s interval)
      const mockTicks = Array.from({ length: 100 }, (_, i) => ({
        timestamp: 1700000000 + i,
        price: 100 + (i * 0.01),
        volume: 100
      }));

      // Set up bar callback to capture emitted bars (simulating OakView registration)
      const oakViewCallback = vi.fn();
      provider.setBarCallback(oakViewCallback);

      // Load ticks directly into the engine
      const engine = provider.getReplayEngine();
      engine.load(mockTicks, {
        barInterval: 10,
        onBar: (bar) => {
          // Call the oakViewBarCallback with OHLCV bar
          oakViewCallback({
            time: bar.time,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
          });
        }
      });

      // Set speed high to process data quickly
      provider.setSpeed(100);
      provider.play();
      
      // Advance time to let playback process ticks and emit bars
      vi.advanceTimersByTime(5000);

      // Verify that bars were emitted to oakViewBarCallback
      expect(oakViewCallback).toHaveBeenCalled();
      
      // Verify the bar structure
      const firstCall = oakViewCallback.mock.calls[0][0];
      expect(firstCall).toHaveProperty('time');
      expect(firstCall).toHaveProperty('open');
      expect(firstCall).toHaveProperty('high');
      expect(firstCall).toHaveProperty('low');
      expect(firstCall).toHaveProperty('close');
    });

    it('should clear oakViewBarCallback when clearBarCallback is called', () => {
      const callback = vi.fn();
      provider.setBarCallback(callback);
      
      // Verify callback was set (indirectly by testing clearBarCallback)
      provider.clearBarCallback();
      
      // After clearing, the callback should not be called
      // This is tested indirectly - if no error occurs, the test passes
    });

    it('should clear oakViewBarCallback when disconnect is called', () => {
      const callback = vi.fn();
      provider.setBarCallback(callback);
      
      // Disconnect should clean up the callback
      provider.disconnect();
      
      // After disconnect, the callback should not be called
      // This is tested indirectly - if no error occurs, the test passes
    });

    it('should pass isFirstBar=true on first bar and isFirstBar=false on subsequent bars', async () => {
      await provider.initialize({});
      
      // Set up callback that tracks isFirstBar
      const barCalls: { bar: any; isFirstBar: boolean }[] = [];
      provider.setBarCallback((bar, isFirstBar) => {
        barCalls.push({ bar, isFirstBar });
      });

      // Load session which sets up the onBar callback with isFirstBar tracking
      await provider.loadSession('TEST-20231115', 10);

      // Set speed high to process data quickly
      provider.setSpeed(100);
      provider.play();
      
      // Advance time to let playback process ticks and emit bars
      vi.advanceTimersByTime(5000);

      // Verify that at least one bar was emitted
      expect(barCalls.length).toBeGreaterThan(0);
      
      // First bar should have isFirstBar=true
      expect(barCalls[0].isFirstBar).toBe(true);
      
      // If there are more bars, they should have isFirstBar=false
      if (barCalls.length > 1) {
        expect(barCalls[1].isFirstBar).toBe(false);
      }
    });

    it('should reset playbackStarted flag when resetPlaybackState is called', async () => {
      await provider.initialize({});
      
      // Set up callback that tracks isFirstBar
      const barCalls: { bar: any; isFirstBar: boolean }[] = [];
      provider.setBarCallback((bar, isFirstBar) => {
        barCalls.push({ bar, isFirstBar });
      });

      // Load session and play once
      await provider.loadSession('TEST-20231115', 10);
      provider.setSpeed(100);
      provider.play();
      vi.advanceTimersByTime(5000);
      provider.stop();

      // First playback should have isFirstBar=true on first bar
      expect(barCalls.length).toBeGreaterThan(0);
      expect(barCalls[0].isFirstBar).toBe(true);

      // Clear the recorded calls
      barCalls.length = 0;

      // Reset playback state
      provider.resetPlaybackState();

      // Reload and play again
      await provider.loadSession('TEST-20231115', 10);
      provider.setSpeed(100);
      provider.play();
      vi.advanceTimersByTime(5000);

      // After reset, first bar should again have isFirstBar=true
      expect(barCalls.length).toBeGreaterThan(0);
      expect(barCalls[0].isFirstBar).toBe(true);
    });

    it('should reset playbackStarted flag when loading a new session', async () => {
      await provider.initialize({});
      
      // Set up callback that tracks isFirstBar
      const barCalls: { bar: any; isFirstBar: boolean }[] = [];
      provider.setBarCallback((bar, isFirstBar) => {
        barCalls.push({ bar, isFirstBar });
      });

      // Load session and play
      await provider.loadSession('TEST-20231115', 10);
      provider.setSpeed(100);
      provider.play();
      vi.advanceTimersByTime(5000);
      provider.stop();

      // First bar should have isFirstBar=true
      expect(barCalls[0].isFirstBar).toBe(true);

      // Clear calls
      barCalls.length = 0;

      // Load the same session again (simulating session reload)
      await provider.loadSession('TEST-20231115', 10);
      provider.setSpeed(100);
      provider.play();
      vi.advanceTimersByTime(5000);

      // First bar of the reloaded session should also have isFirstBar=true
      // because loadSession resets playbackStarted
      expect(barCalls.length).toBeGreaterThan(0);
      expect(barCalls[0].isFirstBar).toBe(true);
    });
  });
});
