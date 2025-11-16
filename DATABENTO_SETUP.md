# Databento Setup Guide - 500 Symbols Daily OHLCV-1h

Complete guide for automated daily downloads of hourly OHLCV data (including premarket/postmarket) for 500 stocks using Databento.

---

## Quick Start

### 1. Sign Up for Databento

1. Go to https://databento.com
2. Create a free account (get $125 credit automatically)
3. Navigate to: https://databento.com/platform/keys
4. Click "Generate New API Key"
5. Copy your API key (32-character string starting with `db-`)

### 2. Configure Your Symbol List

Edit `config/symbols.json` and add your 500 symbols:

```json
{
  "symbols": [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA",
    "... add 495 more symbols ..."
  ]
}
```

**Tips for building your symbol list:**
- S&P 500: https://en.wikipedia.org/wiki/List_of_S%26P_500_companies
- Russell 1000: Use a financial data provider
- Custom watchlist: Import from your trading platform

### 3. Test Locally

```bash
# Install dependencies
pip install -r requirements.txt

# Set API key
export DATABENTO_API_KEY='db-YOUR-32-CHAR-API-KEY-HERE'

# For Windows:
set DATABENTO_API_KEY=db-YOUR-32-CHAR-API-KEY-HERE

# Run download script
python scripts/download_databento_data.py
```

**What to expect:**
- Cost estimation (should be $0.50-$2.00 for 500 symbols)
- Download time: 2-5 minutes
- Output: `sessions/databento_ohlcv_YYYYMMDD.csv`
- Metadata: `sessions/databento_ohlcv_YYYYMMDD.json`

### 4. Verify Extended Hours Coverage

```python
import pandas as pd

# Load the downloaded data
df = pd.read_csv('sessions/databento_ohlcv_YYYYMMDD.csv')

# Check hours
df['datetime'] = pd.to_datetime(df['ts_event'])
df['hour'] = df['datetime'].dt.hour

print("Hours present in data:")
print(df['hour'].value_counts().sort_index())

# Extended hours are:
# Premarket: 4-9 AM ET
# Regular: 9:30 AM - 4 PM ET (hours 9-15)
# Postmarket: 4-8 PM ET (hours 16-20)
```

### 5. Configure GitHub Actions

**Add API Key to GitHub Secrets:**

1. Go to your repository on GitHub
2. Navigate to: **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"**
4. Name: `DATABENTO_API_KEY`
5. Value: Your `db-...` API key
6. Click **"Add secret"**

**Enable GitHub Actions:**

1. Go to **Settings** → **Actions** → **General**
2. Under "Workflow permissions":
   - Select **"Read and write permissions"**
   - Check **"Allow GitHub Actions to create and approve pull requests"**
3. Click **"Save"**

### 6. Deploy and Test

```bash
# Commit and push
git add .
git commit -m "Add Databento automation for 500 symbols"
git push

# Test workflow manually
# Go to Actions tab → "Download Databento OHLCV Data" → "Run workflow"
```

---

## Cost Monitoring

### Estimated Costs

**Your Setup (500 symbols, daily):**
- Per download: $0.50-$2.00
- Per month (20 trading days): $10-$40
- Per year: $125-$500

**Your $125 Free Credit:**
- Lasts approximately **3-6 months** for 500 symbols
- After that: $10-$40/month ongoing

### Check Your Costs

**Method 1: Databento Dashboard**
1. Log in to https://databento.com/platform
2. Go to "Billing" or "Usage" section
3. View daily/monthly spend

**Method 2: Check Metadata Files**
Each download creates a JSON file with cost info:
```bash
cat sessions/databento_ohlcv_20251115.json | grep estimated_cost
```

**Method 3: API Query**
```python
import databento as db
client = db.Historical('YOUR_API_KEY')

# Estimate before downloading
cost = client.metadata.get_cost(
    dataset='XNAS.ITCH',
    symbols=your_symbol_list,  # All 500
    schema='ohlcv-1h',
    start='2025-11-14',
    end='2025-11-15'
)
print(f"Cost: ${cost:.4f}")
```

