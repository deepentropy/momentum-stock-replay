import React, { useMemo, useState, useEffect, useCallback } from "react";
import { usePositionManager } from "../hooks/usePositionManager";
import { useSettings } from "../contexts/SettingsContext";

export default function OrderBookPanel({ sessionData, onAddMarker }) {
  const { quote, stats, level2Data } = sessionData;
  const [positionSize, setPositionSize] = useState(100);
  const { positions, trades, summary, buy, sell, reset, updateCurrentPrice } = usePositionManager();
  const { settings } = useSettings();

  // Update current price for P/L calculations
  useEffect(() => {
    if (quote) {
      updateCurrentPrice(quote);
    }
  }, [quote, updateCurrentPrice]);

  // Reset positions when session resets
  useEffect(() => {
    const quoteCount = stats?.quoteCount || 0;
    if (quoteCount === 0) {
      reset();
      // Reset L2 snapshot cache when session resets
      lastL2SnapshotRef.current = null;
    }
  }, [stats?.quoteCount, reset]);

  const handleBuy = () => {
    if (!quote) return;
    const price = quote.ask;
    buy(positionSize, price);
    console.log('🟢 BUY executed:', positionSize, '@', price.toFixed(4));

    // Add marker on chart
    if (onAddMarker) {
      onAddMarker({
        time: quote.t,
        position: 'belowBar',
        color: '#089981',
        shape: 'arrowUp',
        //text: `Buy ${positionSize} @ ${price.toFixed(2)}`
      });
    }
  };

  const handleSell = () => {
    if (!quote) return;
    const price = quote.bid;
    sell(positionSize, price);
    console.log('🔴 SELL executed:', positionSize, '@', price.toFixed(4));

    // Add marker on chart
    if (onAddMarker) {
      onAddMarker({
        time: quote.t,
        position: 'aboveBar',
        color: '#F23645',
        shape: 'arrowDown',
        text: `Sell ${positionSize} @ ${price.toFixed(2)}`
      });
    }
  };

  // Parse shortcut string to check against event
  const matchesShortcut = (e, shortcutString) => {
    const parts = shortcutString.split('+');
    const modifiers = parts.slice(0, -1);
    const key = parts[parts.length - 1];

    const hasCtrl = modifiers.includes('Ctrl') ? e.ctrlKey : !e.ctrlKey;
    const hasShift = modifiers.includes('Shift') ? e.shiftKey : !e.shiftKey;
    const hasAlt = modifiers.includes('Alt') ? e.altKey : !e.altKey;
    const hasMeta = modifiers.includes('Meta') ? e.metaKey : !e.metaKey;

    const keyMatches = e.key.toUpperCase() === key || e.code === `Key${key}` || e.code === `Digit${key}`;

    return hasCtrl && hasShift && hasAlt && hasMeta && keyMatches;
  };

  // Keyboard shortcuts using settings
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!quote) return;

      if (matchesShortcut(e, settings.buyShortcut)) {
        e.preventDefault();
        e.stopPropagation();
        handleBuy();
      } else if (matchesShortcut(e, settings.sellShortcut)) {
        e.preventDefault();
        e.stopPropagation();
        handleSell();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [quote, positionSize, positions, settings]);

  // Exchange distribution based on real market data
  const exchanges = [
    { name: 'NSDQ', weight: 28.03 },
    { name: 'NYSE', weight: 23.86 },
    { name: 'ARCA', weight: 14.91 },
    { name: 'AMEX', weight: 1.19 },
    { name: 'BATS', weight: 6.94 },
    { name: 'BATY', weight: 1.37 },
    { name: 'EDGX', weight: 5.67 },
    { name: 'EDGA', weight: 0.91 },
    { name: 'MEMX', weight: 8.95 },
    { name: 'IEXG', weight: 5.57 },
    { name: 'MIAX', weight: 2.58 },
    { name: 'LTSE', weight: 0.02 },
    { name: 'PHLX', weight: 0.00 },
    { name: 'BOSX', weight: 0.00 },
  ];

  // Calculate cumulative weights for efficient selection
  const cumulativeWeights = exchanges.reduce((acc, exchange, idx) => {
    const prevWeight = idx > 0 ? acc[idx - 1] : 0;
    acc.push(prevWeight + exchange.weight);
    return acc;
  }, []);
  const totalWeight = cumulativeWeights[cumulativeWeights.length - 1];

  // Function to select exchange based on weighted probability
  const selectExchangeByWeight = () => {
    const random = Math.random() * totalWeight;

    for (let i = 0; i < cumulativeWeights.length; i++) {
      if (random <= cumulativeWeights[i]) {
        return exchanges[i].name;
      }
    }

    return exchanges[0].name;
  };

  // Generate random size in multiples of 100
  const generateSize = () => {
    return Math.floor(Math.random() * 10 + 1) * 100; // 100 to 1000 by steps of 100
  };

  // Keep track of last L2 snapshot for forward-filling
  const lastL2SnapshotRef = React.useRef(null);

  // Filter Level 2 data by current timestamp with forward-fill
  const getLevel2Snapshot = useCallback((currentTimestamp) => {
    if (!level2Data || !currentTimestamp || level2Data.length === 0) {
      return lastL2SnapshotRef.current; // Return last known snapshot if no L2 data
    }

    // currentTimestamp is in seconds (Unix timestamp), convert to milliseconds
    const currentTimeMs = Math.floor(currentTimestamp * 1000);

    // Find all L2 entries that match the current timestamp
    // Use timestamp_ms field directly for better performance
    const snapshot = level2Data.filter(entry => {
      const entryTimeMs = entry.timestamp_ms;
      // Match entries within a reasonable time window (100ms)
      return Math.abs(entryTimeMs - currentTimeMs) <= 100;
    });

    if (snapshot.length === 0) {
      // No exact match - forward fill from last snapshot
      return lastL2SnapshotRef.current;
    }

    // Separate bids (entry_type === 0) and asks (entry_type === 1)
    const bids = snapshot
      .filter(entry => entry.entry_type === 0)
      .map(entry => ({
        maker: entry.exchange,
        price: entry.price,
        size: entry.size
      }))
      .sort((a, b) => b.price - a.price); // Sort bids by price descending (best bid first)

    const asks = snapshot
      .filter(entry => entry.entry_type === 1)
      .map(entry => ({
        maker: entry.exchange,
        price: entry.price,
        size: entry.size
      }))
      .sort((a, b) => a.price - b.price); // Sort asks by price ascending (best ask first)

    const result = { bids, asks };

    // Store this snapshot for forward-filling
    lastL2SnapshotRef.current = result;

    return result;
  }, [level2Data]);

  // Generate order book levels using Level 2 data or configured depth
  const orderBookData = useMemo(() => {
    if (!quote) {
      return { bids: [], asks: [] };
    }

    // Try to get Level 2 snapshot if available
    const l2Snapshot = getLevel2Snapshot(quote.t);

    if (l2Snapshot && (l2Snapshot.bids.length > 0 || l2Snapshot.asks.length > 0)) {
      // Use real Level 2 data - don't pad or generate extra levels
      // Just return what we have from the L2 data
      return {
        bids: l2Snapshot.bids,
        asks: l2Snapshot.asks
      };
    }

    // Fallback to generated order book
    const depth = settings.orderBookDepth;
    const bids = [];
    const asks = [];

    // Track used exchanges for each side independently
    const usedBidExchanges = new Set();
    const usedAskExchanges = new Set();

    // Generate bids - first line uses CSV data, others are generated
    for (let i = 0; i < depth; i++) {
      let bidExchange;
      let attempts = 0;
      do {
        bidExchange = selectExchangeByWeight();
        attempts++;
        if (attempts > 100) {
          bidExchange = `MKT${i}`;
          break;
        }
      } while (usedBidExchanges.has(bidExchange));

      usedBidExchanges.add(bidExchange);

      // First line (i=0) uses CSV bid price and size
      // Other lines use decreasing prices with generated sizes
      const bidPrice = i === 0 ? quote.bid : quote.bid - (i * 0.01);
      const bidSize = i === 0 ? (quote.bidSize || 100) : generateSize();

      bids.push({
        maker: bidExchange,
        price: bidPrice,
        size: bidSize
      });
    }

    // Generate asks - first line uses CSV data, others are generated
    for (let i = 0; i < depth; i++) {
      let askExchange;
      let attempts = 0;
      do {
        askExchange = selectExchangeByWeight();
        attempts++;
        if (attempts > 100) {
          askExchange = `MKT${i}`;
          break;
        }
      } while (usedAskExchanges.has(askExchange));

      usedAskExchanges.add(askExchange);

      // First line (i=0) uses CSV ask price and size
      // Other lines use increasing prices with generated sizes
      const askPrice = i === 0 ? quote.ask : quote.ask + (i * 0.01);
      const askSize = i === 0 ? (quote.askSize || 100) : generateSize();

      asks.push({
        maker: askExchange,
        price: askPrice,
        size: askSize
      });
    }

    return { bids, asks };
  }, [quote, settings.orderBookDepth, getLevel2Snapshot]);

  // Assign colors based on unique price levels
  const getPriceLevelColors = () => {
    // Colors: 1st level = green, 2nd = pink, 3rd = yellow, 4th = blue, rest = grey
    const colors = ['bg-[#57fe01]', 'bg-[#fd807f]', 'bg-[#fbfe01]', 'bg-[#03fef9]', 'bg-[#c1c1c1]'];

    // Get unique bid prices sorted from highest to lowest (best bid first)
    const uniqueBidPrices = [...new Set(orderBookData.bids.map(b => b.price))].sort((a, b) => b - a);

    // Get unique ask prices sorted from lowest to highest (best ask first)
    const uniqueAskPrices = [...new Set(orderBookData.asks.map(a => a.price))].sort((a, b) => a - b);

    // Map each price to its color based on its rank
    const bidPriceToColor = {};
    uniqueBidPrices.forEach((price, index) => {
      bidPriceToColor[price.toFixed(4)] = colors[Math.min(index, colors.length - 1)];
    });

    const askPriceToColor = {};
    uniqueAskPrices.forEach((price, index) => {
      askPriceToColor[price.toFixed(4)] = colors[Math.min(index, colors.length - 1)];
    });

    return { bidPriceToColor, askPriceToColor };
  };

  const { bidPriceToColor, askPriceToColor } = getPriceLevelColors();

  const formatCurrency = (value) => {
    return value >= 0 ? `$${value.toFixed(2)}` : `-$${Math.abs(value).toFixed(2)}`;
  };

  const formatPrice = (value) => {
    return value.toFixed(4);
  };

  const midPrice = quote ? (quote.bid + quote.ask) / 2 : 0;

  // Check if we're using real L2 data
  const isUsingRealL2Data = useMemo(() => {
    if (!quote || !level2Data) return false;
    const l2Snapshot = getLevel2Snapshot(quote.t);
    return l2Snapshot && (l2Snapshot.bids.length > 0 || l2Snapshot.asks.length > 0);
  }, [quote, level2Data, getLevel2Snapshot]);

  return (
    <div className="w-[400px] flex flex-col bg-[#131722] border-l border-[#2A2E39] h-full overflow-hidden">
      {/* Header - TradingView Style */}
      <div className="flex-shrink-0 h-[44px] bg-[#1E222D] border-b border-[#2A2E39] flex items-center justify-center">
        <h3 className="text-[13px] font-semibold text-[#B2B5BE]">📖 Order Book</h3>
      </div>

      {/* Order Book - Fixed Height based on depth */}
      <div className="flex-shrink-0 px-2 py-2 border-b border-[#2A2E39] bg-[#131722]">
        <table className="w-full text-xs table-fixed border-collapse">
          <thead>
            <tr className="bg-[#1E222D] text-[#B2B5BE]">
              <th className="text-left px-1 py-1 font-bold border-r border-black">Maker</th>
              <th className="text-right px-1 py-1 font-bold border-r border-black">Price</th>
              <th className="text-right px-1 py-1 font-bold border-r border-black">Size</th>
              <th className="text-left px-1 py-1 font-bold border-r border-black">Maker</th>
              <th className="text-right px-1 py-1 font-bold border-r border-black">Price</th>
              <th className="text-right px-1 py-1 font-bold">Size</th>
            </tr>
          </thead>
          <tbody>
            {/* Always render exactly settings.orderBookDepth rows to maintain fixed height */}
            {Array.from({ length: settings.orderBookDepth }).map((_, i) => {
              const bid = orderBookData.bids[i];
              const ask = orderBookData.asks[i];

              // Get color based on price level
              const bidColor = bid ? bidPriceToColor[bid.price.toFixed(4)] || 'bg-[#c1c1c1]' : 'bg-transparent';
              const askColor = ask ? askPriceToColor[ask.price.toFixed(4)] || 'bg-[#c1c1c1]' : 'bg-transparent';

              return (
                <tr key={i} style={{ height: '22px' }}>
                  <td className={`text-left px-1 py-0.5 font-bold border-r border-black text-black ${bidColor}`}>
                    {bid?.maker || ''}
                  </td>
                  <td className={`text-right px-1 py-0.5 font-bold border-r border-black text-black ${bidColor}`}>
                    {bid ? bid.price.toFixed(2) : ''}
                  </td>
                  <td className={`text-right px-1 py-0.5 font-bold border-r border-black text-black ${bidColor}`}>
                    {bid?.size || ''}
                  </td>
                  <td className={`text-left px-1 py-0.5 font-bold border-r border-black text-black ${askColor}`}>
                    {ask?.maker || ''}
                  </td>
                  <td className={`text-right px-1 py-0.5 font-bold border-r border-black text-black ${askColor}`}>
                    {ask ? ask.price.toFixed(2) : ''}
                  </td>
                  <td className={`text-right px-1 py-0.5 font-bold text-black ${askColor}`}>
                    {ask?.size || ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* L2 Data Warning */}
        {quote && !isUsingRealL2Data && (
          <div className="mt-2 text-center">
            <span className="text-[10px] text-[#787B86] italic opacity-70">
              ⚠ Levels are generated (no L2 data available)
            </span>
          </div>
        )}
      </div>

      {/* Position Summary - Redesigned */}
      <div className="flex-1 overflow-y-auto bg-[#131722] px-4 py-3 space-y-3">
        {/* Current Position - Single Line Layout */}
        <div className="bg-[#1E222D] rounded p-3">
          <h4 className="text-[11px] text-[#787B86] uppercase font-semibold mb-2">Current Position</h4>

          {/* All fields in one line */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {/* Position Size */}
            <div>
              <div className="text-[10px] text-[#787B86] mb-0.5">Size</div>
              <div className={`text-base font-bold ${summary.totalPosition > 0 ? 'text-green-400' : summary.totalPosition < 0 ? 'text-red-400' : 'text-[#B2B5BE]'}`}>
                {summary.totalPosition || '—'}
              </div>
            </div>

            {/* Avg Price */}
            <div>
              <div className="text-[10px] text-[#787B86] mb-0.5">Avg Price</div>
              <div className="text-base font-bold text-white">
                {summary.totalPosition !== 0 ? formatPrice(summary.avgPrice) : '—'}
              </div>
            </div>

            {/* P/L per Share */}
            <div>
              <div className="text-[10px] text-[#787B86] mb-0.5">P/L/Shr</div>
              <div className={`text-base font-bold ${summary.plPerShare >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {summary.totalPosition !== 0 ? formatCurrency(summary.plPerShare) : '—'}
              </div>
            </div>

            {/* Unrealized P/L */}
            <div>
              <div className="text-[10px] text-[#787B86] mb-0.5">Unrealized</div>
              <div className={`text-base font-bold ${summary.unrealizedPL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatCurrency(summary.unrealizedPL)}
              </div>
            </div>
          </div>

          {/* Total P/L - Separate line */}
          <div className="border-t border-[#2A2E39] pt-2">
            <div className="flex justify-between items-center">
              <span className="text-[11px] text-[#787B86] uppercase font-semibold">Total P/L</span>
              <span className={`text-xl font-bold ${(summary.unrealizedPL + summary.realizedPL) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatCurrency(summary.unrealizedPL + summary.realizedPL)}
              </span>
            </div>
            <div className="text-[10px] text-[#787B86] text-right mt-0.5">
              (Realized: {formatCurrency(summary.realizedPL)})
            </div>
          </div>
        </div>

        {/* Position History */}
        <div className="bg-[#1E222D] rounded overflow-hidden flex-1 flex flex-col min-h-0">
          <h4 className="text-[11px] text-[#787B86] uppercase font-semibold px-3 py-2 bg-[#2A2E39]">
            Position History
          </h4>

          <div className="flex-1 overflow-y-auto">
            {trades.length === 0 ? (
              <div className="px-3 py-4 text-center text-[#787B86] text-xs">
                No trades yet
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#1E222D] border-b border-[#2A2E39]">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-[#787B86] font-semibold">Time</th>
                    <th className="px-2 py-1.5 text-center text-[#787B86] font-semibold">Size</th>
                    <th className="px-2 py-1.5 text-right text-[#787B86] font-semibold">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.slice().reverse().map((trade, idx) => {
                    // Format time in EST
                    const tradeTime = new Date(trade.timestamp);
                    const timeStr = tradeTime.toLocaleString('en-US', {
                      timeZone: 'America/New_York',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false
                    });

                    const sideColor = trade.side === 'buy' ? 'text-green-400' : 'text-red-400';
                    const sideSign = trade.side === 'buy' ? '+' : '-';

                    return (
                      <tr key={trade.id} className={idx % 2 === 0 ? 'bg-[#1E222D]' : 'bg-[#181C27]'}>
                        <td className="px-2 py-1 text-[#B2B5BE] font-mono text-[10px]">{timeStr}</td>
                        <td className={`px-2 py-1 text-center font-semibold ${sideColor}`}>
                          {sideSign}{trade.quantity}
                        </td>
                        <td className="px-2 py-1 text-right text-white font-mono">{formatPrice(trade.price)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Trading Controls - Single Line */}
      <div className="flex-shrink-0 bg-[#1E222D] px-4 py-2.5 border-t border-[#2A2E39]">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <input
              type="number"
              value={positionSize}
              onChange={(e) => setPositionSize(Number(e.target.value))}
              placeholder="Position"
              className="w-full bg-[#131722] border border-[#2A2E39] rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2962FF]"
              min="1"
              step="1"
            />
          </div>

          <button
            onClick={handleBuy}
            disabled={!quote}
            className="bg-green-600 hover:bg-green-700 disabled:bg-[#2A2E39] disabled:cursor-not-allowed text-white font-bold py-1.5 px-4 rounded transition-colors text-sm whitespace-nowrap"
          >
            Buy ({settings.buyShortcut})
          </button>

          <button
            onClick={handleSell}
            disabled={!quote}
            className="bg-red-600 hover:bg-red-700 disabled:bg-[#2A2E39] disabled:cursor-not-allowed text-white font-bold py-1.5 px-4 rounded transition-colors text-sm whitespace-nowrap"
          >
            Sell ({settings.sellShortcut})
          </button>
        </div>
      </div>
    </div>
  );
}