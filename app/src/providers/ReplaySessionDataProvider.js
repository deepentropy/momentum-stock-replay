/**
 * ReplaySessionDataProvider
 * 
 * Custom OakView data provider for momentum stock replay sessions.
 * Handles binary session file loading, decompression, parsing, and
 * fixed-rate tick streaming for playback.
 */

import { OakViewDataProvider } from 'oakview';
import { api } from '../utils/api.js';

class ReplaySessionDataProvider extends OakViewDataProvider {
  constructor() {
    super();
    this.sessionData = null;
    this.sessionId = null;
    this.currentIndex = 0;
    this.tickInterval = null;
    this.subscribers = new Map();
    this.isPlaying = false;
    this.isPaused = false;
    this.speed = 1;
    this.virtualTime = 0;
    this.currentBar = null;
    this.currentBarTime = null;
  }

  /**
   * Initialize the provider with a session ID
   * @param {Object} config - Configuration object
   * @param {string} config.sessionId - Session ID (e.g., 'OLMA-20251118')
   * @returns {Promise<Object>} Session metadata
   */
  async initialize(config) {
    const { sessionId } = config;
    
    if (!sessionId) {
      throw new Error('sessionId is required');
    }

    console.log('📥 ReplayProvider: Loading session:', sessionId);
    this.sessionId = sessionId;
    this.currentSession = sessionId; // Track current session for fetchHistorical check
    
    // Load session data using existing API
    this.sessionData = await api.loadSessionData(sessionId);
    
    console.log(`✓ Loaded ${this.sessionData.length} ticks`);
    
    // Initialize virtual time from first tick
    if (this.sessionData.length > 0) {
      this.virtualTime = this.sessionData[0].adjustedTimestamp;
    }
    
    // Return metadata
    return {
      symbol: sessionId.split('-')[0],
      totalTicks: this.sessionData.length,
      startTime: this.sessionData[0]?.adjustedTimestamp,
      endTime: this.sessionData[this.sessionData.length - 1]?.adjustedTimestamp
    };
  }

  /**
   * Fetch historical data (for preview mode)
   * @param {string} symbol - Symbol/Session ID
   * @param {string} interval - Interval (e.g., '1', '5', '60')
   * @param {number} from - Start timestamp (optional)
   * @param {number} to - End timestamp (optional)
   * @returns {Promise<Array>} Array of OHLCV bars
   */
  async fetchHistorical(symbol, interval, from = null, to = null) {
    console.log(`📊 ReplayProvider: Fetching historical data for ${symbol} (interval: ${interval}s)`);
    
    // Auto-load session if not already loaded or different symbol
    if (!this.sessionData || this.currentSession !== symbol) {
      console.log(`📥 ReplayProvider: Auto-loading session: ${symbol}`);
      
      // Initialize with proper config object
      try {
        await this.initialize({ sessionId: symbol });
      } catch (error) {
        console.error('❌ ReplayProvider: Failed to auto-load session:', error);
        return []; // Return empty array if can't load
      }
    }

    // Convert ticks to OHLCV bars
    const intervalSeconds = parseInt(interval) || 1;
    const bars = this.aggregateToOHLCV(this.sessionData, intervalSeconds, from, to);
    
    console.log(`✓ Generated ${bars.length} bars`);
    return bars;
  }

  /**
   * Subscribe to real-time tick updates (replay mode)
   * @param {string} symbol - Symbol
   * @param {string} interval - Interval (not used in replay, kept for API compatibility)
   * @param {Function} callback - Callback function(bar)
   * @returns {Function} Unsubscribe function
   */
  subscribe(symbol, interval, callback) {
    const subscriptionId = `${symbol}-${Date.now()}`;
    
    this.subscribers.set(subscriptionId, callback);
    console.log(`📡 ReplayProvider: Subscription ${subscriptionId} added (${this.subscribers.size} total)`);
    
    return () => {
      this.subscribers.delete(subscriptionId);
      console.log(`📡 ReplayProvider: Subscription ${subscriptionId} removed`);
      
      if (this.subscribers.size === 0) {
        this.stopStreaming();
      }
    };
  }

