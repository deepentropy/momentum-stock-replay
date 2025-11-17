"""
NBBO Resampler for market data.

Resamples multi-exchange MBP-1 data to fixed time intervals with NBBO calculation
and exchange snapshots.
"""
import pandas as pd
import numpy as np
from pathlib import Path
from typing import Dict, List, Tuple
from datetime import datetime

from .config import Config


class NBBOResampler:
    """Resamples multi-exchange tick data to NBBO at fixed intervals."""

    def __init__(self, interval_ms: int = None):
        """
        Initialize resampler.

        Args:
            interval_ms: Resampling interval in milliseconds (default from config)
        """
        self.interval_ms = interval_ms or Config.NBBO_RESAMPLE_INTERVAL_MS
        self.interval_ns = self.interval_ms * 1_000_000  # Convert to nanoseconds for pandas

    def resample_file(self, parquet_file: Path) -> Tuple[pd.DataFrame, Dict]:
        """
        Resample a single MBP-1 parquet file to NBBO with exchange snapshots.

        Args:
            parquet_file: Path to MBP-1 parquet file

        Returns:
            Tuple of (resampled_df, metadata_dict)
        """
        print(f"Processing {parquet_file.name}...")

        # Read parquet
        df = pd.read_parquet(parquet_file)

        if df.empty:
            print(f"  [WARNING] Empty file, skipping")
            return pd.DataFrame(), {}

        # Convert ts_event to datetime if needed
        if not pd.api.types.is_datetime64_any_dtype(df['ts_event']):
            df['ts_event'] = pd.to_datetime(df['ts_event'], utc=True)
        else:
            df['ts_event'] = pd.to_datetime(df['ts_event'], utc=True)

        # Sort by timestamp
        df = df.sort_values('ts_event').reset_index(drop=True)

        # Get publisher IDs (exchanges) present in data
        publishers = sorted(df['publisher_id'].unique())
        publisher_map = {pub_id: idx for idx, pub_id in enumerate(publishers)}

        original_tick_count = len(df)
        print(f"  Publishers: {publishers}")
        print(f"  Original ticks: {original_tick_count:,}")

        # Create resampling bins
        start_time = df['ts_event'].iloc[0]
        end_time = df['ts_event'].iloc[-1]

        # Create time bins at interval_ms intervals
        bins = pd.date_range(start=start_time.floor(f'{self.interval_ms}ms'),
                            end=end_time.ceil(f'{self.interval_ms}ms'),
                            freq=f'{self.interval_ms}ms')

        print(f"  Time range: {start_time} to {end_time}")
        print(f"  Resampling bins: {len(bins):,}")

        # OPTIMIZED: Use pandas groupby with time bins for vectorized processing
        # Assign each row to a time bin
        df['time_bin'] = pd.cut(df['ts_event'], bins=bins, labels=False, include_lowest=True)

        # Remove rows that don't fall into any bin
        df = df[df['time_bin'].notna()].copy()

        if df.empty:
            print(f"  [WARNING] No data in time bins")
            return pd.DataFrame(), {}

        # Group by time bin and publisher, take last tick in each group
        # This is vectorized and much faster than looping
        grouped = df.groupby(['time_bin', 'publisher_id']).last().reset_index()

        # Prepare columns
        grouped['bid'] = grouped['bid_px_00']
        grouped['ask'] = grouped['ask_px_00']
        grouped['bid_size'] = grouped['bid_sz_00']
        grouped['ask_size'] = grouped['ask_sz_00']

        # Filter out invalid quotes
        grouped = grouped[(grouped['bid'] > 0) & (grouped['ask'] > 0)]

        if grouped.empty:
            print(f"  [WARNING] No valid quotes after filtering")
            return pd.DataFrame(), {}

        # Calculate NBBO per time bin (vectorized)
        # Find best bid (highest) and best ask (lowest) per bin
        def get_best_bid(group):
            idx = group['bid'].idxmax()
            return pd.Series({
                'nbbo_bid': group.loc[idx, 'bid'],
                'nbbo_bid_size': group.loc[idx, 'bid_size'],
                'nbbo_bid_publisher': group.loc[idx, 'publisher_id']
            })

        def get_best_ask(group):
            idx = group['ask'].idxmin()
            return pd.Series({
                'nbbo_ask': group.loc[idx, 'ask'],
                'nbbo_ask_size': group.loc[idx, 'ask_size'],
                'nbbo_ask_publisher': group.loc[idx, 'publisher_id']
            })

        nbbo_bids = grouped.groupby('time_bin', group_keys=False).apply(get_best_bid, include_groups=False)
        nbbo_asks = grouped.groupby('time_bin', group_keys=False).apply(get_best_ask, include_groups=False)

        # Combine NBBO
        nbbo = nbbo_bids.join(nbbo_asks)
        nbbo['timestamp'] = bins[nbbo.index.astype(int)]

        # Pivot exchange data to wide format
        # Create columns: ex_{pub_id}_bid, ex_{pub_id}_ask, etc.
        exchange_data = grouped.pivot_table(
            index='time_bin',
            columns='publisher_id',
            values=['bid', 'ask', 'bid_size', 'ask_size'],
            aggfunc='first'
        )

        # Flatten column names
        exchange_data.columns = [f'ex_{col[1]}_{col[0]}' for col in exchange_data.columns]

        # Combine NBBO with exchange data
        resampled_df = nbbo.join(exchange_data).reset_index(drop=True)

        # Reorder columns: timestamp, NBBO, then exchanges
        nbbo_cols = ['timestamp', 'nbbo_bid', 'nbbo_ask', 'nbbo_bid_size', 'nbbo_ask_size',
                     'nbbo_bid_publisher', 'nbbo_ask_publisher']
        exchange_cols = [col for col in resampled_df.columns if col.startswith('ex_')]
        resampled_df = resampled_df[nbbo_cols + exchange_cols]

        print(f"  Resampled ticks: {len(resampled_df):,}")
        print(f"  Reduction: {100 * (1 - len(resampled_df) / original_tick_count):.1f}%")

        # Metadata
        metadata = {
            'original_ticks': original_tick_count,
            'resampled_ticks': len(resampled_df),
            'reduction_pct': 100 * (1 - len(resampled_df) / original_tick_count),
            'interval_ms': self.interval_ms,
            'publishers': publishers,
            'publisher_map': publisher_map,
            'start_time': start_time.isoformat(),
            'end_time': end_time.isoformat()
        }

        return resampled_df, metadata

    def resample_directory(self, mbp1_dir: Path, date: str, output_dir: Path) -> List[Dict]:
        """
        Resample all MBP-1 files for a given date.

        Args:
            mbp1_dir: Directory containing MBP-1 parquet files
            date: Date string (YYYY-MM-DD)
            output_dir: Output directory for resampled parquet files

        Returns:
            List of metadata dictionaries
        """
        print(f"\n{'='*80}")
        print("Resampling MBP-1 Data to NBBO")
        print(f"{'='*80}\n")
        print(f"Interval: {self.interval_ms}ms")

        date_dir = mbp1_dir / date
        parquet_files = list(date_dir.glob('*_mbp1.parquet'))

        if not parquet_files:
            print(f"[WARNING] No MBP-1 files found in {date_dir}")
            return []

        print(f"Found {len(parquet_files)} files to resample")
        print(f"Output: {output_dir}\n")

        output_path = output_dir / date
        output_path.mkdir(parents=True, exist_ok=True)

        all_metadata = []

        for i, pf in enumerate(parquet_files, 1):
            try:
                print(f"[{i}/{len(parquet_files)}] ", end='')
                resampled_df, metadata = self.resample_file(pf)

                if resampled_df.empty:
                    continue

                # Extract symbol from filename
                filename = pf.stem  # e.g., "CYPH_2025-11-14_mbp1"
                symbol = filename.split('_')[0]

                # Save resampled data
                output_file = output_path / f"{symbol}_{date}_nbbo.parquet"
                resampled_df.to_parquet(output_file, compression='snappy')

                metadata['symbol'] = symbol
                metadata['date'] = date
                metadata['output_file'] = str(output_file)
                all_metadata.append(metadata)

                print()

            except Exception as e:
                print(f"[ERROR] {e}\n")
                import traceback
                traceback.print_exc()

        # Summary
        if all_metadata:
            total_original = sum(m['original_ticks'] for m in all_metadata)
            total_resampled = sum(m['resampled_ticks'] for m in all_metadata)
            avg_reduction = 100 * (1 - total_resampled / total_original)

            print(f"{'='*80}")
            print("RESAMPLING SUMMARY")
            print(f"{'='*80}")
            print(f"Files processed: {len(all_metadata)}")
            print(f"Original ticks: {total_original:,}")
            print(f"Resampled ticks: {total_resampled:,}")
            print(f"Average reduction: {avg_reduction:.1f}%")
            print()

        return all_metadata
