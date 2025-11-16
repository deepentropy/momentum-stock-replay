#!/usr/bin/env python3
"""
Download historical OHLCV-1h data from Databento for multiple symbols
Designed for GitHub Actions daily automation with batch requests
"""

import os
import sys
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
import pandas as pd

try:
    import databento as db
except ImportError:
    print("ERROR: databento not installed. Run: pip install databento")
    sys.exit(1)

# Configuration
CONFIG_DIR = Path(__file__).parent.parent / 'config'
OUTPUT_DIR = Path(__file__).parent.parent / 'sessions'
OUTPUT_DIR.mkdir(exist_ok=True)

SYMBOLS_FILE = CONFIG_DIR / 'symbols.json'
DATASET = os.getenv('DATABENTO_DATASET', 'XNAS.ITCH')  # Nasdaq dataset
SCHEMA = 'ohlcv-1h'  # Hourly OHLCV bars (includes extended hours)

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def load_symbols():
    """Load symbol list from config file"""
    if not SYMBOLS_FILE.exists():
        logger.error(f"Symbols file not found: {SYMBOLS_FILE}")
        logger.error("Please create config/symbols.json with your symbol list")
        sys.exit(1)

    with open(SYMBOLS_FILE) as f:
        config = json.load(f)
        symbols = config.get('symbols', [])

    if not symbols:
        logger.error("No symbols found in config file")
        sys.exit(1)

    logger.info(f"Loaded {len(symbols)} symbols from config")
    return symbols


def get_previous_trading_day():
    """Calculate previous trading day (skipping weekends)"""
    today = datetime.now().date()

    # If Monday, go back to Friday
    if today.weekday() == 0:
        return today - timedelta(days=3)
    # If Sunday, go back to Friday
    elif today.weekday() == 6:
        return today - timedelta(days=2)
    # If Saturday, go back to Friday
    elif today.weekday() == 5:
        return today - timedelta(days=1)
    # Otherwise, previous day
    else:
        return today - timedelta(days=1)


