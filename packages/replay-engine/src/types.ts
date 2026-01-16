/**
 * Represents a bar (candlestick) with OHLCV data
 */
export interface ReplayableBar {
  /** Bar start time in Unix seconds */
  time: number;
  /** Opening price */
  open: number;
  /** Highest price during the bar */
  high: number;
  /** Lowest price during the bar */
  low: number;
  /** Closing price */
  close: number;
  /** Trading volume (optional) */
  volume?: number;
}

/**
 * Represents a single tick (trade or quote) data point
 */
export interface TickData {
  /** Timestamp in Unix seconds (supports ms precision as decimals) */
  timestamp: number;
  /** Price of the tick */
  price: number;
  /** Volume of the tick (optional) */
  volume?: number;
  /** Side of the market: bid, ask, or trade (optional) */
  side?: 'bid' | 'ask' | 'trade';
  /** Additional metadata (optional) */
  metadata?: Record<string, unknown>;
}

/**
 * Represents the current state of the replay engine
 */
export interface ReplayState {
  /** Current playback status */
  status: 'idle' | 'playing' | 'paused' | 'ended';
  /** Current replay time in Unix seconds */
  currentTime: number;
  /** Current playback speed multiplier */
  speed: number;
  /** Start time of the loaded data in Unix seconds */
  startTime: number;
  /** End time of the loaded data in Unix seconds */
  endTime: number;
}

/**
 * Options for configuring the replay engine
 */
export interface ReplayOptions {
  /** Milliseconds between updates (default: 100) */
  updateInterval?: number;
  /** Available playback speeds (default: [1, 2, 5, 10, 25, 50, 100]) */
  availableSpeeds?: number[];
  /** Callback invoked on each tick */
  onTick?: (tick: TickData, state: ReplayState) => void;
  /** Callback invoked when a bar is completed */
  onBar?: (bar: ReplayableBar, state: ReplayState) => void;
  /** Callback invoked on state changes */
  onStateChange?: (state: ReplayState) => void;
  /** Bar interval in seconds for aggregation (default: 60) */
  barInterval?: number;
}

/**
 * Event handlers for replay engine events
 */
export interface ReplayEvents {
  /** Emitted when a tick is processed */
  'tick': (tick: TickData, state: ReplayState) => void;
  /** Emitted when a bar is completed */
  'bar': (bar: ReplayableBar, state: ReplayState) => void;
  /** Emitted when the replay state changes */
  'stateChange': (state: ReplayState) => void;
  /** Emitted when replay reaches the end */
  'ended': () => void;
  /** Emitted on errors */
  'error': (error: Error) => void;
}

/**
 * Interface for the replay engine
 */
export interface IReplayEngine {
  // Lifecycle
  /** Load ticks and initialize the replay engine */
  load(ticks: TickData[], options?: ReplayOptions): void;
  /** Clean up and dispose of resources */
  dispose(): void;

  // Playback controls
  /** Start playback */
  play(): void;
  /** Pause playback */
  pause(): void;
  /** Stop playback and reset to start */
  stop(): void;

  // Navigation
  /** Seek to a specific timestamp */
  seekTo(timestamp: number): void;
  /** Seek to a percentage of the total duration (0-100) */
  seekToPercent(percent: number): void;
  /** Step forward by a number of bars */
  stepForward(bars?: number): void;
  /** Step backward by a number of bars */
  stepBackward(bars?: number): void;

  // Speed
  /** Set playback speed */
  setSpeed(speed: number): void;
  /** Get available playback speeds */
  getAvailableSpeeds(): number[];

  // State
  /** Get current replay state */
  getState(): ReplayState;
  /** Get the current bar at the current time */
  getCurrentBar(): ReplayableBar | null;
  /** Get all bars up to a specific timestamp */
  getBarsUntil(timestamp: number, interval?: number): ReplayableBar[];

  // Events
  /** Subscribe to an event */
  on<K extends keyof ReplayEvents>(event: K, handler: ReplayEvents[K]): () => void;
  /** Unsubscribe from an event */
  off<K extends keyof ReplayEvents>(event: K, handler: ReplayEvents[K]): void;
}
