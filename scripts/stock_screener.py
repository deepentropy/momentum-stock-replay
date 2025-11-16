#!/usr/bin/env python3
"""
Stage 1: Fundamental Stock Screener
Fetches fundamentals from private GitHub repo and applies filters
"""

import os
import sys
import json
import logging
import requests
from datetime import datetime, timedelta
from pathlib import Path
import base64

# Setup paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
CONFIG_DIR = PROJECT_DIR / 'config'
OUTPUT_DIR = PROJECT_DIR / 'sessions'
OUTPUT_DIR.mkdir(exist_ok=True)

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class StockScreener:
    def __init__(self, github_token, config_path=None):
        self.github_token = github_token

        # Load configuration
        if config_path is None:
            config_path = CONFIG_DIR / 'pipeline_config.json'

        with open(config_path) as f:
            self.config = json.load(f)

        self.repo_owner = self.config['github']['repo_owner']
        self.repo_name = self.config['github']['repo_name']
        self.data_path = self.config['github']['data_path']
        self.fundamentals_file = self.config['github']['fundamentals_file']

        self.headers = {
            'Authorization': f'token {github_token}',
            'Accept': 'application/vnd.github.v3+json'
        }

    def get_latest_date_folder(self):
        """
        Find the latest yyyy-mm-dd folder in the data/ directory
        Falls back to previous trading days if needed
        """
        url = f'https://api.github.com/repos/{self.repo_owner}/{self.repo_name}/contents/{self.data_path}'

        try:
            response = requests.get(url, headers=self.headers)

            if response.status_code == 404:
                raise Exception(f"Repository or path not found: {self.repo_owner}/{self.repo_name}/{self.data_path}")
            elif response.status_code == 401:
                raise Exception("Authentication failed. Check your GitHub token permissions.")

            response.raise_for_status()
            folders = response.json()

            # Filter for yyyy-mm-dd format folders
            date_folders = []
            for item in folders:
                if item['type'] == 'dir':
                    try:
                        datetime.strptime(item['name'], '%Y-%m-%d')
                        date_folders.append(item['name'])
                    except ValueError:
                        continue

            if not date_folders:
                # Fallback: try last 10 days
                logger.warning("No date folders found, trying recent dates...")
                today = datetime.now()
                for days_back in range(1, 11):
                    check_date = (today - timedelta(days=days_back))
                    # Skip weekends
                    if check_date.weekday() < 5:  # Monday=0, Friday=4
                        date_folders.append(check_date.strftime('%Y-%m-%d'))

            # Sort and get latest
            latest_date = sorted(date_folders, reverse=True)[0]
            logger.info(f"Using fundamentals from: {latest_date}")

            return latest_date

        except Exception as e:
            logger.error(f"Failed to list data folders: {e}")
            raise

    def get_fundamentals(self, date_folder=None):
        """
        Fetch fundamentals.json from specified date folder
        """
        if date_folder is None:
            date_folder = self.get_latest_date_folder()

        url = f'https://api.github.com/repos/{self.repo_owner}/{self.repo_name}/contents/{self.data_path}/{date_folder}/{self.fundamentals_file}'

        try:
            response = requests.get(url, headers=self.headers)
            response.raise_for_status()

            content = response.json()

            # Decode base64 content
            json_data = base64.b64decode(content['content']).decode('utf-8')
            fundamentals = json.loads(json_data)

            logger.info(f"✓ Fetched fundamentals.json ({len(json_data)} bytes)")

            return fundamentals, date_folder

        except Exception as e:
            logger.error(f"Failed to fetch fundamentals: {e}")
            raise

    def filter_symbols(self, fundamentals):
        """
        Apply fundamental filters:
        - Shares Float < max_shares_float
        - Market Cap < max_market_cap
        - Price between min_price and max_price
        """
        filters = self.config['fundamental_filters']

        max_float = filters['max_shares_float']
        max_cap = filters['max_market_cap']
        min_price = filters['min_price']
        max_price = filters['max_price']

        logger.info(f"\nApplying filters:")
        logger.info(f"  Shares Float < {max_float:,.0f}")
        logger.info(f"  Market Cap < ${max_cap:,.0f}")
        logger.info(f"  Price: ${min_price} - ${max_price}")

        symbols_data = fundamentals.get('symbols', [])
        filtered = []
        errors = []

        for i, symbol_data in enumerate(symbols_data):
            try:
                # Extract symbol
                symbol = (
                    symbol_data.get('symbol') or
                    symbol_data.get('ticker') or
                    symbol_data.get('Symbol') or
                    symbol_data.get('Ticker')
                )

                if not symbol:
                    errors.append(f"Row {i}: No symbol found")
                    continue

                # Extract metrics - try multiple field name variations
                shares_float = self._extract_value(symbol_data, [
                    'sharesFloat', 'shares_float', 'float_shares', 'floatShares',
                    'SharesFloat', 'Float', 'float'
                ])

                market_cap = self._extract_value(symbol_data, [
                    'marketCap', 'market_cap', 'mktCap', 'MarketCap',
                    'marketCapitalization', 'cap'
                ])

                price = self._extract_value(symbol_data, [
                    'price', 'currentPrice', 'lastPrice', 'close',
                    'Price', 'LastPrice', 'Close', 'last'
                ])

                # Validate we have all required data
                if shares_float is None or market_cap is None or price is None:
                    errors.append(f"{symbol}: Missing data (float={shares_float}, cap={market_cap}, price={price})")
                    continue

                # Apply filters
                if (shares_float < max_float and
                    market_cap < max_cap and
                    min_price <= price <= max_price):

                    filtered.append({
                        'symbol': symbol,
                        'sharesFloat': float(shares_float),
                        'marketCap': float(market_cap),
                        'price': float(price)
                    })

            except Exception as e:
                errors.append(f"{symbol if 'symbol' in locals() else f'Row {i}'}: {str(e)}")
                continue

        # Log summary
        logger.info(f"\nFiltering Results:")
        logger.info(f"  Total processed: {len(symbols_data)}")
        logger.info(f"  Passed filters: {len(filtered)}")
        logger.info(f"  Errors/skipped: {len(errors)}")

        if errors and len(errors) <= 10:
            logger.warning(f"\nFirst errors:")
            for error in errors[:10]:
                logger.warning(f"  - {error}")

        return filtered

    def _extract_value(self, data, field_names):
        """
        Try multiple field name variations
        Convert strings to numbers if needed
        """
        for field in field_names:
            value = data.get(field)
            if value is not None:
                # Convert to number if string
                if isinstance(value, str):
                    # Remove commas, dollar signs, etc
                    value = value.replace(',', '').replace('$', '').strip()
                    try:
                        value = float(value)
                    except ValueError:
                        continue
                return value
        return None

    def save_results(self, candidates, date_str):
        """
        Save filtered candidates to CSV and JSON
        """
        # Save as CSV
        csv_file = OUTPUT_DIR / f'{date_str}_candidates.csv'

        with open(csv_file, 'w') as f:
            f.write('symbol,sharesFloat,marketCap,price\n')
            for item in candidates:
                f.write(f"{item['symbol']},{item['sharesFloat']},{item['marketCap']},{item['price']}\n')

        logger.info(f"✓ Saved candidates CSV: {csv_file}")

        # Save as JSON with metadata
        json_file = OUTPUT_DIR / f'{date_str}_fundamentals_screened.json'

        output = {
            'timestamp': datetime.now().isoformat(),
            'date': date_str,
            'filters_applied': self.config['fundamental_filters'],
            'total_candidates': len(candidates),
            'candidates': candidates
        }

        with open(json_file, 'w') as f:
            json.dump(output, f, indent=2)

        logger.info(f"✓ Saved metadata JSON: {json_file}")

        return csv_file, json_file

    def run(self):
        """
        Main execution flow
        """
        logger.info("=" * 70)
        logger.info("STAGE 1: FUNDAMENTAL STOCK SCREENER")
        logger.info("=" * 70)

        try:
            # Fetch fundamentals
            logger.info("\n[1/3] Fetching fundamentals from GitHub...")
            fundamentals, date_str = self.get_fundamentals()

            # Filter symbols
            logger.info("\n[2/3] Applying fundamental filters...")
            candidates = self.filter_symbols(fundamentals)

            if len(candidates) == 0:
                logger.error("✗ No symbols passed the filters!")
                return None, None

            # Save results
            logger.info("\n[3/3] Saving results...")
            csv_file, json_file = self.save_results(candidates, date_str)

            # Show sample
            logger.info(f"\nSample filtered symbols (first 10):")
            for item in candidates[:10]:
                logger.info(f"  {item['symbol']}: "
                          f"Float={item['sharesFloat']:,.0f}, "
                          f"Cap=${item['marketCap']:,.0f}, "
                          f"Price=${item['price']:.2f}")

            if len(candidates) > 10:
                logger.info(f"  ... and {len(candidates) - 10} more")

            logger.info(f"\n{'=' * 70}")
            logger.info(f"✓ STAGE 1 COMPLETE: {len(candidates)} symbols ready for Stage 2")
            logger.info(f"{'=' * 70}\n")

            return candidates, date_str

        except Exception as e:
            logger.error(f"\n✗ STAGE 1 FAILED: {str(e)}")
            import traceback
            traceback.print_exc()
            return None, None


def main():
    """
    Standalone execution
    """
    # Get GitHub token from environment
    github_token = os.getenv('GITHUB_TOKEN')

    if not github_token:
        logger.error("ERROR: GITHUB_TOKEN environment variable not set")
        logger.error("Set it with: export GITHUB_TOKEN='your-token-here'")
        sys.exit(1)

    # Run screener
    screener = StockScreener(github_token)
    candidates, date_str = screener.run()

    if candidates is None:
        sys.exit(1)

    # Output symbols for next stage
    symbols = [c['symbol'] for c in candidates]
    logger.info(f"Symbols for Stage 2: {','.join(symbols[:20])}" + ("..." if len(symbols) > 20 else ""))


if __name__ == '__main__':
    main()
