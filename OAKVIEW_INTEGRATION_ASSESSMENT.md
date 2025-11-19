# OakView Integration Assessment for Momentum Stock Replay

## Executive Summary

**OakView** is a lightweight Web Component wrapper for TradingView's Lightweight Charts, designed to centralize chart implementation across projects. This assessment evaluates its integration potential into the `momentum-stock-replay` project.

**Verdict:** ⚠️ **PARTIAL FIT - Requires Custom Data Provider**

---

## Current State Analysis

### Momentum Stock Replay Architecture

**Current Implementation:**
- Direct use of `lightweight-charts` library (imported from npm)
- Custom chart management in `ChartArea.jsx` (~530 lines)
- Manual series management (bid, ask, mid, candlestick, EMA9, EMA20)
- Real-time tick streaming from binary session files
- Custom aggregation logic for different timeframes (1s, 5s, 10s, 60s)
- Marker support for trade execution visualization
- Complex state management with refs

**Data Flow:**
```
Binary Session Files (.bin.gz)
    ↓
api.loadSessionData() → Decompresses & Parses
    ↓
useTickPlayer → Streams ticks at 100ms intervals
    ↓
handleTick() → Updates sessionData.quote
    ↓
ChartArea.jsx → Aggregates & displays on chart
```

**Key Features:**
1. **Replay Mode**: Fixed-rate tick streaming (10 ticks/sec)
2. **Multi-Series**: Bid/Ask/Mid lines + Candlesticks + EMAs
3. **Dynamic Timeframes**: 1s, 5s, 10s, 60s aggregation
4. **Preview Mode**: Shows full session before playback
5. **Trade Markers**: Buy/sell execution visualization
6. **NBBO Data**: Multi-exchange Level 2 data

---

## OakView Capabilities

### What OakView Provides ✅

1. **Web Component Wrapper**
   - Easy `<oakview-chart>` HTML element
   - Framework agnostic
   - Auto-resize handling
   - Theme support (light/dark)

2. **API Methods**
   ```javascript
   - addCandlestickSeries(data, options)
   - addLineSeries(data, options)
   - addAreaSeries(data, options)
   - addBarSeries(data, options)
   - addHistogramSeries(data, options)
   - clearSeries()
   - fitContent()
   - getChart() // Access underlying lightweight-charts
   - applyOptions(options)
   ```

3. **Data Provider Interface**
   ```javascript
   class OakViewDataProvider {
     async initialize(config)
     async fetchHistorical(symbol, interval, from, to)
     subscribe(symbol, interval, callback)
     unsubscribe(subscriptionId)
     async searchSymbols(query)
     disconnect()
   }
   ```

### What OakView Lacks ❌

1. **No Built-in Replay Mode**
   - Data provider focused on live/historical market data
   - No concept of fixed-rate tick playback
   - No virtual timeline management

2. **No Multi-Series Management**
   - Methods create single series at a time
   - No built-in support for managing multiple related series (bid/ask/mid)
   - Would need custom wrapper

3. **No Aggregation Logic**
   - No timeframe aggregation (1s, 5s, 10s, 60s)
   - Would need custom implementation

4. **No Preview/Playback State**
   - No distinction between preview and live playback
   - Would need custom state management

5. **No Trade Marker Management**
   - Basic marker support via lightweight-charts API
   - No high-level trade marker API

---

## Integration Analysis

### Scenario 1: Direct Replacement (❌ **NOT RECOMMENDED**)

**Effort**: Very High  
**Benefits**: Minimal

Replacing `ChartArea.jsx` with `<oakview-chart>` would require:

1. ❌ Lose all custom aggregation logic
2. ❌ Rebuild multi-series management
3. ❌ Recreate timeframe switching
4. ❌ Reimplement preview mode
5. ❌ Lose EMA indicator integration
6. ❌ Rebuild trade marker system

**Conclusion**: This would be a step backward. Current implementation is more sophisticated than what OakView provides out-of-the-box.

---

### Scenario 2: Use OakView's Data Provider Interface (⚠️ **POSSIBLE BUT LIMITED**)

**Effort**: Medium-High  
**Benefits**: Moderate

Create a custom `ReplayDataProvider extends OakViewDataProvider`:

