import { useState, useCallback, useRef, useEffect } from 'react';

export function usePositionManager() {
  const [positions, setPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [summary, setSummary] = useState({
    totalPosition: 0,
    avgPrice: 0,
    unrealizedPL: 0,
    realizedPL: 0,
    plPerShare: 0
  });

  const currentPriceRef = useRef(null);

  // Update current price for P&L calculations
  const updateCurrentPrice = useCallback((quote) => {
    if (!quote) return;

    const midPrice = (quote.bid + quote.ask) / 2;
    currentPriceRef.current = midPrice;

    // Recalculate unrealized P&L with new price
    calculateSummary(positions, trades, midPrice);
  }, [positions, trades]);

  const calculateSummary = useCallback((currentPositions, currentTrades, currentPrice) => {
    // Calculate total position
    const totalPosition = currentPositions.reduce((sum, pos) => sum + pos.quantity, 0);

    if (totalPosition === 0) {
      setSummary({
        totalPosition: 0,
        avgPrice: 0,
        unrealizedPL: 0,
        realizedPL: currentTrades.reduce((sum, t) => sum + t.realizedPL, 0),
        plPerShare: 0
      });
      return;
    }

    // Calculate average price (weighted)
    const totalCost = currentPositions.reduce((sum, pos) => sum + (pos.price * pos.quantity), 0);
    const avgPrice = totalCost / totalPosition;

    // Calculate unrealized P&L
    const unrealizedPL = (currentPrice - avgPrice) * totalPosition;

    // Calculate realized P&L from closed trades
    const realizedPL = currentTrades.reduce((sum, t) => sum + (t.realizedPL || 0), 0);

    // P&L per share
    const plPerShare = currentPrice - avgPrice;

    setSummary({
      totalPosition,
      avgPrice,
      unrealizedPL,
      realizedPL,
      plPerShare
    });
  }, []);

  const executeTrade = useCallback((side, quantity, price) => {
    const timestamp = new Date().toISOString();
    const tradeId = `${timestamp}-${Math.random().toString(36).substr(2, 9)}`;

    const newTrade = {
      id: tradeId,
      timestamp,
      side, // 'buy' or 'sell'
      quantity,
      price,
      realizedPL: 0
    };

    setPositions(prevPositions => {
      let updatedPositions = [...prevPositions];
      let realizedPL = 0;

      if (side === 'buy') {
        // Add to position
        updatedPositions.push({
          id: tradeId,
          quantity: quantity,
          price: price,
          timestamp
        });
      } else {
        // Sell - reduce positions using FIFO
        let remainingToSell = quantity;
        const newPositions = [];

        for (const pos of updatedPositions) {
          if (remainingToSell <= 0) {
            newPositions.push(pos);
            continue;
          }

          if (pos.quantity <= remainingToSell) {
            // Close entire position
            realizedPL += (price - pos.price) * pos.quantity;
            remainingToSell -= pos.quantity;
            // Position is fully closed, don't add to newPositions
          } else {
            // Partially close position
            realizedPL += (price - pos.price) * remainingToSell;
            newPositions.push({
              ...pos,
              quantity: pos.quantity - remainingToSell
            });
            remainingToSell = 0;
          }
        }

        // If we're selling more than we have (short selling)
        if (remainingToSell > 0) {
          newPositions.push({
            id: tradeId,
            quantity: -remainingToSell, // Negative for short
            price: price,
            timestamp
          });
        }

        updatedPositions = newPositions;
        newTrade.realizedPL = realizedPL;
      }

      calculateSummary(updatedPositions, [...trades, newTrade], currentPriceRef.current);
      return updatedPositions;
    });

    setTrades(prevTrades => [...prevTrades, newTrade]);

    return newTrade;
  }, [trades, calculateSummary]);

  const buy = useCallback((quantity, price) => {
    return executeTrade('buy', quantity, price);
  }, [executeTrade]);

  const sell = useCallback((quantity, price) => {
    return executeTrade('sell', quantity, price);
  }, [executeTrade]);

  const reset = useCallback(() => {
    setPositions([]);
    setTrades([]);
    setSummary({
      totalPosition: 0,
      avgPrice: 0,
      unrealizedPL: 0,
      realizedPL: 0,
      plPerShare: 0
    });
    currentPriceRef.current = null;
  }, []);

  return {
    positions,
    trades,
    summary,
    buy,
    sell,
    reset,
    updateCurrentPrice
  };
}