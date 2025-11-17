# Momentum Stock Replay System

Automated pipeline to identify and analyze high-momentum stocks with significant intraday run-ups.

## Overview

This system:
1. **Fetches** fundamental data from private GitHub repository
2. **Filters** stocks by float, market cap, and price criteria (7,046 → 1,799 stocks)
3. **Downloads** 1-hour OHLCV data for all filtered stocks (batch mode)
4. **Analyzes** run-ups from premarket open to day's high (>30% filter)
5. **Fetches** MBP-1 tick data for stocks with >30% run-up (~21 stocks)
6. **Compresses** MBP-1 data to binary format (sessions/)
7. **Generates** comprehensive summary (summary/)

## Complete Workflow

```
Fundamentals (7,046 stocks)
    ↓ Filter: Float <100M, MCap <$300M, Price $1-$50
Filtered (1,799 stocks)
    ↓ Download 1h OHLCV data (batch)
1h Data Analysis
    ↓ Calculate run-up from premarket to day high
Run-up Analysis (stocks >30%)
    ↓ Download MBP-1 tick data (batch)
MBP-1 Data (parquet)
    ↓ Compress to binary format
Compressed Sessions (.bin.gz)
    ↓ Generate summary
Summary & Ready for Analysis
```

## Setup

### 1. Environment Variables

```powershell
# GitHub token for private fundamentals repository
$env:STOCKFUNDAMENTALS_PAT="ghp_your_token_here"

# Databento API key
$env:DATABENTO_API_KEY="db-your_key_here"
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

## Architecture

### Unified, Modular Design

The pipeline has been refactored from multiple separate scripts into a single, well-organized package with clear separation of concerns:

**Benefits:**
- **Single entry point** (`main.py`) - No need to remember multiple scripts
- **Modular components** - Each module has a specific responsibility
- **Reusable code** - Shared models and configuration
- **Type safety** - Data models with dataclasses
- **Easy testing** - Each module can be tested independently
- **Clear configuration** - All settings in one place (`config.py`)

### Project Structure

```
momentum-stock-replay/
├── scripts/                   # All scripts for data management
│   ├── main.py               # Data pipeline entry point
│   ├── view_orderbook.py     # Order book viewer (console)
│   └── pipeline/             # Pipeline package
│       ├── __init__.py
│       ├── config.py         # Configuration and constants
│       ├── models.py         # Data models and schemas
│       ├── fetchers.py       # Data fetching (fundamentals, OHLCV, MBP-1)
│       ├── analyzers.py      # Run-up analysis
│       ├── compressor.py     # Binary compression (all MBP-1 columns)
│       ├── summarizer.py     # Summary generation
│       └── pipeline.py       # Main orchestrator
├── sessions/                  # Compressed binary data (committed)
├── summary/                   # Run summaries (committed)
└── .github/workflows/        # GitHub Actions automation
```

## Local Usage

### Single Command (Recommended)

Run the complete pipeline with one command:

```bash
# Run for yesterday's date (default)
python scripts/main.py

# Run for specific date
python scripts/main.py --date 2025-11-14

# Skip compression (for testing)
python scripts/main.py --skip-compression