  /**
   * Start tick streaming (replay playback)
   */
  startStreaming() {
    if (this.tickInterval) {
      console.warn('⚠️ Streaming already started');
      return;
    }

    if (!this.sessionData || this.sessionData.length === 0) {
      console.error('❌ No session data to stream');
      return;
    }

    console.log('▶️ ReplayProvider: Starting tick streaming');
    this.isPlaying = true;
    this.isPaused = false;

    // Keep track of current bar being built
    this.currentBar = null;
    this.currentBarTime = null;

    // Fixed interval: 100ms per tick (10 ticks/sec), adjusted by speed
    const intervalMs = 100 / this.speed;
    
    this.tickInterval = setInterval(() => {
      if (this.isPaused) return;

      if (this.currentIndex >= this.sessionData.length) {
        // Emit final bar if exists
        if (this.currentBar) {
          this.notifySubscribers(this.currentBar);
          this.currentBar = null;
        }
        
        console.log('⏹️ ReplayProvider: Reached end of session');
        this.stopStreaming();
        this.notifyEnd();
        return;
      }

      const tick = this.sessionData[this.currentIndex];
      
      // Convert tick to bar data
      const tickBar = this.tickToBar(tick);
      const tickBarTime = tickBar.time;
      
      // If this is a new bar time, emit the previous bar and start a new one
      if (this.currentBarTime !== null && tickBarTime !== this.currentBarTime) {
        // Emit completed bar
        this.notifySubscribers(this.currentBar);
        
        // Start new bar
        this.currentBar = { ...tickBar };
        this.currentBarTime = tickBarTime;
      } else if (this.currentBar === null) {
        // First bar
        this.currentBar = { ...tickBar };
        this.currentBarTime = tickBarTime;
      } else {
        // Same bar time - update OHLC
        this.currentBar.high = Math.max(this.currentBar.high, tickBar.close);
        this.currentBar.low = Math.min(this.currentBar.low, tickBar.close);
        this.currentBar.close = tickBar.close;
      }
      
      this.currentIndex++;
      
      // Update virtual time (increments by 0.1s per tick)
      this.virtualTime += 0.1;
      
    }, intervalMs);
  }

  /**
   * Notify all subscribers with a bar
   */
  notifySubscribers(bar) {
    this.subscribers.forEach(callback => {
      try {
        callback(bar);
      } catch (error) {
        console.error('❌ Subscriber callback error:', error);
      }
    });
  }

