import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionDataProvider } from '../../providers/SessionDataProvider';
import { ReplayEngine } from '@momentum/replay-engine';

// Mock the api module to avoid network calls
vi.mock('../../utils/api', () => ({
  api: {
    getSessions: vi.fn(() => Promise.resolve([
      { id: 'TEST-20231115', name: 'TEST Session', symbol: 'TEST', date: '2023-11-15', size: 1000, download_url: '', px_start: 100, px_end: 110, duration_m: 30, tickCount: 1000 }
    ])),
    loadSessionData: vi.fn(() => Promise.resolve([
      { adjustedTimestamp: 1700000000, bid_price: '100.00', ask_price: '100.05', bid_size: '100', ask_size: '200' },
      { adjustedTimestamp: 1700000001, bid_price: '100.02', ask_price: '100.07', bid_size: '150', ask_size: '180' },
    ]))
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
});
