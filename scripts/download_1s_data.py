#!/usr/bin/env python3
"""
Stage 3: Detail Data Downloader
Downloads OHLCV-1s (1-second bars) for momentum winners only
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

# Setup paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
CONFIG_DIR = PROJECT_DIR / 'config'
OUTPUT_DIR = PROJECT_DIR / 'sessions'

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class DetailDataDownloader:
    def __init__(self, databento_api_key, config_path=None):
        self.databento_api_key = databento_api_key

        # Load configuration
        if config_path is None:
            config_path = CONFIG_DIR / 'pipeline_config.json'

        with open(config_path) as f:
            self.config = json.load(f)

        self.dataset = self.config['databento']['dataset']
        self.schema = self.config['databento']['schema_second']
        self.max_symbols = self.config['databento']['max_symbols_stage3']

        # Initialize Databento client
        try:
            self.client = db.Historical(databento_api_key)
            logger.info("✓ Connected to Databento API")
        except Exception as e:
            logger.error(f"Failed to initialize Databento client: {e}")
            raise

    def get_previous_trading_day(self):
        """Calculate previous trading day (skip weekends)"""
        today = datetime.now().date()

        if today.weekday() == 0:  # Monday
            return today - timedelta(days=3)
        elif today.weekday() == 6:  # Sunday
            return today - timedelta(days=2)
        elif today.weekday() == 5:  # Saturday
            return today - timedelta(days=1)
        else:
            return today - timedelta(days=1)

    def download_second_data(self, symbols, target_date=None):
        """
        Download OHLCV-1s data for given symbols
        This is expensive - only call for confirmed momentum winners
        """
        if target_date is None:
            target_date = self.get_previous_trading_day()

        # Limit symbols to prevent excessive costs
        if len(symbols) > self.max_symbols:
            logger.warning(f"Limiting to {self.max_symbols} symbols (config max_symbols_stage3)")
            symbols = symbols[:self.max_symbols]

        start_date = str(target_date)
        end_date = str(target_date + timedelta(days=1))

        logger.info(f"\nDownloading OHLCV-1s data...")
        logger.info(f"  Symbols: {len(symbols)}")
        logger.info(f"  Date: {start_date}")
        logger.info(f"  Dataset: {self.dataset}")
        logger.info(f"  ⚠️  This will download 1-second bars (expensive!)")

        # Estimate cost
        try:
            cost = self.client.metadata.get_cost(
                dataset=self.dataset,
                symbols=symbols,
                schema=self.schema,
                start=start_date,
                end=end_date,
                stype_in='raw_symbol'
            )
            logger.info(f"  Estimated cost: ${cost:.4f}")

            # Warning if cost is high
            cost_limit = self.config['pipeline'].get('cost_limit_warning', 15.0)
            if cost > cost_limit:
                logger.warning(f"⚠️  Cost ${cost:.2f} exceeds warning limit ${cost_limit}")
                logger.warning("Consider reducing symbols or checking configuration")

        except Exception as e:
            logger.warning(f"Could not estimate cost: {e}")
            cost = None

        # Download data
        try:
            logger.info("Requesting data (this may take several minutes)...")

            data = self.client.timeseries.get_range(
                dataset=self.dataset,
                symbols=symbols,
                schema=self.schema,
                start=start_date,
                end=end_date,
                stype_in='raw_symbol'
            )

            # Convert to DataFrame
            df = data.to_df()

            # Reset index to make ts_event a column
            if df.index.name == 'ts_event' or 'ts_event' not in df.columns:
                df = df.reset_index()

            logger.info(f"✓ Downloaded {len(df):,} records")

            # Add datetime column
            df['datetime'] = pd.to_datetime(df['ts_event'])

            # Save data
            date_str = target_date.strftime('%Y%m%d')
            output_file = OUTPUT_DIR / f'{date_str}_databento_1s.csv'
            df.to_csv(output_file, index=False)

            file_size = output_file.stat().st_size / 1024 / 1024  # MB
            logger.info(f"✓ Saved 1-second data: {output_file}")
            logger.info(f"  File size: {file_size:.2f} MB")

            # Save metadata
            metadata = {
                'timestamp': datetime.now().isoformat(),
                'date': start_date,
                'dataset': self.dataset,
                'schema': self.schema,
                'symbols': symbols,
                'total_records': len(df),
                'file_size_mb': round(file_size, 2),
                'estimated_cost': cost
            }

            metadata_file = OUTPUT_DIR / f'{date_str}_databento_1s_metadata.json'
            with open(metadata_file, 'w') as f:
                json.dump(metadata, f, indent=2, default=str)

            return df, cost

        except Exception as e:
            logger.error(f"Failed to download data: {e}")
            raise

    def run(self, symbols, target_date=None):
        """
        Main execution flow
        """
        logger.info("=" * 70)
        logger.info("STAGE 3: DETAIL DATA DOWNLOADER (OHLCV-1s)")
        logger.info("=" * 70)

        if target_date is None:
            target_date = self.get_previous_trading_day()

        date_str = target_date.strftime('%Y%m%d')

        try:
            if len(symbols) == 0:
                logger.warning("No symbols provided - skipping Stage 3")
                return None, None

            # Download 1-second data
            logger.info(f"\nDownloading 1-second bars for {len(symbols)} winners...")
            second_df, cost = self.download_second_data(symbols, target_date)

            logger.info(f"\n{'=' * 70}")
            logger.info(f"✓ STAGE 3 COMPLETE: {len(second_df):,} records downloaded")
            if cost:
                logger.info(f"  Cost: ${cost:.4f}")
            logger.info(f"{'=' * 70}\n")

            return second_df, date_str

        except Exception as e:
            logger.error(f"\n✗ STAGE 3 FAILED: {str(e)}")
            import traceback
            traceback.print_exc()
            return None, None


def main():
    """
    Standalone execution
    """
    # Get API key
    databento_api_key = os.getenv('DATABENTO_API_KEY')

    if not databento_api_key:
        logger.error("ERROR: DATABENTO_API_KEY environment variable not set")
        sys.exit(1)

    # Load winners from Stage 2
    date_str = datetime.now().strftime('%Y%m%d')
    winners_file = OUTPUT_DIR / f'{date_str}_winners.csv'

    if not winners_file.exists():
        logger.error(f"ERROR: Winners file not found: {winners_file}")
        logger.error("Run momentum_analyzer.py (Stage 2) first")
        sys.exit(1)

    # Read winners
    import csv
    with open(winners_file) as f:
        reader = csv.DictReader(f)
        symbols = [row['symbol'] for row in reader]

    logger.info(f"Loaded {len(symbols)} winners from Stage 2")

    # Run downloader
    downloader = DetailDataDownloader(databento_api_key)
    result_df, date_str = downloader.run(symbols)

    if result_df is None:
        sys.exit(1)


if __name__ == '__main__':
    main()