```javascript
class ReplaySessionDataProvider extends OakViewDataProvider {
  constructor() {
    super();
    this.currentSession = null;
    this.tickPlayer = null;
  }

  async initialize(config) {
    const { sessionId, api } = config;
    this.currentSession = sessionId;
    // Load session data
    this.sessionData = await api.loadSessionData(sessionId);
  }

  async fetchHistorical(symbol, interval, from, to) {
    // Return entire session as OHLCV data
    // Problem: Need to aggregate ticks to OHLCV format
    // Problem: No concept of "intervals" in session data
    return aggregateToOHLCV(this.sessionData, interval);
  }

  subscribe(symbol, interval, callback) {
    // Problem: subscribe() expects real-time data, not replay
    // Would need to hack it to emit ticks at fixed rate
    this.tickPlayer = setInterval(() => {
      const tick = this.getNextTick();
      callback(convertTickToOHLCV(tick, interval));
    }, 100);

    return () => clearInterval(this.tickPlayer);
  }
}
```

**Issues**:
1. Data provider API expects OHLCV bars, not individual ticks
2. `subscribe()` callback fires once per bar, not per tick
3. No support for multi-series (bid/ask/mid simultaneously)
4. Interval concept doesn't match session replay (need tick-by-tick)
5. Preview mode not part of data provider interface

**Conclusion**: The data provider interface is designed for market data APIs (Polygon, Alpha Vantage, etc.), not session replay. It's a poor fit.

---

### Scenario 3: Use OakView Chart + Custom Management (⚙️ **WORKABLE**)

**Effort**: Medium  
**Benefits**: Moderate

Use OakView as just a chart wrapper, bypass the data provider:

```javascript
function ReplayChart({ sessionData, timeframe }) {
  const chartRef = useRef(null);
  
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    
    // Get underlying lightweight-charts instance
    const lwChart = chart.getChart();
    
    // Create series directly
    const bidSeries = lwChart.addLineSeries({ color: '#26a69a' });
    const askSeries = lwChart.addLineSeries({ color: '#ef5350' });
    const midSeries = lwChart.addLineSeries({ color: '#2962ff' });
    
    // Custom tick management
    // ... same as current implementation ...
  }, []);
  
  return <oakview-chart ref={chartRef} theme="dark" />;
}
```

**Benefits**:
✅ Encapsulated chart component  
✅ Auto-resize handling  
✅ Theme support  
✅ Access to full lightweight-charts API via `getChart()`

**Drawbacks**:
❌ Still need all custom logic (aggregation, timeframes, markers)  
❌ Minimal value over current direct lightweight-charts usage  
❌ Extra layer of abstraction  
❌ React ref handling complexity

**Conclusion**: Provides marginal benefits. Current implementation already handles chart creation and configuration well.

---

## Data Provider Assessment

### Required Functionality for Momentum Stock Replay

| Feature | Required | OakView Provider | Custom Implementation Needed |
|---------|----------|------------------|------------------------------|
| Load binary session files | ✅ Yes | ❌ No | ✅ **api.loadSessionData()** |
| Decompress .bin.gz files | ✅ Yes | ❌ No | ✅ **pako.inflate()** |
| Parse binary V3 format | ✅ Yes | ❌ No | ✅ **parseBinaryDataV3()** |
| Stream ticks at fixed rate | ✅ Yes | ❌ No | ✅ **useTickPlayer** |
| Virtual timeline | ✅ Yes | ❌ No | ✅ **virtualTimeRef** |
| Multi-series (bid/ask/mid) | ✅ Yes | ❌ No | ✅ **Custom** |
| Timeframe aggregation | ✅ Yes | ❌ No | ✅ **aggregateLineData()** |
| Preview mode | ✅ Yes | ❌ No | ✅ **previewData** |
| Trade markers | ✅ Yes | ⚠️ Partial | ✅ **markersRef** |
| EMA indicators | ✅ Yes | ❌ No | ✅ **calculateEMAs()** |
| Multi-exchange data | ✅ Yes | ❌ No | ✅ **quote.exchanges** |

**Compatibility Score**: **10% - Almost nothing matches**

### What Would Need to Be Built

If using OakView's data provider interface:

