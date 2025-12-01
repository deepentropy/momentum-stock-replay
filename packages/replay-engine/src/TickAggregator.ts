import type { TickData, ReplayableBar } from './types';

/**
 * Aggregates tick data into OHLCV bars at a specified interval
 */
export class TickAggregator {
  private intervalSeconds: number;
  private bars: Map<number, ReplayableBar> = new Map();
  private currentBarTime: number | null = null;

  /**
   * Create a new TickAggregator
   * @param intervalSeconds - Bar interval in seconds (e.g., 60 for 1-minute bars)
   */
  constructor(intervalSeconds: number = 60) {
    if (intervalSeconds <= 0) {
      throw new Error('Interval must be positive');
    }
    this.intervalSeconds = intervalSeconds;
  }

  /**
   * Get the bar start time for a given timestamp
   * @param timestamp - Unix timestamp in seconds
   * @returns Bar start time aligned to interval
   */
  private getBarTime(timestamp: number): number {
    return Math.floor(timestamp / this.intervalSeconds) * this.intervalSeconds;
  }

  /**
   * Add a tick and update/create bars accordingly
   * @param tick - Tick data to add
   * @returns The bar that was updated or created
   */
  addTick(tick: TickData): ReplayableBar {
    const barTime = this.getBarTime(tick.timestamp);
    this.currentBarTime = barTime;

    let bar = this.bars.get(barTime);
    if (!bar) {
      // Create new bar
      bar = {
        time: barTime,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume ?? 0,
      };
      this.bars.set(barTime, bar);
    } else {
      // Update existing bar
      bar.high = Math.max(bar.high, tick.price);
      bar.low = Math.min(bar.low, tick.price);
      bar.close = tick.price;
      bar.volume = (bar.volume ?? 0) + (tick.volume ?? 0);
    }

    return bar;
  }

  /**
   * Get the current (potentially incomplete) bar
   * @returns Current bar or null if no ticks have been added
   */
  getCurrentBar(): ReplayableBar | null {
    if (this.currentBarTime === null) {
      return null;
    }
    return this.bars.get(this.currentBarTime) ?? null;
  }

  /**
   * Get all bars sorted in ascending order by time
   * @returns Array of all bars (completed + current)
   */
  getAllBars(): ReplayableBar[] {
    return Array.from(this.bars.values()).sort((a, b) => a.time - b.time);
  }

  /**
   * Get bars up to a specific timestamp
   * @param timestamp - Unix timestamp in seconds
   * @returns Array of bars up to and including the specified time
   */
  getBarsUntil(timestamp: number): ReplayableBar[] {
    const barTime = this.getBarTime(timestamp);
    return this.getAllBars().filter((bar) => bar.time <= barTime);
  }

  /**
   * Get a specific bar by its start time
   * @param time - Bar start time in Unix seconds
   * @returns Bar at that time or null if not found
   */
  getBar(time: number): ReplayableBar | null {
    return this.bars.get(time) ?? null;
  }

  /**
   * Get the number of bars
   * @returns Number of bars
   */
  getBarCount(): number {
    return this.bars.size;
  }

  /**
   * Reset all state and clear all bars
   */
  reset(): void {
    this.bars.clear();
    this.currentBarTime = null;
  }

  /**
   * Change the interval and reset all bars
   * @param intervalSeconds - New interval in seconds
   */
  setInterval(intervalSeconds: number): void {
    if (intervalSeconds <= 0) {
      throw new Error('Interval must be positive');
    }
    this.intervalSeconds = intervalSeconds;
    this.reset();
  }

  /**
   * Get the current interval in seconds
   * @returns Interval in seconds
   */
  getInterval(): number {
    return this.intervalSeconds;
  }
}
