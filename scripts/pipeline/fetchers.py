"""
Data fetchers for fundamentals and market data.
"""
import json
import requests
from pathlib import Path
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import pandas as pd
import databento as db

from .config import Config
from .models import StockFundamentals


class FundamentalsFetcher:
    """Fetches fundamental data from GitHub repository."""

    def __init__(self, token: Optional[str] = None):
        self.token = token or Config.STOCKFUNDAMENTALS_PAT
        self.headers = {}
        if self.token:
            self.headers['Authorization'] = f'token {self.token}'

    def fetch_latest(self) -> Dict:
        """Fetch latest fundamentals from GitHub."""
        print(f"\n{'='*80}")
        print("Fetching Fundamentals from GitHub")
        print(f"{'='*80}\n")

        # Get latest date folder
        api_url = f"https://api.github.com/repos/{Config.FUNDAMENTALS_REPO}/contents/{Config.FUNDAMENTALS_PATH}"
        response = requests.get(api_url, headers=self.headers)
        response.raise_for_status()

        folders = [item for item in response.json() if item['type'] == 'dir']
        if not folders:
            raise ValueError("No date folders found")

        latest_folder = sorted(folders, key=lambda x: x['name'])[-1]
        date_str = latest_folder['name']

        # Fetch fundamentals.json from latest folder
        file_url = f"https://api.github.com/repos/{Config.FUNDAMENTALS_REPO}/contents/{Config.FUNDAMENTALS_PATH}/{date_str}/fundamentals.json"
        response = requests.get(file_url, headers=self.headers)
        response.raise_for_status()

        download_url = response.json()['download_url']
        response = requests.get(download_url, headers=self.headers)
        response.raise_for_status()

        data = response.json()
        print(f"[SUCCESS] Fetched fundamentals for {date_str}")
        print(f"  Total tickers: {len(data.get('tickers', []))}")

        return data

    def filter_stocks(
        self,
        data: Dict,
        max_float: float = Config.MAX_SHARE_FLOAT,
        max_market_cap: float = Config.MAX_MARKET_CAP,
        min_price: float = Config.MIN_PRICE,
        max_price: float = Config.MAX_PRICE
    ) -> List[StockFundamentals]:
        """Filter stocks by criteria."""
        print(f"\n{'='*80}")
        print("Filtering Stocks")
        print(f"{'='*80}\n")
        print(f"Criteria:")
        print(f"  Share Float < {max_float:,}")
        print(f"  Market Cap < ${max_market_cap:,}")
        print(f"  Price: ${min_price} - ${max_price}")

        filtered = []
        for ticker in data.get('tickers', []):
            fundamentals = ticker.get('fundamentals', {})

            # Check share float
            shs_float = fundamentals.get('Shs Float')
            if shs_float is None or shs_float >= max_float:
                continue

            # Check market cap
            market_cap = fundamentals.get('Market Cap')
            if market_cap is None or market_cap >= max_market_cap:
                continue

            # Check price
            price = fundamentals.get('Price')
            if price is None or price < min_price or price > max_price:
                continue

            stock = StockFundamentals(
                symbol=ticker['symbol'],
                market_cap=market_cap,
                share_float=shs_float,
                price=price,
                company_name=ticker.get('company_info', {}).get('name'),
                exchange=ticker.get('company_info', {}).get('exchange'),
                raw_data=ticker
            )
            filtered.append(stock)

        print(f"\n[SUCCESS] Filtered: {len(filtered)} stocks (from {len(data.get('tickers', []))})")
        return filtered


