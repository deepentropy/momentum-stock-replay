# OakView Integration Progress

## Branch: `feature/oakview-integration`

Created: 2025-11-19

---

## ✅ Phase 1: Core Provider & Chart Wrapper (COMPLETE)

### Created Files:

1. **`app/src/providers/ReplaySessionDataProvider.js`** (~350 lines)
   - Extends `OakViewDataProvider` base class
   - Implements session replay-specific logic:
     - `initialize(config)` - Loads binary session files
     - `fetchHistorical()` - Returns OHLCV bars for preview
     - `subscribe()` - Tick streaming subscription
     - `startStreaming()` - Begin playback at 100ms/tick
     - `pause()` / `resume()` - Playback control
     - `setSpeed()` - Speed adjustment (0.5x, 1x, 2x, etc.)
     - `getProgress()` - Progress percentage
     - `getVirtualTime()` - Virtual timeline for clock
   - Reuses existing `api.loadSessionData()` infrastructure
   - Handles tick-to-OHLCV aggregation

2. **`app/src/components/ChartContainer.jsx`** (~150 lines)
   - React wrapper for OakView chart
   - Dynamically loads `oakview` library
   - Creates Web Component: `<oakview-chart>`
   - Integrates with ReplaySessionDataProvider
   - Creates multiple series (candlestick, bid, ask, mid)
   - Preview mode support

3. **Dependencies**
   - Installed `oakview` as local dependency from `../oakview`
   - Links to lightweight-charts and oakscriptjs

---

## 🔄 Phase 2: Integration with Existing UI (IN PROGRESS)

### Tasks Remaining:

- [ ] **Update CenterPanel.jsx**
  - Replace ChartArea import with ChartContainer
  - Pass session and data props
  - Keep feature flag for gradual rollout

- [ ] **Update ControlsBar.jsx**
  - Wire play/pause/stop to `provider.startStreaming()` / `pause()` / `reset()`
  - Wire speed control to `provider.setSpeed()`
  - Use `provider.getProgress()` for progress bar
  - Use `provider.getVirtualTime()` for clock display

- [ ] **Session Data Flow**
  - Handle tick updates from provider
  - Update sessionData.quote state
  - Pass tick data to OrderBookPanel

- [ ] **Trade Markers**
  - Migrate marker functionality to OakView series
  - Use `series.setMarkers()` API

---

## 🎯 Phase 3: Feature Parity (TODO)

- [ ] **Indicators**
  - Migrate EMA calculations to OakView indicator system
  - Use oakscriptjs for ta.ema()
  - Add indicator legends

- [ ] **Timeframe Aggregation**
  - Implement dynamic timeframe switching
  - Re-aggregate data on timeframe change

- [ ] **Chart Type Switching**
  - Support candlestick vs line chart toggle
  - Show/hide bid/ask/mid series

- [ ] **Testing**
  - Test all sessions load correctly
  - Test playback controls work
  - Test markers appear correctly
  - Test speed changes work smoothly

---

## 📊 Code Impact Analysis

### Files to Modify:
- `app/src/components/CenterPanel.jsx` - Switch chart component
- `app/src/components/ControlsBar.jsx` - Wire to provider
- `app/src/components/OrderBookPanel.jsx` - Minimal/no changes needed

### Files to Eventually Remove:
- `app/src/components/ChartArea.jsx` (~530 lines) - **Keep during migration**
- `app/src/hooks/useTickPlayer.js` - **Logic moved to provider**

### Net Code Change:
- **Added**: ~500 lines (Provider + Container)
- **Will Remove**: ~530 lines (ChartArea)
- **Net**: -30 lines, but better organized

---

## 🧪 Testing Strategy

### Phase 2 Testing (Current):
1. **Parallel Mode**
   - Add feature flag: `USE_OAKVIEW_CHART`
   - Keep both ChartArea and ChartContainer
   - Toggle between implementations
   - Compare behavior side-by-side

2. **Integration Tests**
   - Load session → verify preview displays
   - Click play → verify ticks stream
   - Pause/resume → verify works correctly
   - Speed change → verify playback speed updates
   - Trade execution → verify markers appear

### Phase 3 Testing:
1. **Feature Parity**
   - All existing features work in OakView version
   - No regressions
   - Performance is comparable or better

2. **Cleanup**
   - Remove feature flag
   - Delete ChartArea.jsx
   - Update documentation

---

## 📝 Next Steps

### Immediate (Phase 2):

1. **Add Feature Flag**
   ```jsx
   // app/src/config.js
   export const USE_OAKVIEW_CHART = true; // Toggle for testing
   ```

2. **Update CenterPanel**
   ```jsx
   import ChartArea from './ChartArea';
   import ChartContainer from './ChartContainer';
   import { USE_OAKVIEW_CHART } from '../config';

   const Chart = USE_OAKVIEW_CHART ? ChartContainer : ChartArea;

   return <Chart ref={chartRef} currentSession={currentSession} ... />;
   ```

3. **Wire Controls**
   - Connect ControlsBar play button to `provider.startStreaming()`
   - Connect pause/resume
   - Connect speed dropdown to `provider.setSpeed()`
   - Connect stop to `provider.reset()`

4. **Test Basic Flow**
   - Load OLMA session
   - Click play
   - Verify chart updates
   - Verify timer updates with virtual time

---

## 🐛 Known Issues / TODOs

- [ ] Chart not yet responsive to window resize (OakView handles this)
- [ ] Virtual time display needs to be wired to ControlsBar
- [ ] Trade markers not yet implemented
- [ ] Indicator system not yet integrated
- [ ] Timeframe switching not yet implemented
- [ ] Need to handle sessionData.quote updates for OrderBookPanel

---

## 📚 Resources

- **OakView Docs**: `../oakview/README.md`
- **OakView Data Provider**: `../oakview/src/data-providers/base.js`
- **Assessment**: `OAKVIEW_INTEGRATION_ASSESSMENT.md`
- **Branch**: `feature/oakview-integration`

---

**Last Updated**: 2025-11-19
**Status**: Phase 1 Complete, Phase 2 In Progress