def download_databento_data():
    """Main download function with batch request for all symbols"""

    # Check for API key
    api_key = os.getenv('DATABENTO_API_KEY')
    if not api_key:
        logger.error("DATABENTO_API_KEY environment variable not set")
        logger.error("Set it with: export DATABENTO_API_KEY='db-YOUR-KEY'")
        sys.exit(1)

    # Initialize client
    try:
        client = db.Historical(api_key)
        logger.info("✓ Connected to Databento API")
    except Exception as e:
        logger.error(f"Failed to initialize Databento client: {e}")
        sys.exit(1)

    # Load symbols
    symbols = load_symbols()

    # Calculate date range
    end_date = datetime.now().date()
    start_date = get_previous_trading_day()

    logger.info("=" * 70)
    logger.info(f"Dataset: {DATASET}")
    logger.info(f"Schema: {SCHEMA}")
    logger.info(f"Symbols: {len(symbols)}")
    logger.info(f"Date range: {start_date} to {end_date}")
    logger.info("=" * 70)

    # Estimate cost first
    try:
        logger.info("Estimating cost...")
        cost = client.metadata.get_cost(
            dataset=DATASET,
            symbols=symbols,
            schema=SCHEMA,
            start=str(start_date),
            end=str(end_date),
            stype_in='raw_symbol'
        )
        logger.info(f"✓ Estimated cost: ${cost:.4f}")

        # Warning if cost is high
        if cost > 5.0:
            logger.warning(f"⚠ Cost is higher than expected: ${cost:.2f}")
            logger.warning("Consider reducing symbols or changing dataset")
    except Exception as e:
        logger.warning(f"Could not estimate cost: {e}")
        cost = None

    # Download data (SINGLE BATCH REQUEST for all symbols)
    try:
        logger.info(f"\nRequesting data for {len(symbols)} symbols...")
        logger.info("This may take 2-5 minutes...")

        data = client.timeseries.get_range(
            dataset=DATASET,
            symbols=symbols,
            schema=SCHEMA,
            start=str(start_date),
            end=str(end_date),
            stype_in='raw_symbol'
        )

        logger.info("✓ Data received, converting to DataFrame...")

        # Convert to DataFrame (include timestamp as column, not index)
        df = data.to_df()

        # Reset index to make ts_event a column if it's in the index
        if df.index.name == 'ts_event' or 'ts_event' not in df.columns:
            df = df.reset_index()

        # Check results
        if len(df) == 0:
            logger.warning("⚠ No data received (market may be closed or symbols invalid)")
            logger.warning(f"Target date: {start_date}")
            return None, None

        received_symbols = set(df['symbol'].unique())
        missing_symbols = set(symbols) - received_symbols

        logger.info("\n" + "=" * 70)
        logger.info("Download Results")
        logger.info("=" * 70)
        logger.info(f"✓ Downloaded {len(df):,} records")
        logger.info(f"✓ Symbols received: {len(received_symbols)}/{len(symbols)}")

        if missing_symbols:
            logger.warning(f"⚠ Missing data for {len(missing_symbols)} symbols:")
            # Show first 20 missing symbols
            missing_list = sorted(list(missing_symbols))[:20]
            logger.warning(f"  {', '.join(missing_list)}")
            if len(missing_symbols) > 20:
                logger.warning(f"  ... and {len(missing_symbols) - 20} more")

        # Show time range
        if 'ts_event' in df.columns:
            df['datetime'] = pd.to_datetime(df['ts_event'])
            min_time = df['datetime'].min()
            max_time = df['datetime'].max()
            logger.info(f"✓ Time range: {min_time} to {max_time}")

            # Check for extended hours
            df['hour'] = df['datetime'].dt.hour
            unique_hours = sorted(df['hour'].unique())
            logger.info(f"✓ Hours present: {unique_hours}")

            # Extended hours check
            extended_hours = [h for h in unique_hours if h < 9 or h >= 16]
            if extended_hours:
                logger.info(f"✓ Extended hours detected: {extended_hours}")
            else:
                logger.warning("⚠ No extended hours data (only regular market hours)")

        # Save to CSV
        date_str = start_date.strftime('%Y%m%d')
        output_file = OUTPUT_DIR / f'databento_ohlcv_{date_str}.csv'

        df.to_csv(output_file, index=False)
        file_size = output_file.stat().st_size / 1024 / 1024  # MB

        logger.info(f"\n✓ Saved to: {output_file}")
        logger.info(f"✓ File size: {file_size:.2f} MB")

        # Save metadata
        metadata = {
            'timestamp': datetime.now().isoformat(),
            'date': str(start_date),
            'dataset': DATASET,
            'schema': SCHEMA,
            'symbols_requested': len(symbols),
            'symbols_received': len(received_symbols),
            'symbols_missing': len(missing_symbols),
            'records': len(df),
            'estimated_cost': cost,
            'file_size_mb': round(file_size, 2),
            'missing_symbols': sorted(list(missing_symbols)) if len(missing_symbols) < 100 else sorted(list(missing_symbols))[:100],
            'time_range': {
                'min': str(min_time) if 'min_time' in locals() else None,
                'max': str(max_time) if 'max_time' in locals() else None
            },
            'hours_present': [int(h) for h in unique_hours] if 'unique_hours' in locals() else []
        }

        metadata_file = OUTPUT_DIR / f'databento_ohlcv_{date_str}.json'
        with open(metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2, default=str)

        logger.info(f"✓ Metadata saved to: {metadata_file}")
        logger.info("\n" + "=" * 70)
        logger.info("✓ Download completed successfully")
        logger.info("=" * 70)

        return output_file, metadata

    except Exception as e:
        logger.error(f"\n✗ Download failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    try:
        download_databento_data()
    except KeyboardInterrupt:
        logger.info("\nDownload cancelled by user")
        sys.exit(1)
