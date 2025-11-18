# Momentum Stock Replay

Interactive web application for replaying and analyzing high-momentum stock price action with tick-by-tick precision.

🚀 **[Try the Live Demo](https://deepentropy.github.io/momentum-stock-replay/)**

## Overview

Momentum Stock Replay is a real-time market replay tool that allows you to:
- 📊 **Replay tick-by-tick price action** of high-momentum stocks
- 📈 **Visualize NBBO** (National Best Bid and Offer) from multiple exchanges
- 🔍 **Analyze order book dynamics** at 100ms granularity
- ⚡ **Study momentum moves** with precise execution timing
- 📉 **Review multi-exchange data** (NASDAQ, NYSE, IEX, and more)

Perfect for day traders, researchers, and anyone studying intraday momentum patterns on small-cap stocks with significant run-ups (>30%).

## Features

### Interactive Replay
- **Tick-by-tick playback** with variable speed control (1x - 100x)
- **Time scrubbing** to jump to any point in the session
- **Play/pause controls** for detailed analysis
- **Live NBBO updates** showing best bid/ask across all exchanges

### Advanced Visualization
- **Candlestick charts** with customizable timeframes (1s - 5m)
- **Volume profile** with exchange breakdown
- **Order book depth** visualization
- **Price markers** and annotations
- **Multi-exchange data** with publisher identification

### Analysis Tools
- **NBBO spread tracking**
- **Exchange activity breakdown**
- **Volume analysis** by time and exchange
- **Price level statistics**
- **Session summary** with key metrics

## Quick Start

### Running the App

```bash
# Navigate to app directory
cd app

# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:5173 in your browser
```

### Loading Session Data

The app loads pre-compressed session files from the `sessions/` directory:

1. **Browse available sessions** using the session picker
2. **Select a stock/date** to load
3. **Start replaying** with the play button
4. **Adjust playback speed** (1x - 100x)
5. **Scrub through time** using the timeline slider

Session files contain pre-processed market data.

## Project Structure

```
momentum-stock-replay/
├── app/                        # React web application
│   ├── src/
│   │   ├── components/        # UI components
│   │   │   ├── CenterPanel.jsx       # Main chart area
│   │   │   ├── OrderBookPanel.jsx    # Order book display
│   │   │   ├── SettingsPanel.jsx     # Configuration
│   │   │   ├── SessionPicker.jsx     # Session selector
│   │   │   └── ...
│   │   ├── contexts/          # React contexts
│   │   ├── hooks/             # Custom hooks
│   │   ├── utils/             # Utilities
│   │   │   ├── binaryReader.js       # Binary decompressor
│   │   │   └── chartHelpers.js       # Chart utilities
│   │   └── App.jsx            # Main app component
│   ├── public/                # Static assets
│   ├── index.html
│   └── package.json
│
└── sessions/                   # Compressed binary sessions
    ├── SYMB-20251114.bin.gz
    └── ...
```

## Data Format

### Binary Session Format (Version 3)

Sessions are stored in a custom binary format optimized for replay:

**Header:**
- Magic bytes: `TICK`
- Version: `3`
- Resample interval: `100ms`
- Number of samples
- Initial timestamp (microseconds)
- Publisher map (exchange IDs)

**Per Sample (every 100ms):**
- **NBBO Data:**
  - Best bid/ask prices (scaled to 5 decimals)
  - Best bid/ask sizes
  - Best bid/ask exchange IDs
- **Exchange Snapshots:**
  - Individual bid/ask per exchange
  - Sizes per exchange

All data is gzip-compressed for efficient storage and transmission.

## Data Fetching

### Fetching Individual Sessions

Use the standalone `fetch_mbp1_symbol.py` script to fetch MBP-1 data for specific symbols and time ranges:

```bash
# Fetch a full trading day
python fetch_mbp1_symbol.py AAPL 2025-01-15 2025-01-16

# Fetch a specific time range
python fetch_mbp1_symbol.py AAPL "2025-01-15 09:30:00" "2025-01-15 16:00:00"

# Use a single exchange instead of multi-exchange
python fetch_mbp1_symbol.py TSLA 2025-01-15 2025-01-16 --single-exchange --dataset XNYS.PILLAR
```

The script will:
1. Fetch MBP-1 tick data from Databento (multi-exchange by default)
2. Resample to NBBO at 100ms intervals
3. Compress to binary format
4. Save to `sessions/SYMBOL-YYYYMMDD.bin.gz`

**Requirements:**
- Set `DATABENTO_API_KEY` environment variable
- Install dependencies: `pip install pandas numpy databento`

### Processing Multiple Sessions

Use `script/get_sessions.py` to process all missing sessions from `sessions/sessions.csv`:

```bash
python script/get_sessions.py
```

The CSV format:
```csv
symbol, date, start_time, end_time
AMIX, 2025-11-17, 13:03:00, 15:15:00
GLMD, 2025-11-17, 13:30:00, 14:30:00
```

The script will:
1. Read all sessions from `sessions/sessions.csv`
2. Check for existing binary files (assumes one session per symbol per day)
3. Fetch missing sessions automatically
4. Show progress and summary

### Supported Exchanges

- **NASDAQ** (XNAS.ITCH)
- **NYSE** (XNYS.PILLAR)
- **IEX** (IEXG.TOPS)
- **NYSE Arca** (ARCX.PILLAR)
- **Cboe BZX** (BATS.PITCH)
- **NASDAQ BX** (XBOS.ITCH)
- **NASDAQ PSX** (XPSX.ITCH)

## Technology Stack

### Frontend (React App)
- **React 19** - UI framework
- **Vite** - Build tool and dev server
- **TailwindCSS 4** - Styling
- **Lightweight Charts** - TradingView-style charts
- **Pako** - Gzip decompression in browser
- **@deepentropy/oakscriptjs** - Custom indicators

## Use Cases

### Day Trading Analysis
- Study past momentum moves
- Identify entry/exit patterns
- Analyze order flow dynamics
- Review execution timing

### Research
- Market microstructure analysis
- Exchange competition studies
- NBBO formation patterns
- Volume profile research

### Education
- Learn price action patterns
- Understand order book mechanics
- Study momentum trading setups
- Practice trade timing

## Performance

- **Compression ratio**: ~10-20x (raw parquet → binary gzip)
- **Loading speed**: ~100-500ms for typical session
- **Replay performance**: Smooth playback up to 100x speed
- **Memory usage**: ~10-50MB per session in browser

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Development Roadmap

- [ ] Add annotation tools
- [ ] Export replay videos
- [ ] Multi-symbol comparison
- [ ] Custom indicator support
- [ ] Strategy backtesting
- [ ] Order execution simulator

## License

See LICENSE file for details.

## Disclaimer

This tool is for educational and research purposes only. It is not financial advice. Past performance does not guarantee future results. Always do your own research before making trading decisions.

## Support

- **Issues**: Report bugs or request features via GitHub Issues
- **Databento**: See [Databento Documentation](https://docs.databento.com)
- **React/Vite**: See official documentation for framework questions
