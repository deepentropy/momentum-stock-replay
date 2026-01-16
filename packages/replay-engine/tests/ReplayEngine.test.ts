import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReplayEngine } from '../src/ReplayEngine';
import type { TickData, ReplayState } from '../src/types';

describe('ReplayEngine', () => {
  let engine: ReplayEngine;

  // Sample tick data for testing
  const sampleTicks: TickData[] = [
    { timestamp: 1000, price: 100, volume: 100 },
    { timestamp: 1010, price: 101, volume: 50 },
    { timestamp: 1020, price: 99, volume: 75 },
    { timestamp: 1060, price: 102, volume: 200 }, // New bar
    { timestamp: 1070, price: 103, volume: 150 },
    { timestamp: 1120, price: 105, volume: 100 }, // Another new bar
  ];

  beforeEach(() => {
    engine = new ReplayEngine();
    vi.useFakeTimers();
  });

  afterEach(() => {
    engine.dispose();
    vi.useRealTimers();
  });

  describe('load', () => {
    it('should initialize state correctly with tick data', () => {
      engine.load(sampleTicks);
      const state = engine.getState();

      expect(state.status).toBe('idle');
      expect(state.currentTime).toBe(1000);
      expect(state.startTime).toBe(1000);
      expect(state.endTime).toBe(1120);
      expect(state.speed).toBe(1);
    });

    it('should sort ticks by timestamp', () => {
      const unsortedTicks: TickData[] = [
        { timestamp: 1020, price: 99 },
        { timestamp: 1000, price: 100 },
        { timestamp: 1010, price: 101 },
      ];

      engine.load(unsortedTicks);
      const state = engine.getState();

      expect(state.startTime).toBe(1000);
      expect(state.endTime).toBe(1020);
    });

    it('should handle empty tick array', () => {
      engine.load([]);
      const state = engine.getState();

      expect(state.status).toBe('idle');
      expect(state.startTime).toBe(0);
      expect(state.endTime).toBe(0);
    });

    it('should apply custom options', () => {
      engine.load(sampleTicks, {
        availableSpeeds: [1, 5, 10],
      });

      expect(engine.getAvailableSpeeds()).toEqual([1, 5, 10]);
    });

    it('should reset state when loading new data', () => {
      engine.load(sampleTicks);
      engine.play();
      vi.advanceTimersByTime(500);

      engine.load([{ timestamp: 2000, price: 200 }]);
      const state = engine.getState();

      expect(state.status).toBe('idle');
      expect(state.currentTime).toBe(2000);
    });

    it('should emit stateChange event on load', () => {
      const stateChangeFn = vi.fn();
      engine.on('stateChange', stateChangeFn);

      engine.load(sampleTicks);

      expect(stateChangeFn).toHaveBeenCalled();
    });
  });

  describe('play', () => {
    beforeEach(() => {
      engine.load(sampleTicks);
    });

    it('should change status to playing', () => {
      engine.play();
      expect(engine.getState().status).toBe('playing');
    });

    it('should not restart if already playing', () => {
      engine.play();
      const stateChangeFn = vi.fn();
      engine.on('stateChange', stateChangeFn);

      engine.play(); // Should not emit another state change

      expect(stateChangeFn).not.toHaveBeenCalled();
    });

    it('should do nothing with no loaded data', () => {
      const emptyEngine = new ReplayEngine();
      emptyEngine.play();
      expect(emptyEngine.getState().status).toBe('idle');
    });

    it('should reset to start if status was ended', () => {
      // Seek to end and simulate ended state
      engine.seekTo(1120);
      engine.play();
      vi.advanceTimersByTime(1000);

      expect(engine.getState().status).toBe('ended');

      engine.play();
      expect(engine.getState().status).toBe('playing');
      expect(engine.getState().currentTime).toBe(1000); // Reset to start
    });
  });

  describe('pause', () => {
    beforeEach(() => {
      engine.load(sampleTicks);
    });

    it('should change status to paused when playing', () => {
      engine.play();
      engine.pause();

      expect(engine.getState().status).toBe('paused');
    });

    it('should do nothing if not playing', () => {
      const stateChangeFn = vi.fn();
      engine.on('stateChange', stateChangeFn);

      engine.pause();

      expect(stateChangeFn).not.toHaveBeenCalled();
    });

    it('should preserve current position', () => {
      engine.play();
      vi.advanceTimersByTime(200);
      const timeBeforePause = engine.getState().currentTime;

      engine.pause();
      vi.advanceTimersByTime(500);

      expect(engine.getState().currentTime).toBe(timeBeforePause);
    });
  });

  describe('stop', () => {
    beforeEach(() => {
      engine.load(sampleTicks);
    });

    it('should reset to start and set status to idle', () => {
      engine.play();
      vi.advanceTimersByTime(500);
      engine.stop();

      const state = engine.getState();
      expect(state.status).toBe('idle');
      expect(state.currentTime).toBe(state.startTime);
    });

    it('should clear aggregated bars', () => {
      engine.play();
      vi.advanceTimersByTime(500);

      expect(engine.getCurrentBar()).not.toBeNull();

      engine.stop();

      expect(engine.getCurrentBar()).toBeNull();
    });
  });

  describe('seekTo', () => {
    beforeEach(() => {
      engine.load(sampleTicks);
    });

    it('should seek to a specific timestamp', () => {
      engine.seekTo(1060);
      expect(engine.getState().currentTime).toBe(1060);
    });

    it('should clamp to start time if seeking before data', () => {
      engine.seekTo(500);
      expect(engine.getState().currentTime).toBe(1000);
    });

    it('should clamp to end time if seeking beyond data', () => {
      engine.seekTo(2000);
      expect(engine.getState().currentTime).toBe(1120);
    });

    it('should rebuild bars up to the seek point', () => {
      engine.seekTo(1060);
      const bars = engine.getBarsUntil(1060);

      expect(bars.length).toBeGreaterThan(0);
    });

    it('should continue playing if it was playing before seek', () => {
      engine.play();
      engine.seekTo(1060);

      expect(engine.getState().status).toBe('playing');
    });

    it('should do nothing with no loaded data', () => {
      const emptyEngine = new ReplayEngine();
      emptyEngine.seekTo(1000);
      expect(emptyEngine.getState().currentTime).toBe(0);
    });
  });

  describe('seekToPercent', () => {
    beforeEach(() => {
      engine.load(sampleTicks);
    });

    it('should seek to percentage of duration', () => {
      engine.seekToPercent(50);
      const state = engine.getState();

      // 50% of (1120 - 1000) = 60, so target is 1060
      expect(state.currentTime).toBe(1060);
    });

    it('should clamp percent to 0-100 range', () => {
      engine.seekToPercent(-10);
      expect(engine.getState().currentTime).toBe(1000);

      engine.seekToPercent(150);
      expect(engine.getState().currentTime).toBe(1120);
    });
  });

  describe('stepForward / stepBackward', () => {
    beforeEach(() => {
      engine.load(sampleTicks, { barInterval: 60 });
    });

    it('should step forward by bar interval', () => {
      engine.stepForward();
      expect(engine.getState().currentTime).toBe(1060);
    });

    it('should step forward by multiple bars', () => {
      engine.stepForward(2);
      expect(engine.getState().currentTime).toBe(1120);
    });

    it('should step backward by bar interval', () => {
      engine.seekTo(1060);
      engine.stepBackward();
      expect(engine.getState().currentTime).toBe(1000);
    });

    it('should not step if bars <= 0', () => {
      const initialTime = engine.getState().currentTime;
      engine.stepForward(0);
      expect(engine.getState().currentTime).toBe(initialTime);

      engine.stepBackward(-1);
      expect(engine.getState().currentTime).toBe(initialTime);
    });
  });

  describe('setSpeed', () => {
    beforeEach(() => {
      engine.load(sampleTicks);
    });

    it('should set speed to a valid value', () => {
      engine.setSpeed(10);
      expect(engine.getState().speed).toBe(10);
    });

    it('should snap to closest available speed if not exact match', () => {
      engine.load(sampleTicks, { availableSpeeds: [1, 5, 10] });
      engine.setSpeed(7); // Should snap to 5 (closer than 10)
      expect(engine.getState().speed).toBe(5);
    });

    it('should emit stateChange event', () => {
      const stateChangeFn = vi.fn();
      engine.on('stateChange', stateChangeFn);

      engine.setSpeed(10);

      expect(stateChangeFn).toHaveBeenCalled();
    });

    it('should restart playback loop if playing', () => {
      engine.play();
      engine.setSpeed(10);

      expect(engine.getState().status).toBe('playing');
    });
  });

  describe('getAvailableSpeeds', () => {
    it('should return default speeds', () => {
      engine.load(sampleTicks);
      expect(engine.getAvailableSpeeds()).toEqual([1, 2, 5, 10, 25, 50, 100]);
    });

    it('should return custom speeds', () => {
      engine.load(sampleTicks, { availableSpeeds: [1, 5, 10] });
      expect(engine.getAvailableSpeeds()).toEqual([1, 5, 10]);
    });
  });

  describe('getCurrentBar', () => {
    beforeEach(() => {
      engine.load(sampleTicks);
    });

    it('should return null before playback', () => {
      expect(engine.getCurrentBar()).toBeNull();
    });

    it('should return current bar during playback', () => {
      engine.play();
      vi.advanceTimersByTime(200);

      expect(engine.getCurrentBar()).not.toBeNull();
    });
  });

  describe('getBarsUntil', () => {
    beforeEach(() => {
      engine.load(sampleTicks);
    });

    it('should return empty array before playback', () => {
      expect(engine.getBarsUntil(1100)).toEqual([]);
    });

    it('should return bars after seeking', () => {
      engine.seekTo(1100);
      const bars = engine.getBarsUntil(1100);

      expect(bars.length).toBeGreaterThan(0);
    });
  });

  describe('events', () => {
    beforeEach(() => {
      engine.load(sampleTicks);
    });

    it('should emit tick events during playback', () => {
      const tickFn = vi.fn();
      engine.on('tick', tickFn);

      engine.play();
      vi.advanceTimersByTime(500);

      expect(tickFn).toHaveBeenCalled();
    });

    it('should emit bar events when bar completes', () => {
      const barFn = vi.fn();
      engine.on('bar', barFn);

      // Set speed to 100x so 100ms real time = 10s simulation time
      engine.setSpeed(100);
      engine.play();
      // At 100x, 2000ms = 200s simulation time, which should cross multiple bars
      vi.advanceTimersByTime(2000);

      expect(barFn).toHaveBeenCalled();
    });

    it('should emit stateChange events', () => {
      const stateChangeFn = vi.fn();
      engine.on('stateChange', stateChangeFn);

      engine.play();

      expect(stateChangeFn).toHaveBeenCalled();
    });

    it('should emit ended event when replay finishes', () => {
      const endedFn = vi.fn();
      engine.on('ended', endedFn);

      // Set speed to 100x so we quickly reach the end
      engine.setSpeed(100);
      engine.play();
      vi.advanceTimersByTime(10000); // Advance well past all data

      expect(endedFn).toHaveBeenCalled();
      expect(engine.getState().status).toBe('ended');
    });

    it('should support unsubscribing with returned function', () => {
      const tickFn = vi.fn();
      const unsubscribe = engine.on('tick', tickFn);

      unsubscribe();

      engine.play();
      vi.advanceTimersByTime(500);

      expect(tickFn).not.toHaveBeenCalled();
    });

    it('should support unsubscribing with off method', () => {
      const tickFn = vi.fn();
      engine.on('tick', tickFn);
      engine.off('tick', tickFn);

      engine.play();
      vi.advanceTimersByTime(500);

      expect(tickFn).not.toHaveBeenCalled();
    });
  });

  describe('options callbacks', () => {
    it('should call onTick callback', () => {
      const onTick = vi.fn();
      engine.load(sampleTicks, { onTick });

      engine.play();
      vi.advanceTimersByTime(500);

      expect(onTick).toHaveBeenCalled();
    });

    it('should call onBar callback', () => {
      const onBar = vi.fn();
      engine.load(sampleTicks, { onBar });

      // Set speed to 100x so we quickly cross bar boundaries
      engine.setSpeed(100);
      engine.play();
      vi.advanceTimersByTime(2000);

      expect(onBar).toHaveBeenCalled();
    });

    it('should call onStateChange callback', () => {
      const onStateChange = vi.fn();
      engine.load(sampleTicks, { onStateChange });

      // Should have been called on load
      expect(onStateChange).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should clean up all resources', () => {
      engine.load(sampleTicks);
      engine.play();

      const tickFn = vi.fn();
      engine.on('tick', tickFn);

      engine.dispose();
      vi.advanceTimersByTime(500);

      expect(tickFn).not.toHaveBeenCalled();
      expect(engine.getState().status).toBe('idle');
      expect(engine.getCurrentBar()).toBeNull();
    });
  });

  describe('playback timing', () => {
    beforeEach(() => {
      engine.load(sampleTicks, { updateInterval: 100 });
    });

    it('should process ticks at the correct rate', () => {
      const tickFn = vi.fn();
      engine.on('tick', tickFn);

      engine.play();

      // At 1x speed, 100ms of real time = 0.1s of simulation time
      // First tick is at t=1000, so after 100ms we should process the first tick
      vi.advanceTimersByTime(100);

      expect(tickFn.mock.calls.length).toBeGreaterThan(0);
    });

    it('should process ticks faster at higher speeds', () => {
      const tickFn = vi.fn();
      engine.on('tick', tickFn);

      engine.setSpeed(10);
      engine.play();

      // At 10x speed, 100ms of real time = 1s of simulation time
      vi.advanceTimersByTime(100);

      // Should have processed more ticks than at 1x
      expect(tickFn.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle single tick', () => {
      engine.load([{ timestamp: 1000, price: 100 }]);

      const state = engine.getState();
      expect(state.startTime).toBe(1000);
      expect(state.endTime).toBe(1000);

      engine.play();
      vi.advanceTimersByTime(200);

      expect(engine.getState().status).toBe('ended');
    });

    it('should handle ticks with same timestamp', () => {
      const sameTicks: TickData[] = [
        { timestamp: 1000, price: 100 },
        { timestamp: 1000, price: 101 },
        { timestamp: 1000, price: 102 },
      ];

      engine.load(sameTicks);

      engine.play();
      vi.advanceTimersByTime(200);

      expect(engine.getState().status).toBe('ended');
    });

    it('should handle fractional timestamps', () => {
      const fractionalTicks: TickData[] = [
        { timestamp: 1000.123, price: 100 },
        { timestamp: 1000.456, price: 101 },
        { timestamp: 1000.789, price: 102 },
      ];

      engine.load(fractionalTicks);
      const state = engine.getState();

      expect(state.startTime).toBe(1000.123);
      expect(state.endTime).toBe(1000.789);
    });
  });
});
