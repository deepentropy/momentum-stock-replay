#!/usr/bin/env python3
"""
Stage 2: Momentum Analyzer
Downloads OHLCV-1h data and calculates max intraday run-up from premarket open
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


class MomentumAnalyzer:
    def __init__(self, databento_api_key, config_path=None):
        self.databento_api_key = databento_api_key

        # Load configuration
        if config_path is None:
            config_path = CONFIG_DIR / 'pipeline_config.json'

        with open(config_path) as f:
            self.config = json.load(f)

        self.dataset = self.config['databento']['dataset']
        self.schema = self.config['databento']['schema_hourly']
        self.min_runup = self.config['momentum_filters']['min_runup_percent']
        self.premarket_hours = self.config['momentum_filters']['premarket_hours']

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

    def download_hourly_data(self, symbols, target_date=None):
        """
        Download OHLCV-1h data for given symbols
        """
        if target_date is None:
            target_date = self.get_previous_trading_day()

        start_date = str(target_date)
        end_date = str(target_date + timedelta(days=1))

        logger.info(f"\nDownloading OHLCV-1h data...")
        logger.info(f"  Symbols: {len(symbols)}")
        logger.info(f"  Date: {start_date}")
        logger.info(f"  Dataset: {self.dataset}")

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
        except Exception as e:
            logger.warning(f"Could not estimate cost: {e}")
            cost = None

        # Download data
        try:
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

            logger.info(f"✓ Downloaded {len(df)} records")

            # Add datetime columns for analysis
            df['datetime'] = pd.to_datetime(df['ts_event'])
            df['hour'] = df['datetime'].dt.hour
            df['date'] = df['datetime'].dt.date

            # Save raw data
            date_str = target_date.strftime('%Y%m%d')
            output_file = OUTPUT_DIR / f'{date_str}_databento_1h.csv'
            df.to_csv(output_file, index=False)
            logger.info(f"✓ Saved hourly data: {output_file}")

            return df, cost

        except Exception as e:
            logger.error(f"Failed to download data: {e}")
            raise

    def calculate_runup(self, symbol_data):
        """
        Calculate max run-up from premarket open to highest high

        Returns:
            runup_pct: Percentage gain
            premarket_open: Opening price in premarket
            highest_high: Highest price during day
            details: Dict with additional info
        """
        # Identify premarket bars
        premarket_bars = symbol_data[symbol_data['hour'].isin(self.premarket_hours)]

        if len(premarket_bars) == 0:
            # No premarket data, use first available bar
            if len(symbol_data) == 0:
                return None, None, None, {'error': 'No data'}

            premarket_open = symbol_data.iloc[0]['open']
            logger.debug(f"  No premarket data, using first bar open: ${premarket_open:.2f}")
        else:
            # Use first premarket bar's open price
            premarket_open = premarket_bars.iloc[0]['open']
            logger.debug(f"  Premarket open (hour {premarket_bars.iloc[0]['hour']}): ${premarket_open:.2f}")

        # Find highest high across entire day
        highest_high = symbol_data['high'].max()
        high_bar = symbol_data[symbol_data['high'] == highest_high].iloc[0]

        # Calculate run-up percentage
        runup_pct = ((highest_high - premarket_open) / premarket_open) * 100

        details = {
            'premarket_open': float(premarket_open),
            'highest_high': float(highest_high),
            'high_hour': int(high_bar['hour']),
            'high_time': str(high_bar['datetime']),
            'day_open': float(symbol_data.iloc[0]['open']),
            'day_close': float(symbol_data.iloc[-1]['close']),
            'total_bars': len(symbol_data),
            'premarket_bars': len(premarket_bars)
        }

        return runup_pct, premarket_open, highest_high, details

    def analyze_momentum(self, hourly_df):
        """
        Analyze each symbol for momentum
        Filter by min_runup_percent threshold
        """
        logger.info(f"\nAnalyzing momentum...")
        logger.info(f"  Minimum run-up: {self.min_runup}%")

        results = []
        symbols = hourly_df['symbol'].unique()

        for symbol in symbols:
            symbol_data = hourly_df[hourly_df['symbol'] == symbol].copy()
            symbol_data = symbol_data.sort_values('datetime')

            runup_pct, pm_open, high, details = self.calculate_runup(symbol_data)

            if runup_pct is None:
                logger.warning(f"  {symbol}: Skipped (no data)")
                continue

            result = {
                'symbol': symbol,
                'runup_percent': round(runup_pct, 2),
                'passes_filter': runup_pct >= self.min_runup,
                **details
            }

            results.append(result)

            if result['passes_filter']:
                logger.info(f"  ✓ {symbol}: {runup_pct:.2f}% "
                          f"(${pm_open:.2f} → ${high:.2f} at {details['high_hour']}:00)")
            else:
                logger.debug(f"  ✗ {symbol}: {runup_pct:.2f}% (below {self.min_runup}%)")

        # Filter for winners only
        winners = [r for r in results if r['passes_filter']]

        logger.info(f"\nMomentum Analysis Summary:")
        logger.info(f"  Symbols analyzed: {len(results)}")
        logger.info(f"  Passed {self.min_runup}% threshold: {len(winners)}")
        logger.info(f"  Failed threshold: {len(results) - len(winners)}")

        return results, winners

    def save_results(self, all_results, winners, date_str):
        """
        Save analysis results
        """
        # Save full analysis
        analysis_file = OUTPUT_DIR / f'{date_str}_momentum_analysis.json'

        output = {
            'timestamp': datetime.now().isoformat(),
            'date': date_str,
            'min_runup_threshold': self.min_runup,
            'total_analyzed': len(all_results),
            'total_winners': len(winners),
            'all_symbols': all_results
        }

        with open(analysis_file, 'w') as f:
            json.dump(output, f, indent=2, default=str)

        logger.info(f"✓ Saved analysis: {analysis_file}")

        # Save winners CSV
        if winners:
            winners_file = OUTPUT_DIR / f'{date_str}_winners.csv'

            with open(winners_file, 'w') as f:
                f.write('symbol,runup_percent,premarket_open,highest_high,high_hour\n')
                for w in winners:
                    f.write(f"{w['symbol']},{w['runup_percent']},{w['premarket_open']},{w['highest_high']},{w['high_hour']}\n")

            logger.info(f"✓ Saved winners: {winners_file}")

            return analysis_file, winners_file
        else:
            logger.warning("No winners to save")
            return analysis_file, None

    def run(self, symbols, target_date=None):
        """
        Main execution flow
        """
        logger.info("=" * 70)
        logger.info("STAGE 2: MOMENTUM ANALYZER")
        logger.info("=" * 70)

        if target_date is None:
            target_date = self.get_previous_trading_day()

        date_str = target_date.strftime('%Y%m%d')

        try:
            # Download hourly data
            logger.info(f"\n[1/3] Downloading OHLCV-1h for {len(symbols)} symbols...")
            hourly_df, cost = self.download_hourly_data(symbols, target_date)

            if len(hourly_df) == 0:
                logger.warning("No data received. Market may be closed or symbols invalid.")
                return None, None

            # Analyze momentum
            logger.info(f"\n[2/3] Analyzing momentum...")
            all_results, winners = self.analyze_momentum(hourly_df)

            # Save results
            logger.info(f"\n[3/3] Saving results...")
            analysis_file, winners_file = self.save_results(all_results, winners, date_str)

            logger.info(f"\n{'=' * 70}")
            logger.info(f"✓ STAGE 2 COMPLETE: {len(winners)} momentum winners")
            if cost:
                logger.info(f"  Cost: ${cost:.4f}")
            logger.info(f"{'=' * 70}\n")

            return winners, date_str

        except Exception as e:
            logger.error(f"\n✗ STAGE 2 FAILED: {str(e)}")
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

    # Load candidates from Stage 1
    date_str = datetime.now().strftime('%Y%m%d')
    candidates_file = OUTPUT_DIR / f'{date_str}_candidates.csv'

    if not candidates_file.exists():
        logger.error(f"ERROR: Candidates file not found: {candidates_file}")
        logger.error("Run stock_screener.py (Stage 1) first")
        sys.exit(1)

    # Read candidates
    import csv
    with open(candidates_file) as f:
        reader = csv.DictReader(f)
        symbols = [row['symbol'] for row in reader]

    logger.info(f"Loaded {len(symbols)} candidates from Stage 1")

    # Run analyzer
    analyzer = MomentumAnalyzer(databento_api_key)
    winners, date_str = analyzer.run(symbols)

    if winners is None:
        sys.exit(1)


if __name__ == '__main__':
    main()
