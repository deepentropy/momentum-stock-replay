import type {
  TickData,
  ReplayableBar,
  ReplayState,
  ReplayOptions,
  ReplayEvents,
  IReplayEngine,
} from './types';
import { EventEmitter } from './events';
import { TickAggregator } from './TickAggregator';

const DEFAULT_SPEEDS = [1, 2, 5, 10, 25, 50, 100];
const DEFAULT_UPDATE_INTERVAL = 100; // ms
const DEFAULT_BAR_INTERVAL = 60; // seconds

/**
 * Framework-agnostic replay engine for tick-by-tick market data
 */
export class ReplayEngine implements IReplayEngine {
  private emitter = new EventEmitter<ReplayEvents>();
  private aggregator: TickAggregator;

  // Data
  private ticks: TickData[] = [];
  private currentTickIndex = 0;

  // Configuration
  private options: Required<ReplayOptions>;

  // State
  private state: ReplayState = {
    status: 'idle',
    currentTime: 0,
    speed: 1,
    startTime: 0,
    endTime: 0,
  };

  // Playback
  private playbackTimer: ReturnType<typeof setInterval> | null = null;
  private lastPlaybackTime: number = 0;
  private lastBarTime: number | null = null;

  constructor() {
    this.options = {
      updateInterval: DEFAULT_UPDATE_INTERVAL,
      availableSpeeds: DEFAULT_SPEEDS,
      onTick: () => {},
      onBar: () => {},
      onStateChange: () => {},
      barInterval: DEFAULT_BAR_INTERVAL,
    };
    this.aggregator = new TickAggregator(DEFAULT_BAR_INTERVAL);
  }

  /**
   * Load tick data and initialize the replay engine
   */
  load(ticks: TickData[], options?: ReplayOptions): void {
    // Clean up any existing playback
    this.stopPlayback();

    // Merge options
    this.options = {
      updateInterval: options?.updateInterval ?? DEFAULT_UPDATE_INTERVAL,
      availableSpeeds: options?.availableSpeeds ?? DEFAULT_SPEEDS,
      onTick: options?.onTick ?? (() => {}),
      onBar: options?.onBar ?? (() => {}),
      onStateChange: options?.onStateChange ?? (() => {}),
      barInterval: options?.barInterval ?? DEFAULT_BAR_INTERVAL,
    };

    // Sort ticks by timestamp
    this.ticks = [...ticks].sort((a, b) => a.timestamp - b.timestamp);
    this.currentTickIndex = 0;

    // Reset aggregator with new interval
    this.aggregator = new TickAggregator(this.options.barInterval);
    this.lastBarTime = null;

    // Initialize state
    if (this.ticks.length > 0) {
      this.state = {
        status: 'idle',
        currentTime: this.ticks[0].timestamp,
        speed: this.options.availableSpeeds[0] ?? 1,
        startTime: this.ticks[0].timestamp,
        endTime: this.ticks[this.ticks.length - 1].timestamp,
      };
    } else {
      this.state = {
        status: 'idle',
        currentTime: 0,
        speed: this.options.availableSpeeds[0] ?? 1,
        startTime: 0,
        endTime: 0,
      };
    }

    this.emitStateChange();
  }

  /**
   * Clean up and dispose of all resources
   */
  dispose(): void {
    this.stopPlayback();
    this.emitter.removeAllListeners();
    this.ticks = [];
    this.aggregator.reset();
    this.state = {
      status: 'idle',
      currentTime: 0,
      speed: 1,
      startTime: 0,
      endTime: 0,
    };
  }

  /**
   * Start playback
   */
  play(): void {
    if (this.ticks.length === 0) {
      return;
    }

    if (this.state.status === 'ended') {
      // Reset to beginning if we've ended
      this.seekTo(this.state.startTime);
    }

    if (this.state.status === 'playing') {
      return;
    }

    this.updateState({ status: 'playing' });
    this.startPlayback();
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (this.state.status !== 'playing') {
      return;
    }

    this.stopPlayback();
    this.updateState({ status: 'paused' });
  }

  /**
   * Stop playback and reset to the start
   */
  stop(): void {
    this.stopPlayback();

    if (this.ticks.length > 0) {
      this.currentTickIndex = 0;
      this.aggregator.reset();
      this.lastBarTime = null;
      this.updateState({
        status: 'idle',
        currentTime: this.state.startTime,
      });
    } else {
      this.updateState({ status: 'idle' });
    }
  }

  /**
   * Seek to a specific timestamp
   */
  seekTo(timestamp: number): void {
    if (this.ticks.length === 0) {
      return;
    }

    // Clamp timestamp to valid range
    const clampedTime = Math.max(
      this.state.startTime,
      Math.min(this.state.endTime, timestamp)
    );

    // Binary search to find the tick index
    this.currentTickIndex = this.findTickIndexForTime(clampedTime);

    // Rebuild bars up to this point
    this.rebuildBarsToIndex(this.currentTickIndex);

    // Update state
    const wasPlaying = this.state.status === 'playing';
    this.updateState({
      currentTime: clampedTime,
      status: wasPlaying ? 'playing' : this.state.status === 'ended' ? 'paused' : this.state.status,
    });

    // Restart playback if it was playing
    if (wasPlaying) {
      this.stopPlayback();
      this.startPlayback();
    }
  }

  /**
   * Seek to a percentage of the total duration (0-100)
   */
  seekToPercent(percent: number): void {
    const clampedPercent = Math.max(0, Math.min(100, percent));
    const duration = this.state.endTime - this.state.startTime;
    const timestamp = this.state.startTime + (duration * clampedPercent) / 100;
    this.seekTo(timestamp);
  }

