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

## License

See LICENSE file for details.

## Disclaimer

This tool is for educational and research purposes only. It is not financial advice. Past performance does not guarantee future results. Always do your own research before making trading decisions.

## Support

- **Issues**: Report bugs or request features via GitHub Issues
- **Databento**: See [Databento Documentation](https://docs.databento.com)
- **React/Vite**: See official documentation for framework questions
