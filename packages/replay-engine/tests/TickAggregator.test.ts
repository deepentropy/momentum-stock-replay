import { describe, it, expect, beforeEach } from 'vitest';
import { TickAggregator } from '../src/TickAggregator';
import type { TickData } from '../src/types';

describe('TickAggregator', () => {
  let aggregator: TickAggregator;

  beforeEach(() => {
    aggregator = new TickAggregator(60); // 1-minute bars
  });

  describe('constructor', () => {
    it('should create an aggregator with default interval', () => {
      const agg = new TickAggregator();
      expect(agg.getInterval()).toBe(60);
    });

    it('should create an aggregator with custom interval', () => {
      const agg = new TickAggregator(300);
      expect(agg.getInterval()).toBe(300);
    });

    it('should throw error for non-positive interval', () => {
      expect(() => new TickAggregator(0)).toThrow('Interval must be positive');
      expect(() => new TickAggregator(-1)).toThrow('Interval must be positive');
    });
  });

  describe('addTick', () => {
    it('should create a new bar for the first tick', () => {
      const tick: TickData = { timestamp: 1000, price: 100 };
      const bar = aggregator.addTick(tick);

      expect(bar).toEqual({
        time: 960, // Aligned to 60-second boundary
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 0,
      });
    });

    it('should create a new bar with volume if provided', () => {
      const tick: TickData = { timestamp: 1000, price: 100, volume: 500 };
      const bar = aggregator.addTick(tick);

      expect(bar.volume).toBe(500);
    });

    it('should update OHLCV correctly for multiple ticks in same bar', () => {
      // All ticks within the same 60-second bar (960-1019)
      aggregator.addTick({ timestamp: 960, price: 100, volume: 100 });
      aggregator.addTick({ timestamp: 970, price: 105, volume: 200 }); // New high
      aggregator.addTick({ timestamp: 980, price: 95, volume: 150 });  // New low
      const bar = aggregator.addTick({ timestamp: 990, price: 102, volume: 50 }); // Close

      expect(bar).toEqual({
        time: 960,
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: 500, // Sum of all volumes
      });
    });

    it('should create a new bar when crossing bar boundary', () => {
      aggregator.addTick({ timestamp: 1000, price: 100 });
      const bar2 = aggregator.addTick({ timestamp: 1080, price: 110 }); // Next minute

      expect(bar2.time).toBe(1080);
      expect(bar2.open).toBe(110);
      expect(aggregator.getBarCount()).toBe(2);
    });
  });

  describe('getCurrentBar', () => {
    it('should return null when no ticks have been added', () => {
      expect(aggregator.getCurrentBar()).toBeNull();
    });

    it('should return the current bar after adding ticks', () => {
      aggregator.addTick({ timestamp: 1000, price: 100 });
      const bar = aggregator.getCurrentBar();

      expect(bar).not.toBeNull();
      expect(bar?.time).toBe(960);
      expect(bar?.close).toBe(100);
    });
  });

  describe('getAllBars', () => {
    it('should return empty array when no ticks have been added', () => {
      expect(aggregator.getAllBars()).toEqual([]);
    });

    it('should return bars sorted in ascending order', () => {
      aggregator.addTick({ timestamp: 1200, price: 110 }); // 3rd bar
      aggregator.addTick({ timestamp: 1000, price: 100 }); // 1st bar
      aggregator.addTick({ timestamp: 1100, price: 105 }); // 2nd bar

      const bars = aggregator.getAllBars();
      expect(bars).toHaveLength(3);
      expect(bars[0].time).toBe(960);
      expect(bars[1].time).toBe(1080);
      expect(bars[2].time).toBe(1200);
    });
  });

  describe('getBarsUntil', () => {
    beforeEach(() => {
      aggregator.addTick({ timestamp: 1000, price: 100 });
      aggregator.addTick({ timestamp: 1080, price: 110 });
      aggregator.addTick({ timestamp: 1140, price: 120 });
      aggregator.addTick({ timestamp: 1200, price: 130 });
    });

    it('should return all bars up to the specified time', () => {
      const bars = aggregator.getBarsUntil(1100);
      expect(bars).toHaveLength(2);
      expect(bars[0].time).toBe(960);
      expect(bars[1].time).toBe(1080);
    });

    it('should return all bars if timestamp is at the end', () => {
      const bars = aggregator.getBarsUntil(1300);
      expect(bars).toHaveLength(4);
    });

    it('should return empty array if timestamp is before first bar', () => {
      const bars = aggregator.getBarsUntil(900);
      expect(bars).toHaveLength(0);
    });
  });

  describe('getBar', () => {
    it('should return null for non-existent bar', () => {
      expect(aggregator.getBar(1000)).toBeNull();
    });

    it('should return the bar at the specified time', () => {
      aggregator.addTick({ timestamp: 1000, price: 100 });
      const bar = aggregator.getBar(960);

      expect(bar).not.toBeNull();
      expect(bar?.time).toBe(960);
      expect(bar?.close).toBe(100);
    });
  });

  describe('reset', () => {
    it('should clear all bars and state', () => {
      aggregator.addTick({ timestamp: 1000, price: 100 });
      aggregator.addTick({ timestamp: 1080, price: 110 });

      aggregator.reset();

      expect(aggregator.getAllBars()).toEqual([]);
      expect(aggregator.getCurrentBar()).toBeNull();
      expect(aggregator.getBarCount()).toBe(0);
    });
  });

  describe('setInterval', () => {
    it('should change the interval and reset bars', () => {
      aggregator.addTick({ timestamp: 1000, price: 100 });
      expect(aggregator.getBarCount()).toBe(1);

      aggregator.setInterval(300); // 5-minute bars

      expect(aggregator.getInterval()).toBe(300);
      expect(aggregator.getBarCount()).toBe(0);
    });

    it('should throw error for non-positive interval', () => {
      expect(() => aggregator.setInterval(0)).toThrow('Interval must be positive');
      expect(() => aggregator.setInterval(-5)).toThrow('Interval must be positive');
    });
  });

  describe('bar boundary handling', () => {
    it('should correctly align bars to interval boundaries', () => {
      const agg = new TickAggregator(60);

      // Tick at 1:30 (90 seconds from epoch) should go in bar starting at 1:00 (60 seconds)
      agg.addTick({ timestamp: 90, price: 100 });
      expect(agg.getCurrentBar()?.time).toBe(60);

      // Tick at 2:00 (120 seconds) should go in bar starting at 2:00
      agg.addTick({ timestamp: 120, price: 110 });
      expect(agg.getCurrentBar()?.time).toBe(120);
    });

    it('should handle fractional timestamps', () => {
      aggregator.addTick({ timestamp: 1000.5, price: 100 });
      expect(aggregator.getCurrentBar()?.time).toBe(960);
    });
  });

  describe('volume accumulation', () => {
    it('should handle missing volume gracefully', () => {
      aggregator.addTick({ timestamp: 960, price: 100, volume: 100 });
      aggregator.addTick({ timestamp: 970, price: 105, volume: 200 });
      aggregator.addTick({ timestamp: 980, price: 95 }); // No volume

      const bar = aggregator.getCurrentBar();
      expect(bar?.volume).toBe(300); // 100 + 200 + 0
    });
  });
});