### Cost Optimization

**If costs are too high:**

1. **Use different dataset**
   - Try `DBEQ.BASIC` instead of `XNAS.ITCH` (lower licensing fees)
   - Edit in workflow: `DATABENTO_DATASET: DBEQ.BASIC`

2. **Reduce to regular hours only**
   - Use `ohlcv-1d` (daily bars) instead of `ohlcv-1h`
   - Cheaper but loses intraday and extended hours data

3. **Subscribe if usage > $200/month**
   - Standard Plan: $199/month for unlimited historical access
   - Makes sense if downloading frequently

4. **Reduce symbol count**
   - Remove low-priority symbols
   - Focus on most actively traded stocks

---

## Symbol Management

### Adding/Removing Symbols

Edit `config/symbols.json`:

```json
{
  "symbols": [
    "AAPL",  // Keep
    "TSLA",  // Keep
    // "GME"  // Remove by commenting out or deleting
    "NVDA"   // Add new symbol
  ]
}
```

Then commit and push - next workflow run will use updated list.

### Organizing by Category

```json
{
  "symbols": [
    "AAPL", "MSFT", "GOOGL", "..."
  ],
  "categories": {
    "tech": ["AAPL", "MSFT", "GOOGL"],
    "finance": ["JPM", "BAC", "GS"],
    "energy": ["XOM", "CVX", "COP"]
  }
}
```

### Dynamic Symbol Lists

For programmatic symbol management:

```python
# scripts/update_symbols.py
import json
import pandas as pd

# Example: Get S&P 500 list
sp500 = pd.read_html('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies')[0]
symbols = sp500['Symbol'].str.replace('.', '-').tolist()

# Save to config
config = {
    "version": "1.0",
    "updated": str(datetime.now().date()),
    "symbols": symbols[:500]  # Limit to 500
}

with open('config/symbols.json', 'w') as f:
    json.dump(config, f, indent=2)
```

---

## Workflow Schedule

### Default Schedule

```yaml
schedule:
  - cron: '0 14 * * 1-5'  # 2 PM UTC = 9 AM EST, Mon-Fri
```

### Common Adjustments

**After market close (4 PM EST):**
```yaml
- cron: '0 21 * * 1-5'  # 9 PM UTC = 4 PM EST
```

**Early morning (before market):**
```yaml
- cron: '0 12 * * 1-5'  # 12 PM UTC = 7 AM EST
```

**Multiple times per day:**
```yaml
schedule:
  - cron: '0 14 * * 1-5'  # 9 AM EST
  - cron: '0 21 * * 1-5'  # 4 PM EST
```

---

## Troubleshooting

### Error: "DATABENTO_API_KEY environment variable not set"

**Local testing:**
```bash
export DATABENTO_API_KEY='db-...'  # Linux/Mac
set DATABENTO_API_KEY=db-...       # Windows
```

**GitHub Actions:**
- Verify secret is added: Settings → Secrets → Actions
- Check secret name is exactly `DATABENTO_API_KEY`

### Error: "Symbols file not found"

```bash
# Ensure config directory exists
mkdir config

# Create symbols.json
# Use template from config/symbols.json
```

### Error: "No data received"

**Possible causes:**
1. **Market holiday** - No trading, no data
2. **Invalid symbols** - Check metadata file for missing_symbols
3. **Date too far back** - Databento has limited historical depth
4. **Weekend** - Script tries to get previous trading day

**Check metadata:**
```bash
cat sessions/databento_ohlcv_YYYYMMDD.json
```

### Error: "Cost is higher than expected"

**If cost > $5/day:**
1. Check if you have more than 500 symbols
2. Verify dataset (XNAS.ITCH vs DBEQ.BASIC)
3. Consider using daily bars instead of hourly

### Workflow Times Out