1. **Binary Session Loader**
   ```javascript
   class SessionFileDataProvider extends OakViewDataProvider {
     async fetchHistorical(symbol, interval, from, to) {
       // Load from sessions/SYMBOL-DATE.bin.gz
       // Decompress with pako
       // Parse binary format
       // Aggregate to OHLCV bars
     }
   }
   ```

2. **Replay Streamer**
   ```javascript
   subscribe(symbol, interval, callback) {
     // Stream ticks at 100ms intervals
     // Convert ticks to OHLCV bars
     // Handle virtual timeline
   }
   ```

3. **Multi-Series Coordinator**
   ```javascript
   // Manage bid/ask/mid series
   // Sync updates across series
   // Handle timeframe changes
   ```

4. **Preview Handler**
   ```javascript
   // Load full session for preview
   // Display on chart before playback
   // Clear on playback start
   ```

**Estimated Effort**: 5-7 days of development

**Conclusion**: Building a custom data provider would essentially recreate 80% of the current implementation with extra complexity.

---

## Recommendations

###1. **Keep Current Implementation** ✅ **RECOMMENDED**

**Rationale:**
- Current implementation is mature and functional
- Perfectly tailored to session replay requirements
- OakView provides minimal value for this use case
- Adding OakView would increase complexity without significant benefits

**When to Revisit:**
- If you need to add live market data streaming (not replay)
- If you expand to multiple chart types across different projects
- If OakView adds replay-specific features

---

### 2. **Possible Hybrid Approach** ⚙️ **FUTURE CONSIDERATION**

If you want some OakView benefits:

**Option A: Extract Common Chart Config**
```javascript
// shared-chart-config.js (can be in OakView or separate)
export const TRADING_VIEW_THEME = {
  layout: {
    background: { color: "#131722" },
    textColor: "#787B86"
  },
  grid: {
    vertLines: { color: "#1E222D" },
    horzLines: { color: "#1E222D" }
  },
  // ... rest of config
};

// Use in momentum-stock-replay
import { TRADING_VIEW_THEME } from '@shared/chart-config';
const chart = createChart(container, TRADING_VIEW_THEME);
```

**Option B: OakView for Static Charts Only**

Use OakView for:
- Documentation/help pages
- Session summaries
- Historical analysis views

Keep current implementation for:
- Live replay playback
- Interactive trading

---

## Conclusion

**OakView Integration Score**: **2/10**

### Why Low Score:

1. ❌ **Data Provider Mismatch**: Designed for market data APIs, not session replay
2. ❌ **Missing Core Features**: No replay mode, aggregation, multi-series management
3. ❌ **Adds Complexity**: Extra abstraction layer without clear benefits
4. ❌ **Requires Extensive Customization**: Would need to build 80% of current functionality anyway
5. ✅ **Only Benefit**: Minor conveniences (Web Component, auto-resize, theming)

### Final Recommendation:

**Do NOT integrate OakView into momentum-stock-replay at this time.**

The current direct use of `lightweight-charts` is the correct approach. The project has unique requirements (binary session replay, fixed-rate streaming, virtual timeline) that don't align with OakView's market-data-focused design.

**Better Investment**: 
- Continue refining the current implementation
- Consider extracting reusable utilities (aggregation, EMAs) into a separate library
- If OakView evolves to support replay scenarios, reassess

---

## Alternative: Enhance OakView for Replay Use Cases

If you want to make OakView useful for this project, consider adding to OakView:

### Proposed OakView Enhancements

1. **Replay Data Provider Base Class**
   ```javascript
   class OakViewReplayProvider extends OakViewDataProvider {
     async loadSession(sessionId)
     startReplay(options)
     pauseReplay()
     resumeReplay()
     stopReplay()
     setSpeed(multiplier)
   }
   ```

2. **Multi-Series Support**
   ```javascript
   chart.addMultiLineSeries({
     bid: { color: '#26a69a' },
     ask: { color: '#ef5350' },
     mid: { color: '#2962ff' }
   });
   ```

3. **Timeframe Aggregation**
   ```javascript
   chart.setAggregation({
     interval: 5, // seconds
     method: 'last' // or 'ohlc'
   });
   ```

**Estimated Effort**: 2-3 weeks of development

**Benefit**: Would make OakView genuinely useful for replay scenarios across multiple projects.

---

*Assessment Date: 2025-11-19*  
*Momentum Stock Replay Version: Current*  
*OakView Version: 1.0.0*