class DatabentoFetcher:
    """Fetches market data from Databento."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or Config.DATABENTO_API_KEY
        if not self.api_key:
            raise ValueError("DATABENTO_API_KEY not found")
        self.client = db.Historical(self.api_key)

    def fetch_ohlcv_batch(
        self,
        symbols: List[str],
        date: str,
        dataset: str = Config.DATABENTO_DATASET
    ) -> pd.DataFrame:
        """Fetch 1-hour OHLCV data for multiple symbols in batch."""
        print(f"\n{'='*80}")
        print("Fetching 1-Hour OHLCV Data (Batch)")
        print(f"{'='*80}\n")
        print(f"Symbols: {len(symbols)}")
        print(f"Date: {date}")
        print(f"Dataset: {dataset}")

        # Calculate date range
        start_date = datetime.strptime(date, '%Y-%m-%d')
        end_date = start_date + timedelta(days=1)
        end_date_str = end_date.strftime('%Y-%m-%d')

        # Fetch data
        data = self.client.timeseries.get_range(
            dataset=dataset,
            symbols=symbols,
            schema='ohlcv-1h',
            start=date,
            end=end_date_str,
            stype_in='raw_symbol',
        )

        df = data.to_df()
        print(f"[SUCCESS] Received {len(df):,} bars")
        return df

    def fetch_mbp1_batch(
        self,
        symbols: List[str],
        date: str,
        output_dir: Path,
        dataset: str = Config.DATABENTO_DATASET
    ) -> Dict[str, pd.DataFrame]:
        """Fetch MBP-1 tick data for multiple symbols in batch (single dataset)."""
        print(f"\n{'='*80}")
        print("Fetching MBP-1 Tick Data (Batch)")
        print(f"{'='*80}\n")
        print(f"Symbols: {len(symbols)}")
        print(f"Date: {date}")
        print(f"Dataset: {dataset}")
        print(f"WARNING: MBP-1 is tick-by-tick quote data. Monitor API usage!")

        # Calculate date range
        start_date = datetime.strptime(date, '%Y-%m-%d')
        end_date = start_date + timedelta(days=1)
        end_date_str = end_date.strftime('%Y-%m-%d')

        # Create output directory
        output_path = output_dir / date
        output_path.mkdir(parents=True, exist_ok=True)

        # Fetch data
        data = self.client.timeseries.get_range(
            dataset=dataset,
            symbols=symbols,
            schema='mbp-1',
            start=date,
            end=end_date_str,
            stype_in='raw_symbol',
        )

        df_all = data.to_df()

        if df_all.empty:
            print("[WARNING] No MBP-1 data returned")
            return {}

        print(f"[SUCCESS] Received {len(df_all):,} quote updates")

        # Split by symbol and save
        results = {}
        if 'symbol' in df_all.columns:
            symbols_in_data = df_all['symbol'].unique()

            for symbol in symbols_in_data:
                df_symbol = df_all[df_all['symbol'] == symbol].copy()
                if not df_symbol.empty:
                    results[symbol] = df_symbol

                    # Save parquet file
                    parquet_file = output_path / f"{symbol}_{date}_mbp1.parquet"
                    df_symbol.to_parquet(parquet_file, compression='snappy')
                    file_size_mb = parquet_file.stat().st_size / (1024 * 1024)
                    print(f"  {symbol}: {len(df_symbol):,} quotes, {file_size_mb:.2f} MB")

        print(f"\n[SUCCESS] Saved {len(results)} symbol files to {output_path}")
        return results

    def fetch_mbp1_multi_exchange(
        self,
        symbols: List[str],
        date: str,
        output_dir: Path,
        datasets: List[str] = None
    ) -> Dict[str, pd.DataFrame]:
        """
        Fetch MBP-1 tick data from MULTIPLE exchanges, preserving individual exchange data.

        This queries each exchange dataset separately and combines them, so you get
        top-of-book from each exchange with their individual publisher_ids.

        Args:
            symbols: List of symbols to fetch
            date: Date string (YYYY-MM-DD)
            output_dir: Directory to save parquet files
            datasets: List of dataset IDs to query (default: Config.DATABENTO_DATASETS_MBP1)

        Returns:
            Dict mapping symbol to combined DataFrame with all exchanges
        """
        if datasets is None:
            datasets = Config.DATABENTO_DATASETS_MBP1

        print(f"\n{'='*80}")
        print("Fetching MBP-1 Tick Data from MULTIPLE EXCHANGES")
        print(f"{'='*80}\n")
        print(f"Symbols: {len(symbols)}")
        print(f"Date: {date}")
        print(f"Exchanges: {len(datasets)}")
        for ds in datasets:
            print(f"  - {ds}")
        print(f"\nWARNING: Querying {len(datasets)} exchanges will use {len(datasets)}x API credits!")

        # Calculate date range
        start_date = datetime.strptime(date, '%Y-%m-%d')
        end_date = start_date + timedelta(days=1)
        end_date_str = end_date.strftime('%Y-%m-%d')

        # Create output directory
        output_path = output_dir / date
        output_path.mkdir(parents=True, exist_ok=True)

        # Storage for combined data
        all_results = {}

        # Query each exchange
        for i, dataset in enumerate(datasets, 1):
            print(f"\n[{i}/{len(datasets)}] Querying {dataset}...")

            try:
                data = self.client.timeseries.get_range(
                    dataset=dataset,
                    symbols=symbols,
                    schema='mbp-1',
                    start=date,
                    end=end_date_str,
                    stype_in='raw_symbol',
                )

                df = data.to_df()

                if df.empty:
                    print(f"  [WARNING] No data from {dataset}")
                    continue

                print(f"  [SUCCESS] {len(df):,} quotes from {dataset}")

                # Get publisher_id for this dataset
                if 'publisher_id' in df.columns and not df.empty:
                    pub_ids = df['publisher_id'].unique()
                    print(f"  Publisher IDs: {pub_ids}")

                # Combine by symbol
                if 'symbol' in df.columns:
                    for symbol in df['symbol'].unique():
                        df_symbol = df[df['symbol'] == symbol].copy()

                        if symbol in all_results:
                            # Append to existing data
                            all_results[symbol] = pd.concat([
                                all_results[symbol],
                                df_symbol
                            ], ignore_index=True)
                        else:
                            all_results[symbol] = df_symbol

            except Exception as e:
                print(f"  [ERROR] Failed to fetch from {dataset}: {e}")
                continue

        # Sort and save combined results
        print(f"\n{'='*80}")
        print("Combining and Saving Multi-Exchange Data")
        print(f"{'='*80}\n")

        for symbol, df_symbol in all_results.items():
            # Sort by timestamp
            df_symbol = df_symbol.sort_values('ts_event').reset_index(drop=True)
            all_results[symbol] = df_symbol

            # Save parquet file
            parquet_file = output_path / f"{symbol}_{date}_mbp1.parquet"
            df_symbol.to_parquet(parquet_file, compression='snappy')

            file_size_mb = parquet_file.stat().st_size / (1024 * 1024)

            # Show exchange breakdown
            if 'publisher_id' in df_symbol.columns:
                exchange_counts = df_symbol['publisher_id'].value_counts().to_dict()
                exchanges_str = ', '.join([f"pub_{k}:{v}" for k, v in sorted(exchange_counts.items())])
                print(f"  {symbol}: {len(df_symbol):,} quotes, {file_size_mb:.2f} MB")
                print(f"    Exchanges: {exchanges_str}")
            else:
                print(f"  {symbol}: {len(df_symbol):,} quotes, {file_size_mb:.2f} MB")

        print(f"\n[SUCCESS] Saved {len(all_results)} symbols with multi-exchange data to {output_path}")
        return all_results