**If workflow exceeds 30 minutes:**
1. Reduce symbols (try 250 instead of 500)
2. Split into two workflows
3. Use batch API instead of streaming API

---

## Advanced Configuration

### Using Different Datasets

**Nasdaq (XNAS.ITCH)** - Default
```yaml
env:
  DATABENTO_DATASET: XNAS.ITCH
```

**NYSE (XNYS.PILLAR)**
```yaml
env:
  DATABENTO_DATASET: XNYS.PILLAR
```

**Databento Equities Basic (DBEQ.BASIC)** - Lower cost
```yaml
env:
  DATABENTO_DATASET: DBEQ.BASIC
```

### Changing Data Granularity

**Daily bars only (cheaper):**

Edit `scripts/download_databento_data.py`:
```python
SCHEMA = 'ohlcv-1d'  # Daily instead of hourly
```

**1-minute bars (more expensive):**
```python
SCHEMA = 'ohlcv-1m'  # Minute bars
```

### Parallel Processing for Very Large Lists

If you have > 1000 symbols:

```python
# Split into chunks
chunk_size = 500
for i in range(0, len(all_symbols), chunk_size):
    chunk = all_symbols[i:i+chunk_size]
    download_chunk(chunk)
```

---

## Data Format

### CSV Output Format

**File**: `sessions/databento_ohlcv_YYYYMMDD.csv`

**Columns**:
- `ts_event`: Timestamp (nanoseconds since epoch)
- `symbol`: Stock ticker
- `open`: Open price
- `high`: High price
- `low`: Low price
- `close`: Close price
- `volume`: Trading volume
- Other metadata fields

### Metadata JSON Format

**File**: `sessions/databento_ohlcv_YYYYMMDD.json`

```json
{
  "timestamp": "2025-11-15T14:30:00",
  "date": "2025-11-14",
  "dataset": "XNAS.ITCH",
  "schema": "ohlcv-1h",
  "symbols_requested": 500,
  "symbols_received": 498,
  "symbols_missing": 2,
  "records": 7968,
  "estimated_cost": 1.2345,
  "file_size_mb": 0.85,
  "missing_symbols": ["INVALID1", "DELISTED2"],
  "hours_present": [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
}
```

---

## Comparison: IB Gateway vs Databento

| Feature | IB Gateway | Databento |
|---------|-----------|-----------|
| Setup Complexity | High (Docker, auth) | Low (API key) |
| Cost | Free | $10-40/month |
| Reliability | Medium | High |
| Speed (500 symbols) | 30-60 min | 2-5 min |
| Extended Hours | Yes | Yes (hourly bars) |
| GitHub Actions | Complex | Simple |
| Rate Limits | Yes | Practically none |
| Batch Requests | No | Yes (2000 symbols) |

**Recommendation**: Databento for production automation

---

## Support and Resources

### Databento Resources
- **Documentation**: https://databento.com/docs
- **Python SDK**: https://github.com/databento/databento-python
- **API Reference**: https://databento.com/docs/api-reference-historical
- **Support Email**: support@databento.com
- **Pricing**: https://databento.com/pricing

### Cost Calculator
Visit https://databento.com/pricing to estimate costs for your specific use case.

### Getting Help
1. Check this documentation first
2. Review Databento docs: https://databento.com/docs
3. Check GitHub workflow logs
4. Contact Databento support: support@databento.com
5. Review metadata JSON files for error details

---

## Next Steps

1. ✅ Sign up for Databento (get $125 credit)
2. ✅ Create your 500-symbol list in `config/symbols.json`
3. ✅ Test locally with `python scripts/download_databento_data.py`
4. ✅ Add `DATABENTO_API_KEY` to GitHub Secrets
5. ✅ Push code and test workflow manually
6. ✅ Monitor first few runs for costs and data quality
7. ✅ Optimize schedule and symbol list as needed

**Questions?** Review the troubleshooting section or contact Databento support.

---

**Last Updated**: 2025-11-15
