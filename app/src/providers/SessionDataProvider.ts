import type { 
  OakViewDataProvider, 
  OHLCVBar, 
  SymbolInfo, 
  DataProviderConfig, 
  SubscriptionCallback, 
  UnsubscribeFunction 
} from '@deepentropy/oakview';
import { ReplayEngine, TickData, ReplayableBar, ReplayState } from '@momentum/replay-engine';
import { api } from '../utils/api';

/**
 * Session data structure from the API
 */
interface Session {
  id: string;
  name: string;
  symbol: string;
  date: string;
  size: number;
  download_url: string;
  px_start: number | null;
  px_end: number | null;
  duration_m: number | null;
  tickCount: number | null;
}

/**
 * Raw tick data from the API
 */
interface RawTickData {
  timestamp: string;
  time: string;
  adjustedTimestamp: number;
  bid_price: string;
  ask_price: string;
  bid_size: string;
  ask_size: string;
  priceBid?: string;
  priceAsk?: string;
  sizeBid?: string;
  sizeAsk?: string;
  nbbo?: boolean;
  exchanges?: Array<{
    publisher_id: number;
    bid_price: string;
    ask_price: string;
    bid_size: string;
    ask_size: string;
  }>;
}

/**
 * Supported timeframes in seconds
 */
const SUPPORTED_INTERVALS = [1, 5, 10, 15, 30, 60, 300];
const INTERVAL_LABELS: Record<number, string> = {
  1: '1S',
  5: '5S',
  10: '10S',
  15: '15S',
  30: '30S',
  60: '1m',
  300: '5m',
};

/**
 * Parse interval string to seconds
 */
function parseInterval(interval: string): number {
  // Handle numeric intervals (in minutes or seconds)
  const num = parseInt(interval, 10);
  if (!isNaN(num)) {
    // If it's a small number, assume seconds for our use case
    if (num <= 300 && SUPPORTED_INTERVALS.includes(num)) {
      return num;
    }
    // Otherwise assume minutes
    return num * 60;
  }

  // Handle standard interval formats
  const match = interval.match(/^(\d+)([smhDWM]?)$/i);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2]?.toLowerCase() || 's';
    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      case 'd':
      case 'w':
      case 'M':
        return value * 86400; // Default to daily for higher timeframes
      default:
        return value;
    }
  }
  
  return 60; // Default to 1 minute
}

/**
 * SessionDataProvider - OakView data provider for Momentum Stock Replay
 * 
 * This provider bridges OakView's data provider interface with the replay-engine,
 * enabling tick-by-tick playback of historical trading sessions.
 * 
 * @implements {OakViewDataProvider}
 * 
 * @example
 * ```typescript
 * const provider = new SessionDataProvider();
 * await provider.initialize({});
 * await provider.loadSession('AAPL-20231115');
 * provider.play();
 * ```
 * 
 * @example
 * ```typescript
 * // Subscribe to state changes
 * const engine = provider.getReplayEngine();
 * engine.on('stateChange', (state) => {
 *   console.log('Status:', state.status, 'Progress:', state.currentTime);
 * });
 * 
 * // Control playback
 * provider.play();
 * provider.setSpeed(10); // 10x speed
 * provider.seekToPercent(50); // Jump to 50%
 * provider.pause();
 * ```
 */
export class SessionDataProvider implements OakViewDataProvider {
  private replayEngine: ReplayEngine;
  private sessions: Map<string, Session> = new Map();
  private tickCache: Map<string, TickData[]> = new Map();
  private rawTickCache: Map<string, RawTickData[]> = new Map();
  private currentInterval: number = 10;
  private currentSymbol: string | null = null;
  private isInitialized: boolean = false;
  private subscriptionCallback: SubscriptionCallback | null = null;
  private currentUnsubscribe: (() => void) | null = null;
  private oakViewBarCallback: ((bar: OHLCVBar) => void) | null = null;

  constructor() {
    this.replayEngine = new ReplayEngine();
  }

  /**
   * Register a callback for OakView bar updates
   * This should be called by ChartArea when OakView is ready
   */
  setBarCallback(callback: (bar: OHLCVBar) => void): void {
    this.oakViewBarCallback = callback;
    console.log('✅ OakView bar callback registered');
  }

  /**
   * Clear the OakView bar callback
   */
  clearBarCallback(): void {
    this.oakViewBarCallback = null;
  }

