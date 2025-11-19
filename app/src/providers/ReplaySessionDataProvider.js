/**
 * ReplaySessionDataProvider
 * 
 * Custom OakView data provider for momentum stock replay sessions.
 * Handles binary session file loading, decompression, parsing, and
 * fixed-rate tick streaming for playback.
 */

import { OakViewDataProvider } from 'oakview';
import * as api from '../utils/api.js';

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
   * @param {string} symbol - Symbol
   * @param {string} interval - Interval (e.g., '1', '5', '60')
   * @param {number} from - Start timestamp (optional)
   * @param {number} to - End timestamp (optional)
   * @returns {Promise<Array>} Array of OHLCV bars
   */
  async fetchHistorical(symbol, interval, from = null, to = null) {
    if (!this.sessionData) {
      throw new Error('Session not loaded. Call initialize() first.');
    }

    console.log(`📊 ReplayProvider: Fetching historical data (interval: ${interval}s)`);
    
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

    // Fixed interval: 100ms per tick (10 ticks/sec), adjusted by speed
    const intervalMs = 100 / this.speed;
    
    this.tickInterval = setInterval(() => {
      if (this.isPaused) return;

      if (this.currentIndex >= this.sessionData.length) {
        console.log('⏹️ ReplayProvider: Reached end of session');
        this.stopStreaming();
        this.notifyEnd();
        return;
      }

      const tick = this.sessionData[this.currentIndex];
      
      // Convert tick to bar format
      const bar = this.tickToBar(tick);
      
      // Notify all subscribers
      this.subscribers.forEach(callback => {
        try {
          callback(bar);
        } catch (error) {
          console.error('❌ Subscriber callback error:', error);
        }
      });
      
      this.currentIndex++;
      
      // Update virtual time (increments by 0.1s per tick)
      this.virtualTime += 0.1;
      
    }, intervalMs);
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
    
    return {
      time: tick.adjustedTimestamp,
      open: mid,
      high: mid,
      low: mid,
      close: mid,
      // Store original tick for access to detailed data
      _tick: tick,
      // Store virtual time
      _virtualTime: this.virtualTime
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
          ticks: []
        });
      }

      const bucket = buckets.get(bucketTime);
      bucket.high = Math.max(bucket.high, mid);
      bucket.low = Math.min(bucket.low, mid);
      bucket.close = mid;
      bucket.ticks.push(tick);
    });

    // Convert to array and sort by time
    return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
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
