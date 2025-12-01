# @momentum/replay-engine

Framework-agnostic replay engine for tick-by-tick market data. Designed to be used in Momentum Stock Replay and potentially extracted to OakView in the future.

## Features

- 📊 **Tick-by-tick replay** - Process market data at configurable speeds
- 📈 **OHLCV bar aggregation** - Automatically aggregate ticks into candlestick bars
- ⚡ **Variable speed playback** - Support for 1x to 100x playback speeds
- 🎯 **Precise navigation** - Seek to specific timestamps or percentages
- 📡 **Event-driven architecture** - Subscribe to tick, bar, and state change events
- 🌐 **Universal compatibility** - Works in both browser and Node.js environments
- 📦 **Zero runtime dependencies** - Lightweight and self-contained

## Installation

```bash
npm install @momentum/replay-engine
```

## Quick Start

```typescript
import { ReplayEngine } from '@momentum/replay-engine';
import type { TickData } from '@momentum/replay-engine';

// Create the engine
const engine = new ReplayEngine();

// Sample tick data
const ticks: TickData[] = [
  { timestamp: 1704067200, price: 100.00, volume: 500 },
  { timestamp: 1704067201, price: 100.05, volume: 200 },
  { timestamp: 1704067202, price: 99.95, volume: 300 },
  // ... more ticks
];

// Load data and configure
engine.load(ticks, {
  updateInterval: 100,      // Update every 100ms
  barInterval: 60,          // 1-minute bars
  availableSpeeds: [1, 2, 5, 10, 25, 50, 100],
});

// Subscribe to events
engine.on('tick', (tick, state) => {
  console.log(`Tick: ${tick.price} at ${tick.timestamp}`);
});

engine.on('bar', (bar, state) => {
  console.log(`Bar completed: O:${bar.open} H:${bar.high} L:${bar.low} C:${bar.close}`);
});

engine.on('stateChange', (state) => {
  console.log(`State: ${state.status}, Time: ${state.currentTime}`);
});

engine.on('ended', () => {
  console.log('Replay ended');
});

// Start playback
engine.play();

// Control playback
engine.pause();
engine.setSpeed(10);
engine.play();

// Navigate
engine.seekTo(1704067260);  // Seek to specific timestamp
engine.seekToPercent(50);   // Seek to 50% of duration
engine.stepForward(5);      // Step forward 5 bars
engine.stepBackward(2);     // Step backward 2 bars

// Get current state
const state = engine.getState();
console.log(state.status);      // 'idle' | 'playing' | 'paused' | 'ended'
console.log(state.currentTime); // Current replay timestamp
console.log(state.speed);       // Current playback speed

// Get bar data
const currentBar = engine.getCurrentBar();
const allBars = engine.getBarsUntil(state.currentTime);

// Clean up
engine.dispose();
```

## API Reference

### ReplayEngine

The main class for replaying tick data.

#### Constructor

```typescript
const engine = new ReplayEngine();
```

#### Methods

##### Lifecycle

| Method | Description |
|--------|-------------|
| `load(ticks, options?)` | Load tick data and initialize the engine |
| `dispose()` | Clean up and release all resources |

##### Playback Controls

| Method | Description |
|--------|-------------|
| `play()` | Start or resume playback |
| `pause()` | Pause playback, keeping current position |
| `stop()` | Stop playback and reset to start |

##### Navigation

| Method | Description |
|--------|-------------|
| `seekTo(timestamp)` | Seek to a specific timestamp |
| `seekToPercent(percent)` | Seek to a percentage of total duration (0-100) |
| `stepForward(bars?)` | Step forward by N bars (default: 1) |
| `stepBackward(bars?)` | Step backward by N bars (default: 1) |

##### Speed Control

| Method | Description |
|--------|-------------|
| `setSpeed(speed)` | Set playback speed (snaps to nearest available) |
| `getAvailableSpeeds()` | Get array of available playback speeds |

##### State

| Method | Description |
|--------|-------------|
| `getState()` | Get current replay state |
| `getCurrentBar()` | Get the current (potentially incomplete) bar |
| `getBarsUntil(timestamp)` | Get all bars up to a specific timestamp |

##### Events

| Method | Description |
|--------|-------------|
| `on(event, handler)` | Subscribe to an event (returns unsubscribe function) |
| `off(event, handler)` | Unsubscribe from an event |

### TickAggregator

Standalone class for aggregating ticks into OHLCV bars.

```typescript
import { TickAggregator } from '@momentum/replay-engine';

const aggregator = new TickAggregator(60); // 1-minute bars

aggregator.addTick({ timestamp: 1000, price: 100, volume: 500 });
aggregator.addTick({ timestamp: 1010, price: 101, volume: 200 });

const currentBar = aggregator.getCurrentBar();
const allBars = aggregator.getAllBars();
const specificBar = aggregator.getBar(960);

aggregator.reset();
aggregator.setInterval(300); // Change to 5-minute bars
```

### EventEmitter

A simple typed event emitter used internally.

```typescript
import { EventEmitter } from '@momentum/replay-engine';

interface MyEvents {
  'data': (value: number) => void;
  'error': (error: Error) => void;
}

const emitter = new EventEmitter<MyEvents>();

const unsubscribe = emitter.on('data', (value) => console.log(value));
emitter.emit('data', 42);
unsubscribe();
```

## Types

### TickData

```typescript
interface TickData {
  timestamp: number;  // Unix seconds (supports ms precision as decimals)
  price: number;
  volume?: number;
  side?: 'bid' | 'ask' | 'trade';
  metadata?: Record<string, unknown>;
}
```

### ReplayableBar

```typescript
interface ReplayableBar {
  time: number;      // Bar start time in Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}
```

### ReplayState

```typescript
interface ReplayState {
  status: 'idle' | 'playing' | 'paused' | 'ended';
  currentTime: number;  // Unix seconds
  speed: number;
  startTime: number;    // Unix seconds
  endTime: number;      // Unix seconds
}
```

### ReplayOptions

```typescript
interface ReplayOptions {
  updateInterval?: number;           // ms between updates (default: 100)
  availableSpeeds?: number[];        // default: [1, 2, 5, 10, 25, 50, 100]
  barInterval?: number;              // seconds per bar (default: 60)
  onTick?: (tick: TickData, state: ReplayState) => void;
  onBar?: (bar: ReplayableBar, state: ReplayState) => void;
  onStateChange?: (state: ReplayState) => void;
}
```

### ReplayEvents

```typescript
interface ReplayEvents {
  'tick': (tick: TickData, state: ReplayState) => void;
  'bar': (bar: ReplayableBar, state: ReplayState) => void;
  'stateChange': (state: ReplayState) => void;
  'ended': () => void;
  'error': (error: Error) => void;
}
```

## Building

```bash
npm run build
```

## Testing

```bash
npm test
npm run test:coverage
```

## License

MIT