  /**
   * Initialize the data provider - load sessions index
   */
  async initialize(_config: DataProviderConfig): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const sessionsArray = await api.getSessions();
      this.sessions.clear();
      for (const session of sessionsArray) {
        this.sessions.set(session.id, session);
      }
      this.isInitialized = true;
      console.log(`✅ SessionDataProvider initialized with ${this.sessions.size} sessions`);
    } catch (error) {
      console.error('❌ Failed to initialize SessionDataProvider:', error);
      throw error;
    }
  }

  /**
   * Fetch historical bars for a symbol at a given interval
   */
  async fetchHistorical(
    symbol: string,
    interval: string,
    _from?: number,
    _to?: number
  ): Promise<OHLCVBar[]> {
    const intervalSeconds = parseInterval(interval);
    this.currentInterval = intervalSeconds;
    this.currentSymbol = symbol;

    // Find session by symbol (session ID)
    const session = this.sessions.get(symbol);
    if (!session) {
      console.warn(`Session not found: ${symbol}`);
      return [];
    }

    try {
      // Load raw ticks if not cached
      if (!this.rawTickCache.has(symbol)) {
        console.log(`📥 Loading tick data for session: ${symbol}`);
        const rawData = await api.loadSessionData(symbol);
        this.rawTickCache.set(symbol, rawData);
        
        // Convert to TickData format
        const ticks = this.convertToTickData(rawData);
        this.tickCache.set(symbol, ticks);
        
        console.log(`✅ Loaded ${rawData.length} raw ticks, converted to ${ticks.length} ticks`);
      }

      const ticks = this.tickCache.get(symbol) || [];
      
      // Generate bars from ticks at the requested interval
      const bars = this.aggregateTicksToBars(ticks, intervalSeconds);
      console.log(`📊 Generated ${bars.length} bars at ${intervalSeconds}s interval`);
      
      return bars;
    } catch (error) {
      console.error(`❌ Failed to fetch historical data for ${symbol}:`, error);
      return [];
    }
  }

  /**
   * Subscribe to real-time updates (replay)
   */
  subscribe(
    symbol: string,
    interval: string,
    callback: SubscriptionCallback
  ): UnsubscribeFunction {
    const intervalSeconds = parseInterval(interval);
    this.currentInterval = intervalSeconds;
    this.currentSymbol = symbol;
    this.subscriptionCallback = callback;

    // Clean up any existing subscription
    this.unsubscribeInternal();

    // Get cached ticks
    const ticks = this.tickCache.get(symbol);
    if (!ticks || ticks.length === 0) {
      console.warn('No ticks available for subscription');
      return () => {};
    }

    // Load ticks into replay engine
    this.replayEngine.load(ticks, {
      barInterval: intervalSeconds,
      onBar: (bar: ReplayableBar, _state: ReplayState) => {
        // Convert ReplayableBar to OHLCVBar and emit
        if (this.subscriptionCallback) {
          const ohlcvBar: OHLCVBar = {
            time: bar.time,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
          };
          this.subscriptionCallback(ohlcvBar);
        }
      },
    });

    // Return cleanup function
    const unsubscribe = () => {
      this.unsubscribeInternal();
    };
    
    this.currentUnsubscribe = unsubscribe;
    return unsubscribe;
  }

  private unsubscribeInternal(): void {
    if (this.currentUnsubscribe) {
      this.replayEngine.stop();
      this.subscriptionCallback = null;
      this.currentUnsubscribe = null;
    }
  }

  /**
   * Search for available sessions
   */
  async searchSymbols(query: string): Promise<SymbolInfo[]> {
    if (!this.isInitialized) {
      await this.initialize({});
    }

    const normalizedQuery = query.toLowerCase().trim();
    const results: SymbolInfo[] = [];

    for (const session of this.sessions.values()) {
      const matchesSymbol = session.symbol.toLowerCase().includes(normalizedQuery);
      const matchesName = session.name.toLowerCase().includes(normalizedQuery);
      const matchesDate = session.date.includes(normalizedQuery);

      if (!normalizedQuery || matchesSymbol || matchesName || matchesDate) {
        results.push({
          symbol: session.id,
          name: `${session.symbol} - ${session.date}`,
          exchange: 'REPLAY',
          type: 'stock',
        });
      }
    }

    return results.slice(0, 50); // Limit to 50 results
  }

  /**
   * Get available intervals for a symbol
   */
  getAvailableIntervals(_symbol: string): string[] | null {
    return SUPPORTED_INTERVALS.map(s => INTERVAL_LABELS[s] || `${s}S`);
  }

  /**
   * Get base (native) interval for a symbol
   */
  getBaseInterval(_symbol: string): string | null {
    return '1S'; // Tick data is essentially 1-second resolution
  }

  /**
   * Check if data exists for symbol/interval combination
   */
  hasData(symbol: string, _interval: string): boolean {
    return this.sessions.has(symbol);
  }

  /**
   * Cleanup and disconnect
   */
  disconnect(): void {
    this.unsubscribeInternal();
    this.oakViewBarCallback = null;
    this.replayEngine.dispose();
    this.tickCache.clear();
    this.rawTickCache.clear();
    console.log('🔌 SessionDataProvider disconnected');
  }

  // ============ Replay Control Methods ============

  /**
   * Start playback
   */
  play(): void {
    this.replayEngine.play();
  }

  /**
   * Pause playback
   */
  pause(): void {
    this.replayEngine.pause();
  }

  /**
   * Stop playback and reset to start
   */
  stop(): void {
    this.replayEngine.stop();
  }

  /**
   * Seek to a specific timestamp
   */
  seekTo(timestamp: number): void {
    this.replayEngine.seekTo(timestamp);
  }

  /**
   * Seek to a percentage of the total duration (0-100)
   */
  seekToPercent(percent: number): void {
    this.replayEngine.seekToPercent(percent);
  }

  /**
   * Set playback speed
   */
  setSpeed(speed: number): void {
    this.replayEngine.setSpeed(speed);
  }

  /**
   * Get current replay state
   */
  getReplayState(): ReplayState {
    return this.replayEngine.getState();
  }

  /**
   * Get the underlying replay engine for direct access
   */
  getReplayEngine(): ReplayEngine {
    return this.replayEngine;
  }

  /**
   * Get available playback speeds
   */
  getAvailableSpeeds(): number[] {
    return this.replayEngine.getAvailableSpeeds();
  }

  /**
   * Load ticks for a session and prepare for replay
   */
  async loadSession(sessionId: string, intervalSeconds: number = 10): Promise<void> {
    this.currentSymbol = sessionId;
    this.currentInterval = intervalSeconds;

    // Ensure ticks are loaded
    if (!this.tickCache.has(sessionId)) {
      await this.fetchHistorical(sessionId, `${intervalSeconds}S`);
    }

    const ticks = this.tickCache.get(sessionId);
    if (!ticks || ticks.length === 0) {
      throw new Error(`No ticks found for session: ${sessionId}`);
    }

    // Load into replay engine with bar callback for OakView updates
    this.replayEngine.load(ticks, {
      barInterval: intervalSeconds,
      onBar: (bar: ReplayableBar, _state: ReplayState) => {
        const ohlcvBar: OHLCVBar = {
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        };
        
        // Notify OakView via registered callback
        if (this.oakViewBarCallback) {
          this.oakViewBarCallback(ohlcvBar);
        }
        
        // Also notify via subscription callback if available
        if (this.subscriptionCallback) {
          this.subscriptionCallback(ohlcvBar);
        }
      },
    });
  }

  /**
   * Get session metadata
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions
   */
  getSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get raw tick data for a session
   */
  getRawTicks(sessionId: string): RawTickData[] | undefined {
    return this.rawTickCache.get(sessionId);
  }

  // ============ Helper Methods ============

  /**
   * Convert raw API tick data to TickData format for ReplayEngine
   */
  private convertToTickData(rawTicks: RawTickData[]): TickData[] {
    return rawTicks
      .filter(tick => {
        // Filter out ticks with invalid prices
        const bidPrice = parseFloat(tick.bid_price || tick.priceBid || '0');
        const askPrice = parseFloat(tick.ask_price || tick.priceAsk || '0');
        return bidPrice > 0 || askPrice > 0;
      })
      .map(tick => {
        const bidPrice = parseFloat(tick.bid_price || tick.priceBid || '0');
        const askPrice = parseFloat(tick.ask_price || tick.priceAsk || '0');
        // Use the non-zero price if one is zero, otherwise average
        const midPrice = bidPrice === 0 ? askPrice : 
                         askPrice === 0 ? bidPrice : 
                         (bidPrice + askPrice) / 2;

        return {
          timestamp: tick.adjustedTimestamp,
          price: midPrice,
          volume: 0, // NBBO data doesn't have trade volume
          side: 'trade' as const,
          metadata: {
            bid: bidPrice,
            ask: askPrice,
            bidSize: parseFloat(tick.bid_size || tick.sizeBid || '0'),
            askSize: parseFloat(tick.ask_size || tick.sizeAsk || '0'),
            nbbo: tick.nbbo,
            exchanges: tick.exchanges,
          },
      };
    });
  }

  /**
   * Aggregate ticks into OHLCV bars at the specified interval
   */
  private aggregateTicksToBars(ticks: TickData[], intervalSeconds: number): OHLCVBar[] {
    if (ticks.length === 0) return [];

    const bars: OHLCVBar[] = [];
    let currentBar: OHLCVBar | null = null;
    let currentBarTime: number | null = null;

    for (const tick of ticks) {
      const barTime = Math.floor(tick.timestamp / intervalSeconds) * intervalSeconds;

      if (currentBarTime !== barTime) {
        if (currentBar) {
          bars.push(currentBar);
        }
        currentBarTime = barTime;
        currentBar = {
          time: barTime,
          open: tick.price,
          high: tick.price,
          low: tick.price,
          close: tick.price,
          volume: tick.volume ?? 0,
        };
      } else if (currentBar) {
        currentBar.high = Math.max(currentBar.high, tick.price);
        currentBar.low = Math.min(currentBar.low, tick.price);
        currentBar.close = tick.price;
        currentBar.volume = (currentBar.volume ?? 0) + (tick.volume ?? 0);
      }
    }

    if (currentBar) {
      bars.push(currentBar);
    }

    return bars;
  }
}

export default SessionDataProvider;
