# GitHub Copilot Instructions - Momentum Stock Replay

**Last Updated:** 2025-11-20  
**Project:** Momentum Stock Replay - Stock replay training application with chart and order book display

---

## Project Context

**Purpose:** Training platform for replaying historical stock tick data with interactive charts and order book visualization.

**Data Pipeline:**
1. **Databento** → Raw market data (thousands of ticks per second)
2. **Python Script** → Resamples to 100ms intervals for manageable file sizes
3. **Binary Files** → Compressed `.bin.gz` format (100ms resolution)
4. **Provider** → Aggregates 100ms ticks to any interval (1s, 5s, 1m, etc.)
5. **OakView** → Resamples to user-selected timeframe (1m, 5m, 1H, 1D)

**Architecture:**
- **Frontend:** React (Vite) - `app/` directory
- **Chart Library:** OakView (external, read-only) - `C:\Users\otrem\PycharmProjects\oakview`
- **Order Book:** Custom implementation (internal)
- **Data Format:** Binary compressed session files (`.bin.gz`) containing 100ms tick data

**Your Role:** Primary maintainer responsible for OakView integration and feature implementation. Feature approval by Odyssée.

---

## Critical Rules

### 1. OakView Integration
- **READ ONLY:** You can read OakView source files at `C:\Users\otrem\PycharmProjects\oakview`
- **NO MODIFICATIONS:** Never modify OakView code/files
- **Documentation Location:** `C:\Users\otrem\PycharmProjects\oakview/docs/`
- **Integration Pattern:** Follow OakView's recommended patterns from their documentation
- **Issue Reporting:** If OakView has bugs, document them for the OakView dev team (they are also LLMs)

### 2. File Management
- **Temporary Files:** All temporary/analysis files go in `.tmp/` directory
- **Keep Clean:** Remove outdated files from `.tmp/` between sessions
- **No Root Clutter:** Don't create analysis/planning markdown files in project root
- **Allowed in Root:** Only permanent documentation that serves the project long-term

### 3. Communication Style
- **Target Audience:** Other LLMs (not humans)
- **Be Precise:** Use exact file paths, line numbers, function names
- **Code Examples:** Always include complete, working code snippets
- **No Fluff:** Skip pleasantries, focus on technical details
- **Format:** Use structured markdown with clear sections

---

## OakView Integration Pattern (CRITICAL)

**Always use OakView's recommended pattern:**

```javascript
// 1. Fetch historical bars
const historicalBars = await provider.fetchHistorical(sessionId, interval);

// 2. Set via OakView API (stores in internal _data for chart type changes)
chartElement.setData(historicalBars);

// 3. Subscribe for real-time updates
const unsubscribe = provider.subscribe(sessionId, interval, (bar) => {
  chartElement.updateRealtime(bar);  // Updates current series
});

// 4. Cleanup
return () => unsubscribe();
```

**DO NOT:**
- Manually create series via `chart.getChart().addSeries()`
- Bypass OakView's `setData()` method
- Store extra fields in bar objects (only: `time`, `open`, `high`, `low`, `close`)

**WHY:** OakView's chart type toolbar rebuilds series from `_data` when user changes type. Manual series creation bypasses this.

---

## Data Provider Requirements

**Bar Format (STRICT):**
```javascript
{
  time: number,    // Unix timestamp in SECONDS (not milliseconds)
  open: number,    // Numeric price
  high: number,
  low: number,
  close: number
  // NO extra fields allowed - will break updateRealtime()
}
```

**Interval Format for Display/Selection:** `^(\d+)([mHDWMY]?)$`
- `1`, `5`, `15`, `30` = minutes
- `1H`, `4H` = hours  
- `1D` = days
- **NOTE:** Seconds/milliseconds not supported in UI selector format

**Data Resolution:**
- **Source Data:** 100ms tick intervals from Databento (resampled from raw ticks)
- **OakView Capability:** Accepts any interval - resamples internally to higher timeframes
- **Provider Returns:** Bars at any interval via `aggregateToOHLCV()`
- **User Selection:** Via OakView UI (1min, 5min, 1H, 1D, etc.)

**Example Flow:**
```
Databento raw ticks (thousands/sec)
  ↓ Python script resamples
100ms ticks (saved to .bin.gz)
  ↓ Provider aggregateToOHLCV()
1-second bars (or any interval requested)
  ↓ OakView internal resampling
User-selected timeframe (1min, 5min, etc.)
```

**Symbol Format:**
```javascript
{
  symbol: "SYMBOL-DATE",           // e.g., "OLMA-20251118"
  full_name: "SYMBOL-DATE",        // Same as symbol
  description: "SYMBOL • DATE",    // e.g., "OLMA • 2025-11-18"
  exchange: "REPLAY",
  type: "stock"
}
```

---

## Common Errors & Solutions

### "Cannot update oldest data"
- **Cause:** Bar object has extra fields or time format issue
- **Fix:** Return only `{time, open, high, low, close}` from all methods
- **Check:** Time is Unix seconds (not milliseconds)

### "Unknown interval format"
- **Cause:** Using unsupported format in `getBaseInterval()` like `'100ms'` or `'60s'`
- **Fix:** Return `'1'` (1 minute) from `getBaseInterval()` - OakView UI selector expects this format
- **Note:** Provider can aggregate at any resolution, but UI selector uses standard format

### "sessionId is required"
- **Cause:** `initialize()` called with string instead of config object
- **Fix:** `await provider.initialize({ sessionId: symbol })`

### Chart Type Toolbar Not Working
- **Cause:** Manual series creation bypassing OakView's `_data`
- **Fix:** Use `setData()` + `updateRealtime()` pattern above

---

## File Structure

```
app/src/
├── components/
│   ├── ChartContainer.jsx           # OakView integration (MODIFY)
│   ├── ControlsBar.jsx              # Playback controls (MODIFY)
│   └── OrderBookPanel.jsx           # Order book display (MODIFY)
├── providers/
│   └── ReplaySessionDataProvider.js # Data provider (MODIFY)
└── utils/
    └── api.js                       # Binary file parser (MODIFY)

app/node_modules/oakview/            # Chart library (READ ONLY)
.tmp/                                # Temporary files (KEEP CLEAN)
```

---

## Testing Checklist

After any change:
1. ✅ Symbol search loads sessions
2. ✅ Chart displays historical data
3. ✅ Play button starts updates
4. ✅ Chart type toolbar works (Candles/Line/Bars)
5. ✅ No console errors
6. ✅ Speed control functions

---

## Session Handoff

**End of Session:**
1. Clean `.tmp/` directory
2. Update this file if patterns changed
3. Document incomplete work in `.tmp/session-handoff.md`

**Start of Session:**
1. Read this file completely
2. Check `.tmp/session-handoff.md`
3. Review recent commits

---

## Remember

1. **OakView = READ ONLY**
2. **Use `.tmp/` for temporary files**
3. **Bar format: only OHLCV fields**
4. **Time in seconds, not milliseconds**
5. **Write for LLMs, not humans**
6. **Follow OakView patterns exactly**