# Show version
python scripts/main.py --version
```

The unified pipeline runs all steps automatically:
1. Fetch fundamentals
2. Download 1h OHLCV & analyze run-ups
3. Download MBP-1 data (if stocks pass filter)
4. Compress to binary format
5. Generate summary

**Output:**
- `sessions/*.bin.gz` - Compressed MBP-1 data (committed to git)
- `summary/*_summary.json` - Run summaries (committed to git)
- `runup_analysis_*.json` - Analysis results (artifacts only)
- `databento_mbp1_data/` - Raw parquet files (artifacts only)

### View Order Book Data (Console Viewer)

Display Level 1 order book data from compressed session files:

```bash
# Basic view (first 20 updates)
python scripts/view_orderbook.py sessions/AAPL-20251114.bin.gz

# Show more updates
python scripts/view_orderbook.py sessions/AAPL-20251114.bin.gz --limit 50

# Filter by exchange
python scripts/view_orderbook.py sessions/AAPL-20251114.bin.gz --exchange NASDAQ

# Show all updates (no limit)
python scripts/view_orderbook.py sessions/AAPL-20251114.bin.gz --limit 0

# Show summary statistics
python scripts/view_orderbook.py sessions/AAPL-20251114.bin.gz --stats

# Group by exchange
python scripts/view_orderbook.py sessions/AAPL-20251114.bin.gz --by-exchange
```

**Features:**
- View tick-by-tick order book updates
- Filter by specific exchange (NASDAQ, NYSE, IEX, etc.)
- See bid/ask prices and sizes
- Calculate spreads
- Summary statistics (price range, average spread, updates per second)
- Exchange-grouped view

**Example Output:**
```
Time         Exchange    Bid Size    Bid Price     Ask Price     Ask Size    Spread
------------ ---------- ---------- ------------ ------------ ---------- ----------
09:30:00.123 NASDAQ     500        $150.23000   $150.24000   300        $0.01000
09:30:00.156 NYSE       1000       $150.22500   $150.24500   800        $0.02000
09:30:00.189 IEX        200        $150.23500   $150.23500   150        $0.00000
```

## GitHub Actions (Automated)

The workflow runs Monday-Friday at 11 PM UTC (6 PM ET, after market close):

### What It Does

1. Runs `python scripts/main.py` for yesterday's date
2. Executes complete pipeline:
   - Fetches latest fundamentals
   - Downloads 1h OHLCV data
   - Analyzes run-ups (>30% filter)
   - Downloads MBP-1 data for high performers
   - Compresses to binary format
   - Generates summary
3. Uploads raw data as artifacts (90-day retention)
4. Commits to repository:
   - `sessions/*.bin.gz` - Compressed binary data
   - `summary/*_summary.json` - Run summaries
   - `runup_analysis_*.json/csv` - Analysis results
   - `pipeline_log_*.json` - Execution logs

### Required Secrets

In GitHub repository settings, add:
- `FUNDAMENTALS_REPO_TOKEN` - GitHub PAT for fundamentals repo
- `DATABENTO_API_KEY` - Databento API key

### Manual Trigger

1. Go to "Actions" tab
2. Select "Daily Data Fetch"
3. Click "Run workflow"

## Output Structure

```
momentum-stock-replay/
├── fundamentals.json                           # Example file
├── fundamentals_2025-11-14.json               # Full fundamentals (artifact only)
├── fundamentals_2025-11-14_filtered.json      # Filtered (artifact only)
│
├── databento_data/                            # 1h OHLCV data (artifact only)
│   ├── 2025-11-14/
│   │   ├── AAPL_2025-11-14_1h.parquet
│   │   └── ...
│   └── combined_ohlcv_2025-11-14.parquet
│
├── databento_mbp1_data/                       # MBP-1 tick data (artifact only)
│   ├── 2025-11-14/
│   │   ├── SYMB_2025-11-14_mbp1.parquet
│   │   └── ...
│   └── combined_mbp1_2025-11-14.parquet
│
├── sessions/                                  # Compressed binary (COMMITTED)
│   ├── SYMB-20251114.bin.gz
│   └── ...
│
├── summary/                                   # Run summaries (COMMITTED)
│   ├── 2025-11-14_summary.json
│   └── ...
│
├── runup_analysis_2025-11-14.json            # Analysis results (artifact only)
├── runup_analysis_2025-11-14.csv             # CSV format (artifact only)
└── pipeline_log_2025-11-14.json              # Execution log (artifact only)
```

**What gets committed to git:**
- `sessions/*.bin.gz` - Compressed MBP-1 data with ALL columns (efficient storage)
- `summary/*_summary.json` - Pipeline summaries

**What stays as artifacts:**
- `databento_data/` - 1h OHLCV data (large files)
- `databento_mbp1_data/` - Raw MBP-1 parquet (large files)
- `runup_analysis_*.json/csv` - Analysis results
- `fundamentals_*.json` - Fundamentals data

### Binary Compression Format

The compressed session files (`sessions/*.bin.gz`) use a custom binary format that preserves **all MBP-1 columns**:

**Format Version 2:**
- **Header** (18 bytes): Magic (TICK) + Version (2) + Row Count + Initial Timestamp
- **Rows** (64 bytes each):
  - ts_event delta, rtype, publisher_id, instrument_id
  - action, side, depth, price, size, flags
  - ts_in_delta, sequence
  - bid_px_00, ask_px_00, bid_sz_00, ask_sz_00
  - bid_ct_00, ask_ct_00
- **Compression**: Gzip level 9

This format retains complete market microstructure data including exchange identifiers, sequence numbers, and all bid/ask levels.

## Data Schema

### Fundamentals
```json
{
  "symbol": "AAPL",
  "company_info": { "name": "...", "exchange": "NASDAQ", ... },
  "fundamentals": { "Market Cap": 37140000.0, "Shs Float": 3160000.0, ... }
}
```

### 1h/1s OHLCV Data
```
Columns: ts_event, open, high, low, close, volume, symbol
```

### Run-up Analysis
```json
{
  "symbol": "SYMB",
  "premarket_open": 10.50,
  "day_high": 15.25,
  "runup_pct": 45.23,
  "total_volume": 1000000
}
```

## Cost Considerations

### Databento API Usage

Approximate daily costs (varies by plan):

1. **1h data**: 1,799 symbols × 1 day × ~8 bars = ~14,000 bars
   - Low cost (a few cents to dollars)

2. **1s data**: N symbols (typically 5-50) × 1 day × ~23,400 bars
   - Higher cost (depends on number of qualifying stocks)
   - Only fetches stocks with >30% run-up

**Tip**: Monitor your Databento usage dashboard to track costs.

## Filter Criteria

### Initial Filter (Fundamentals)
- Share Float < 100M
- Market Cap < $300M
- Price between $1 and $50

### Run-up Filter (1h Analysis)
- Run-up from premarket open to day's high > 30%

## Example Run

```bash
$ python fetch_databento_ohlcv.py --date 2025-11-14

Loaded 1799 symbols from fundamentals_filtered.json
Querying Databento for all 1799 symbols...
Received 14,392 total bars

Running run-up analysis...
Analyzing 1799 symbols for 2025-11-14...

[TOP 10 PERFORMERS - >30% RUN-UP]
  1. SYMB1: 45.23% ($10.50 -> $15.25)
  2. SYMB2: 38.67% ($8.20 -> $11.37)
  ...

Found 15 symbols with >30% run-up.

$ python fetch_databento_1s.py --date 2025-11-14

Loaded 15 symbols from runup_analysis_2025-11-14.json
Fetching 1-second OHLCV data...
Received 351,000 total 1-second bars
```

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `fetch_fundamentals.py` | Fetch & filter fundamentals |
| `fetch_databento_ohlcv.py` | Download 1h data & analyze |
| `analyze_runup.py` | Analyze run-ups (manual) |
| `fetch_databento_1s.py` | Download 1s data for winners |
| `test_filter.py` | Test filtering on existing data |

## Troubleshooting

### No API Key
```
[ERROR] No DATABENTO_API_KEY found
```
**Solution**: Set the environment variable

### No Analysis File
```
[ERROR] Analysis file not found: runup_analysis_2025-11-14.json
```
**Solution**: Run `fetch_databento_ohlcv.py` first

### No Data Returned
Possible causes:
- Weekend/holiday (no trading)
- Wrong dataset for exchange
- Symbol not available

### High API Usage
- 1s data is expensive - only runs for stocks with >30% run-up
- Monitor Databento dashboard
- Adjust threshold if needed

## Development

### Add New Filters

Edit `fetch_fundamentals.py`:
```python
filtered = fetcher.filter_stocks(
    data,
    max_float=50_000_000,     # Adjust
    max_market_cap=200_000_000,
    min_price=2.0,
    max_price=30.0
)
```

### Change Run-up Threshold

Edit `analyze_runup.py` or use CLI:
```bash
python analyze_runup.py --date 2025-11-14 --threshold 20
```

## License

See LICENSE file.

## Support

For issues with:
- **Databento API**: https://docs.databento.com
- **This project**: Create an issue on GitHub
