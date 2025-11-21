import { useState, useCallback, useEffect } from 'react';

/**
 * Maintains a stateful order book by tracking exchange snapshots
 * Updates incrementally as exchange data arrives in each tick
 */
export function useOrderBook() {
  // State: exchange_id -> { bid_price, ask_price, bid_size, ask_size, publisher_id }
  const [exchangeState, setExchangeState] = useState({});

  /**
   * Update order book with new exchange snapshots from a tick
   * @param {Array} exchanges - Array of exchange snapshots from quote.exchanges
   */
  const updateOrderBook = useCallback((exchanges) => {
    if (!exchanges || exchanges.length === 0) {
      return; // No updates in this tick
    }

    setExchangeState(prev => {
      const updated = { ...prev };
      
      exchanges.forEach(ex => {
        const key = ex.publisher_id;
        updated[key] = {
          publisher_id: ex.publisher_id,
          bid_price: parseFloat(ex.bid_price),
          ask_price: parseFloat(ex.ask_price),
          bid_size: parseFloat(ex.bid_size),
          ask_size: parseFloat(ex.ask_size),
          timestamp: Date.now() // Track when this was last updated
        };
      });

      return updated;
    });
  }, []);

  /**
   * Clear the order book (e.g., when session changes)
   */
  const clearOrderBook = useCallback(() => {
    setExchangeState({});
  }, []);

  /**
   * Get current order book sorted by price
   * @param {number} minSize - Minimum size filter
   * @returns {{ bids: Array, asks: Array }}
   */
  const getOrderBook = useCallback((minSize = 0) => {
    const exchanges = Object.values(exchangeState);

    const bids = exchanges
      .filter(ex => ex.bid_price > 0 && ex.bid_size >= minSize)
      .map(ex => ({
        publisher_id: ex.publisher_id,
        price: ex.bid_price,
        size: ex.bid_size
      }))
      .sort((a, b) => b.price - a.price); // Best bid first

    const asks = exchanges
      .filter(ex => ex.ask_price > 0 && ex.ask_size >= minSize)
      .map(ex => ({
        publisher_id: ex.publisher_id,
        price: ex.ask_price,
        size: ex.ask_size
      }))
      .sort((a, b) => a.price - b.price); // Best ask first

    return { bids, asks };
  }, [exchangeState]);

  /**
   * Get stats about the order book
   */
  const getStats = useCallback(() => {
    const exchanges = Object.values(exchangeState);
    return {
      totalExchanges: exchanges.length,
      activeBids: exchanges.filter(ex => ex.bid_price > 0 && ex.bid_size > 0).length,
      activeAsks: exchanges.filter(ex => ex.ask_price > 0 && ex.ask_size > 0).length
    };
  }, [exchangeState]);

  return {
    updateOrderBook,
    clearOrderBook,
    getOrderBook,
    getStats,
    exchangeState
  };
}
