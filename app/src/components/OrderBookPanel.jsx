import React, { useMemo, useState, useEffect } from "react";
import { usePositionManager } from "../hooks/usePositionManager";
import { useSettings } from "../contexts/SettingsContext";
import { useOrderBook } from "../hooks/useOrderBook";

export default function OrderBookPanel({ sessionData, onAddMarker, onPositionChange, onOpenSettings }) {
  const { quote, stats } = sessionData;
  const [positionSize, setPositionSize] = useState(100);
  const { positions, trades, summary, stopLoss, takeProfit, buy, sell, reset, updateCurrentPrice, setStopLoss, setTakeProfit } = usePositionManager();
  const [slInput, setSlInput] = useState('');
  const [tpInput, setTpInput] = useState('');
  const { settings } = useSettings();
  const { updateOrderBook, clearOrderBook, getOrderBook } = useOrderBook();

  // Update current price for P/L calculations
  useEffect(() => {
    if (quote) {
      updateCurrentPrice(quote);
    }
  }, [quote, updateCurrentPrice]);

  // Notify parent about position changes (including SL/TP)
  useEffect(() => {
    if (onPositionChange) {
      onPositionChange({ ...summary, stopLoss, takeProfit });
    }
  }, [summary, stopLoss, takeProfit, onPositionChange]);

  // Update order book state with exchange snapshots from each tick
  useEffect(() => {
    if (quote && quote.exchanges) {
      updateOrderBook(quote.exchanges);
    }
  }, [quote, updateOrderBook]);

  // Reset positions and order book when session resets
  useEffect(() => {
    const quoteCount = stats?.quoteCount || 0;
    if (quoteCount === 0) {
      reset();
      clearOrderBook();
    }
  }, [stats?.quoteCount, reset, clearOrderBook]);

  const handleBuy = () => {
    if (!quote) return;
    const price = quote.ask;
    const trade = buy(positionSize, price, quote.t); // Pass session time
    console.log('🟢 BUY executed:', positionSize, '@', price.toFixed(4), 'at session time:', quote.t);

    // Add marker on chart
    if (onAddMarker) {
      onAddMarker({
        time: quote.t,
        position: 'belowBar',
        color: '#089981',
        shape: 'arrowUp',
        text: `+${positionSize}`
      });
    }
  };

  const handleSell = () => {
    if (!quote) return;
    const price = quote.bid;
    const trade = sell(positionSize, price, quote.t); // Pass session time
    console.log('🔴 SELL executed:', positionSize, '@', price.toFixed(4), 'at session time:', quote.t);

    // Add marker on chart with P&L if position was closed
    if (onAddMarker) {
      const plText = trade.realizedPL !== 0 ? ` (${trade.realizedPL >= 0 ? '+' : ''}$${trade.realizedPL.toFixed(2)})` : '';
      onAddMarker({
        time: quote.t,
        position: 'aboveBar',
        color: '#F23645',
        shape: 'arrowDown',
        text: `-${positionSize}${plText}`
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

  // Map publisher IDs to exchange names
  const getExchangeName = (publisherId) => {
    // Databento publisher IDs
    const publisherMap = {
      1: 'NSDQ',   // NASDAQ
      2: 'NYSE',   // NYSE
      3: 'ARCA',   // NYSE Arca
      4: 'BATS',   // Cboe BZX
      5: 'IEXG',   // IEX
      9: 'BATY',   // Cboe BYX
      38: 'EDGA',  // Cboe EDGA
      43: 'PHLX',  // NASDAQ PSX
      // Add more as needed based on actual data
    };
    return publisherMap[publisherId] || `EX${publisherId}`;
  };

  // Use real multi-exchange order book data with stateful tracking
  const orderBookData = useMemo(() => {
    if (!quote) {
      return { bids: [], asks: [] };
    }

    // Get current order book state (accumulated from all ticks)
    const { bids, asks } = getOrderBook(settings.orderBookMinSize);

    // Debug: Log order book size
    if (Math.random() < 0.05) { // 5% of the time
      console.log(`📊 Order Book: ${bids.length} bids, ${asks.length} asks (minSize=${settings.orderBookMinSize})`);
    }

    // Map to include exchange names
    const bidsWithNames = bids.map(b => ({
      maker: getExchangeName(b.publisher_id),
      price: b.price,
      size: b.size
    }));

    const asksWithNames = asks.map(a => ({
      maker: getExchangeName(a.publisher_id),
      price: a.price,
      size: a.size
    }));

    // If aggregated mode, group by price level
    if (settings.orderBookViewMode === 'aggregated') {
      // Aggregate bids by price
      const bidsByPrice = {};
      bidsWithNames.forEach(b => {
        const priceKey = b.price.toFixed(4);
        if (!bidsByPrice[priceKey]) {
          bidsByPrice[priceKey] = { price: b.price, size: 0 };
        }
        bidsByPrice[priceKey].size += b.size;
      });

      // Aggregate asks by price
      const asksByPrice = {};
      asksWithNames.forEach(a => {
        const priceKey = a.price.toFixed(4);
        if (!asksByPrice[priceKey]) {
          asksByPrice[priceKey] = { price: a.price, size: 0 };
        }
        asksByPrice[priceKey].size += a.size;
      });

      // Convert to arrays and sort
      const aggregatedBids = Object.values(bidsByPrice).sort((a, b) => b.price - a.price);
      const aggregatedAsks = Object.values(asksByPrice).sort((a, b) => a.price - b.price);

      return { bids: aggregatedBids, asks: aggregatedAsks };
    }

    return { bids: bidsWithNames, asks: asksWithNames };
  }, [quote, getOrderBook, settings.orderBookMinSize, settings.orderBookViewMode]);

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

  // Check if we're using real exchange data (V3 format)
  const isUsingRealL2Data = quote?.exchanges && quote.exchanges.length > 0;

  return (
    <div className="w-[400px] flex flex-col bg-[#131722] border-l border-[#2A2E39] h-full overflow-hidden">
      {/* Header - TradingView Style */}
      <div className="flex-shrink-0 h-[44px] bg-[#1E222D] border-b border-[#2A2E39] flex items-center justify-between px-3">
        <h3 className="text-[13px] font-semibold text-[#B2B5BE]">📖 Order Book</h3>
        <button
          onClick={onOpenSettings}
          className="h-[32px] w-[32px] rounded hover:bg-[#2A2E39] transition-colors flex items-center justify-center text-[#B2B5BE] hover:text-white"
          title="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      </div>

      {/* NBBO Summary Row - Shows aggregated bid/ask that appears on chart */}
      {quote && (
        <div className="flex-shrink-0 px-2 py-2 border-b border-[#2A2E39] bg-[#1E222D]">
          <div className="text-[10px] text-[#787B86] uppercase font-semibold mb-1">NBBO (Chart View)</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2">
              <span className="text-[#089981] font-bold">BID</span>
              <span className="text-white font-mono text-sm">{quote.bid.toFixed(4)}</span>
            </div>
            <div className="flex-1 flex items-center gap-2">
              <span className="text-[#F23645] font-bold">ASK</span>
              <span className="text-white font-mono text-sm">{quote.ask.toFixed(4)}</span>
            </div>
            <div className="flex-1 flex items-center gap-2">
              <span className="text-[#787B86] font-bold">SPR</span>
              <span className={`font-mono text-sm ${quote.bid >= quote.ask ? 'text-red-500 font-bold' : 'text-[#B2B5BE]'}`}>
                {(quote.ask - quote.bid).toFixed(4)}
              </span>
            </div>
          </div>
          {quote.bid >= quote.ask && (
            <div className="mt-1 px-2 py-1 bg-red-500/20 border-l-2 border-red-500 text-red-400 text-[10px] flex items-center gap-1">
              <span>⚠️</span>
              <span>CROSSED: Best bid from {getExchangeName(quote.best_bid_publisher || 0)} exceeds best ask from {getExchangeName(quote.best_ask_publisher || 0)}</span>
            </div>
          )}
        </div>
      )}

      {/* Order Book - Fixed Height based on depth */}
      <div className="flex-shrink-0 px-2 py-2 border-b border-[#2A2E39] bg-[#131722]">
        <div className="text-[10px] text-[#787B86] uppercase font-semibold mb-1">
          {settings.orderBookViewMode === 'exchange' ? 'Exchange Snapshots' : 'Aggregated by Price'}
        </div>
        <table className="w-full text-xs table-fixed border-collapse">
          <thead>
            <tr className="bg-[#1E222D] text-[#B2B5BE]">
              {settings.orderBookViewMode === 'exchange' ? (
                <>
                  <th className="text-left px-1 py-1 font-bold border-r border-black">Maker</th>
                  <th className="text-right px-1 py-1 font-bold border-r border-black">Price</th>
                  <th className="text-right px-1 py-1 font-bold border-r border-black">Size</th>
                  <th className="text-left px-1 py-1 font-bold border-r border-black">Maker</th>
                  <th className="text-right px-1 py-1 font-bold border-r border-black">Price</th>
                  <th className="text-right px-1 py-1 font-bold">Size</th>
                </>
              ) : (
                <>
                  <th className="text-right px-1 py-1 font-bold border-r border-black">Price</th>
                  <th className="text-right px-1 py-1 font-bold border-r border-black">Size</th>
                  <th className="text-right px-1 py-1 font-bold border-r border-black">Price</th>
                  <th className="text-right px-1 py-1 font-bold">Size</th>
                </>
              )}
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
                  {settings.orderBookViewMode === 'exchange' ? (
                    <>
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
                    </>
                  ) : (
                    <>
                      <td className={`text-right px-1 py-0.5 font-bold border-r border-black text-black ${bidColor}`}>
                        {bid ? bid.price.toFixed(2) : ''}
                      </td>
                      <td className={`text-right px-1 py-0.5 font-bold border-r border-black text-black ${bidColor}`}>
                        {bid?.size || ''}
                      </td>
                      <td className={`text-right px-1 py-0.5 font-bold border-r border-black text-black ${askColor}`}>
                        {ask ? ask.price.toFixed(2) : ''}
                      </td>
                      <td className={`text-right px-1 py-0.5 font-bold text-black ${askColor}`}>
                        {ask?.size || ''}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
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
                    // Format time in EST (timestamp is Unix seconds)
                    const tradeTime = new Date(trade.timestamp * 1000);
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

      {/* Trading Controls */}
      <div className="flex-shrink-0 bg-[#1E222D] px-4 py-2.5 border-t border-[#2A2E39]">
        {/* SL/TP Row */}
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-red-400 font-semibold w-6">SL</span>
              <input
                type="number"
                value={slInput}
                onChange={(e) => {
                  setSlInput(e.target.value);
                  setStopLoss(e.target.value);
                }}
                placeholder="Stop Loss"
                className="w-full bg-[#131722] border border-red-900/50 rounded px-2 py-1 text-white text-xs focus:outline-none focus:ring-1 focus:ring-red-500"
                step="0.01"
              />
            </div>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-green-400 font-semibold w-6">TP</span>
              <input
                type="number"
                value={tpInput}
                onChange={(e) => {
                  setTpInput(e.target.value);
                  setTakeProfit(e.target.value);
                }}
                placeholder="Take Profit"
                className="w-full bg-[#131722] border border-green-900/50 rounded px-2 py-1 text-white text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
                step="0.01"
              />
            </div>
          </div>
          {(stopLoss || takeProfit) && quote && (
            <div className="text-[10px] text-[#787B86]">
              {stopLoss && <span className="text-red-400">SL: {((quote.bid - stopLoss) * summary.totalPosition).toFixed(2)}</span>}
              {stopLoss && takeProfit && ' | '}
              {takeProfit && <span className="text-green-400">TP: {((takeProfit - quote.ask) * summary.totalPosition).toFixed(2)}</span>}
            </div>
          )}
        </div>

        {/* Position Size and Buy/Sell */}
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