  /**
   * Step forward by a number of bars
   */
  stepForward(bars: number = 1): void {
    if (this.ticks.length === 0 || bars <= 0) {
      return;
    }

    const barInterval = this.aggregator.getInterval();
    const newTime = this.state.currentTime + bars * barInterval;
    this.seekTo(newTime);
  }

  /**
   * Step backward by a number of bars
   */
  stepBackward(bars: number = 1): void {
    if (this.ticks.length === 0 || bars <= 0) {
      return;
    }

    const barInterval = this.aggregator.getInterval();
    const newTime = this.state.currentTime - bars * barInterval;
    this.seekTo(newTime);
  }

  /**
   * Set playback speed
   */
  setSpeed(speed: number): void {
    if (!this.options.availableSpeeds.includes(speed)) {
      // Find the closest available speed
      const closest = this.options.availableSpeeds.reduce((prev, curr) =>
        Math.abs(curr - speed) < Math.abs(prev - speed) ? curr : prev
      );
      speed = closest;
    }

    const wasPlaying = this.state.status === 'playing';
    this.updateState({ speed });

    // Restart playback loop with new speed if playing
    if (wasPlaying) {
      this.stopPlayback();
      this.startPlayback();
    }
  }

  /**
   * Get available playback speeds
   */
  getAvailableSpeeds(): number[] {
    return [...this.options.availableSpeeds];
  }

  /**
   * Get current replay state
   */
  getState(): ReplayState {
    return { ...this.state };
  }

  /**
   * Get the current bar at the current time
   */
  getCurrentBar(): ReplayableBar | null {
    return this.aggregator.getCurrentBar();
  }

  /**
   * Get all bars up to a specific timestamp
   */
  getBarsUntil(timestamp: number): ReplayableBar[] {
    return this.aggregator.getBarsUntil(timestamp);
  }

  /**
   * Subscribe to an event
   */
  on<K extends keyof ReplayEvents>(event: K, handler: ReplayEvents[K]): () => void {
    return this.emitter.on(event, handler);
  }

  /**
   * Unsubscribe from an event
   */
  off<K extends keyof ReplayEvents>(event: K, handler: ReplayEvents[K]): void {
    this.emitter.off(event, handler);
  }

  // Private methods

  private startPlayback(): void {
    this.lastPlaybackTime = Date.now();
    const interval = this.options.updateInterval;

    this.playbackTimer = setInterval(() => {
      this.processPlaybackTick();
    }, interval);
  }

  private stopPlayback(): void {
    if (this.playbackTimer !== null) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

  private processPlaybackTick(): void {
    const now = Date.now();
    const realTimeElapsed = (now - this.lastPlaybackTime) / 1000; // Convert to seconds
    this.lastPlaybackTime = now;

    // Calculate how much simulation time should pass
    const simulatedTimeElapsed = realTimeElapsed * this.state.speed;
    const targetTime = this.state.currentTime + simulatedTimeElapsed;

    // Process all ticks between current time and target time
    let ticksProcessed = false;
    while (
      this.currentTickIndex < this.ticks.length &&
      this.ticks[this.currentTickIndex].timestamp <= targetTime
    ) {
      const tick = this.ticks[this.currentTickIndex];
      this.processTick(tick);
      this.currentTickIndex++;
      ticksProcessed = true;
    }

    // Update current time
    const newTime = Math.min(targetTime, this.state.endTime);

    // Check if we've reached the end
    if (this.currentTickIndex >= this.ticks.length) {
      this.stopPlayback();
      this.updateState({
        currentTime: this.state.endTime,
        status: 'ended',
      });
      this.emitter.emit('ended');
      return;
    }

    // Update state if ticks were processed or time changed significantly
    if (ticksProcessed || Math.abs(newTime - this.state.currentTime) > 0.001) {
      this.updateState({ currentTime: newTime });
    }
  }

  private processTick(tick: TickData): void {
    const previousBarTime = this.lastBarTime;
    const bar = this.aggregator.addTick(tick);
    const currentBarTime = bar.time;

    // Emit tick event
    this.emitter.emit('tick', tick, this.getState());
    this.options.onTick(tick, this.getState());

    // Check if we've started a new bar (previous bar completed)
    if (previousBarTime !== null && currentBarTime !== previousBarTime) {
      const completedBar = this.aggregator.getBar(previousBarTime);
      if (completedBar) {
        this.emitter.emit('bar', completedBar, this.getState());
        this.options.onBar(completedBar, this.getState());
      }
    }

    this.lastBarTime = currentBarTime;
  }

  private findTickIndexForTime(timestamp: number): number {
    if (this.ticks.length === 0) {
      return 0;
    }

    // Binary search for the first tick at or after the timestamp
    let left = 0;
    let right = this.ticks.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (this.ticks[mid].timestamp < timestamp) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    return left;
  }

  private rebuildBarsToIndex(index: number): void {
    this.aggregator.reset();
    this.lastBarTime = null;

    for (let i = 0; i < index && i < this.ticks.length; i++) {
      const tick = this.ticks[i];
      const bar = this.aggregator.addTick(tick);
      this.lastBarTime = bar.time;
    }
  }

  private updateState(partial: Partial<ReplayState>): void {
    const previousStatus = this.state.status;
    this.state = { ...this.state, ...partial };

    // Only emit state change if something actually changed
    if (
      partial.status !== undefined ||
      partial.currentTime !== undefined ||
      partial.speed !== undefined
    ) {
      this.emitStateChange();
    }
  }

  private emitStateChange(): void {
    const state = this.getState();
    this.emitter.emit('stateChange', state);
    this.options.onStateChange(state);
  }
}