  /**
   * Stop tick streaming
   */
  stopStreaming() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
      this.isPlaying = false;
      this.isPaused = false;
      this.currentBar = null;
      this.currentBarTime = null;
      console.log('⏹️ ReplayProvider: Streaming stopped');
    }
  }

  /**
   * Pause streaming
   */
  pause() {
    if (!this.isPlaying) return;
    this.isPaused = true;
    console.log('⏸️ ReplayProvider: Paused');
  }

  /**
   * Resume streaming
   */
  resume() {
    if (!this.isPlaying || !this.isPaused) return;
    this.isPaused = false;
    console.log('▶️ ReplayProvider: Resumed');
  }

  /**
   * Reset playback to beginning
   */
  reset() {
    this.stopStreaming();
    this.currentIndex = 0;
    if (this.sessionData && this.sessionData.length > 0) {
      this.virtualTime = this.sessionData[0].adjustedTimestamp;
    }
    console.log('🔄 ReplayProvider: Reset to beginning');
  }

  /**
   * Set playback speed
   * @param {number} newSpeed - Speed multiplier (0.5x, 1x, 2x, etc.)
   */
  setSpeed(newSpeed) {
    const wasPlaying = this.isPlaying && !this.isPaused;
    
    if (wasPlaying) {
      this.stopStreaming();
    }
    
    this.speed = newSpeed;
    console.log(`⚡ ReplayProvider: Speed set to ${newSpeed}x`);
    
    if (wasPlaying) {
      this.startStreaming();
    }
  }

  /**
   * Get current playback progress
   * @returns {number} Progress percentage (0-100)
   */
  getProgress() {
    if (!this.sessionData || this.sessionData.length === 0) return 0;
    return (this.currentIndex / this.sessionData.length) * 100;
  }

  /**
   * Get virtual time (for clock display)
   * @returns {number} Virtual timestamp in seconds
   */
  getVirtualTime() {
    return this.virtualTime;
  }

  /**
   * Convert tick to OHLCV bar format
   * @param {Object} tick - Tick data
   * @returns {Object} OHLCV bar
   */
  tickToBar(tick) {
    const mid = (parseFloat(tick.bid_price) + parseFloat(tick.ask_price)) / 2;
    
    // Use the actual tick timestamp - it should be unique and increasing
    const timestamp = Math.floor(tick.adjustedTimestamp);
    
    // Debug: Log if timestamp is not a number
    if (typeof timestamp !== 'number' || isNaN(timestamp)) {
      console.error('❌ Invalid timestamp:', {
        adjustedTimestamp: tick.adjustedTimestamp,
        type: typeof tick.adjustedTimestamp,
        timestamp,
        tick
      });
    }
    
    return {
      time: timestamp,  // Must be Unix timestamp (seconds)
      open: mid,
      high: mid,
      low: mid,
      close: mid
    };
  }

  /**
   * Aggregate ticks to OHLCV bars
   * @param {Array} ticks - Array of tick data
   * @param {number} intervalSeconds - Interval in seconds
   * @param {number} from - Start timestamp (optional)
   * @param {number} to - End timestamp (optional)
   * @returns {Array} Array of OHLCV bars
   */
  aggregateToOHLCV(ticks, intervalSeconds, from = null, to = null) {
    if (!ticks || ticks.length === 0) return [];

    const buckets = new Map();

    // Filter by time range if specified
    let filteredTicks = ticks;
    if (from !== null || to !== null) {
      filteredTicks = ticks.filter(tick => {
        const time = tick.adjustedTimestamp;
        if (from !== null && time < from) return false;
        if (to !== null && time > to) return false;
        return true;
      });
    }

    // Group ticks into time buckets
    filteredTicks.forEach(tick => {
      const time = tick.adjustedTimestamp;
      const bucketTime = Math.floor(time / intervalSeconds) * intervalSeconds;
      const mid = (parseFloat(tick.bid_price) + parseFloat(tick.ask_price)) / 2;

      if (!buckets.has(bucketTime)) {
        buckets.set(bucketTime, {
          time: bucketTime,
          open: mid,
          high: mid,
          low: mid,
          close: mid,
          tickCount: 0
        });
      }

      const bucket = buckets.get(bucketTime);
      bucket.high = Math.max(bucket.high, mid);
      bucket.low = Math.min(bucket.low, mid);
      bucket.close = mid;
      bucket.tickCount++;
    });

    // Convert to array and sort by time
    // Remove tickCount as it's not needed by OakView
    return Array.from(buckets.values()).map(bar => ({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close
    })).sort((a, b) => a.time - b.time);
  }

  /**
   * Notify subscribers of playback end
   */
  notifyEnd() {
    // Emit a special 'end' event if needed
    // For now, just log
    console.log('🏁 ReplayProvider: Playback ended');
  }

  /**
   * Get available timeframe intervals for a symbol
   * Required by OakView to populate interval selector
   * @param {string} symbol - Symbol/session ID
   * @returns {Array<string>} Array of available intervals
   */
  getAvailableIntervals(symbol) {
    // We support all standard intervals since we can aggregate from tick data
    // Return common intraday intervals
    return ['1', '5', '15', '30', '60', '240', '1D'];
  }

  /**
   * Get the base (native) interval for a symbol
   * @param {string} symbol - Symbol/session ID
   * @returns {string} Base interval (OakView expects format: number + optional unit [mHDWMY])
   */
  getBaseInterval(symbol) {
    // Our tick data is 100ms, but OakView's smallest supported interval is 1 second
    // Return '1' for 1 second (no unit = seconds)
    return '1'; // 1 second
  }

  /**
   * Search for available symbols/sessions
   * Required by OakView for symbol search functionality
   * @param {string} query - Search query (can be empty to return all)
   * @returns {Promise<Array>} Array of symbol objects
   */
  async searchSymbols(query = '') {
    console.log('🔍 ReplayProvider: searchSymbols called with query:', query);
    
    try {
      // Get all available sessions from the API
      console.log('📡 ReplayProvider: Fetching sessions from API...');
      const sessions = await api.getSessions();
      console.log(`✓ ReplayProvider: Found ${sessions.length} sessions:`, sessions);
      
      const upperQuery = query.toUpperCase();
      
      // Filter sessions by query if provided (search in id, symbol, or date)
      const filtered = query 
        ? sessions.filter(session => 
            session.id.toUpperCase().includes(upperQuery) ||
            session.symbol.toUpperCase().includes(upperQuery) ||
            session.date.includes(query)
          )
        : sessions;
      
      console.log(`🔍 ReplayProvider: After filtering by "${query}": ${filtered.length} sessions`);
      
      // Convert session objects to OakView symbol format
      // Note: Using full session ID as symbol so the symbol-change event has unique identifier
      const symbols = filtered.map(session => ({
        symbol: session.id,              // Full session ID (e.g., "OLMA-20251118") - used in events
        full_name: session.id,           // Display name
        description: `${session.symbol} • ${session.date}`, // Description (• separator looks cleaner)
        exchange: 'REPLAY',              // Exchange identifier
        type: 'stock',                   // Type
      }));
      
      console.log('✅ ReplayProvider: Returning symbols:', symbols);
      return symbols;
    } catch (error) {
      console.error('❌ ReplayProvider: Error searching symbols:', error);
      return [];
    }
  }

  /**
   * Disconnect and cleanup
   */
  disconnect() {
    this.stopStreaming();
    this.subscribers.clear();
    this.sessionData = null;
    this.sessionId = null;
    console.log('🔌 ReplayProvider: Disconnected');
  }
}

export default ReplaySessionDataProvider;
