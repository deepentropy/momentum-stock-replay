"""
Process missing sessions from sessions.csv

This script reads session definitions from sessions/sessions.csv and fetches
MBP-1 data for sessions that are missing binary files.

Assumes one session per symbol per day.

Usage:
    python script/get_sessions.py
"""

import sys
import os
import gzip
import struct
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, Tuple, Optional
import pandas as pd
import databento as db


# ============================================================================
# Configuration
# ============================================================================

class Config:
    """Global configuration."""

    DATABENTO_API_KEY: Optional[str] = os.environ.get('DATABENTO_API_KEY')

    # Multi-exchange datasets for MBP-1
    DATABENTO_DATASETS_MBP1 = [
        'XNAS.ITCH',     # NASDAQ
        'XNYS.PILLAR',   # NYSE
        'IEXG.TOPS',     # IEX
        'ARCX.PILLAR',   # NYSE Arca
        'BATS.PITCH',    # Cboe BZX
        'XBOS.ITCH',     # NASDAQ BX
        'XPSX.ITCH',     # NASDAQ PSX
    ]
    
    # Dataset to Publisher ID mapping (Databento standard IDs)
    # Databento's raw data uses venue-specific publisher IDs, so we need to map them
    # to the standard consolidated feed publisher IDs for consistency
    DATASET_TO_PUBLISHER_ID = {
        'XNAS.ITCH': 1,    # NASDAQ
        'XNYS.PILLAR': 2,  # NYSE
        'ARCX.PILLAR': 3,  # NYSE Arca
        'BATS.PITCH': 4,   # Cboe BZX (formerly BATS)
        'IEXG.TOPS': 5,    # IEX
        'XBOS.ITCH': 6,    # NASDAQ BX (Boston)
        'BATY.PITCH': 9,   # Cboe BYX (formerly BATS Y)
        'EDGA.PITCH': 38,  # Cboe EDGA
        'XPSX.ITCH': 43,   # NASDAQ PSX
    }

    # Compression Settings
    PRICE_SCALE = 100_000
    SIZE_SCALE = 100
    TIME_UNIT = 1_000_000
    GZIP_LEVEL = 9

    # NBBO Resampling
    NBBO_RESAMPLE_INTERVAL_MS = 100

    # Binary Format
    BINARY_MAGIC = b'TICK'
    BINARY_VERSION_V3 = 3

    # Directory Structure
    BASE_DIR = Path(__file__).parent.parent
    TEMP_DIR = BASE_DIR / ".pipeline_temp"
    DATA_DIR_MBP1 = TEMP_DIR / "databento_mbp1_data"
    DATA_DIR_NBBO = TEMP_DIR / "databento_nbbo_data"
    SESSIONS_DIR = BASE_DIR / "sessions"

    @classmethod
    def setup_directories(cls):
        """Create necessary directories."""
        for directory in [
            cls.TEMP_DIR,
            cls.DATA_DIR_MBP1,
            cls.DATA_DIR_NBBO,
            cls.SESSIONS_DIR
        ]:
            directory.mkdir(parents=True, exist_ok=True)

    @classmethod
    def cleanup_temp(cls):
        """Clean up temporary directory."""
        if cls.TEMP_DIR.exists():
            shutil.rmtree(cls.TEMP_DIR)
            print(f"[CLEANUP] Removed temporary directory: {cls.TEMP_DIR}")


SESSIONS_CSV = Config.SESSIONS_DIR / "sessions.csv"


# ============================================================================
# Data Fetcher
# ============================================================================

class DatabentoFetcher:
    """Fetches market data from Databento."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or Config.DATABENTO_API_KEY
        if not self.api_key:
            raise ValueError("DATABENTO_API_KEY not found")
        self.client = db.Historical(self.api_key)


# ============================================================================
# NBBO Resampler
# ============================================================================

class NBBOResampler:
    """Resamples multi-exchange tick data to NBBO at fixed intervals."""

    def __init__(self, interval_ms: int = None):
        self.interval_ms = interval_ms or Config.NBBO_RESAMPLE_INTERVAL_MS

    def resample_file(self, parquet_file: Path) -> Tuple[pd.DataFrame, Dict]:
        """Resample a single MBP-1 parquet file to NBBO with exchange snapshots."""
        print(f"Processing {parquet_file.name}...")

        df = pd.read_parquet(parquet_file)

        if df.empty:
            print(f"  [WARNING] Empty file, skipping")
            return pd.DataFrame(), {}

        if not pd.api.types.is_datetime64_any_dtype(df['ts_event']):
            df['ts_event'] = pd.to_datetime(df['ts_event'], utc=True)
        else:
            df['ts_event'] = pd.to_datetime(df['ts_event'], utc=True)

        df = df.sort_values('ts_event').reset_index(drop=True)

        publishers = sorted(df['publisher_id'].unique())
        publisher_map = {pub_id: idx for idx, pub_id in enumerate(publishers)}

        original_tick_count = len(df)
        print(f"  Publishers: {publishers}")
        print(f"  Original ticks: {original_tick_count:,}")

        start_time = df['ts_event'].iloc[0]
        end_time = df['ts_event'].iloc[-1]

        bins = pd.date_range(start=start_time.floor(f'{self.interval_ms}ms'),
                            end=end_time.ceil(f'{self.interval_ms}ms'),
                            freq=f'{self.interval_ms}ms')

        print(f"  Time range: {start_time} to {end_time}")
        print(f"  Resampling bins: {len(bins):,}")

        df['time_bin'] = pd.cut(df['ts_event'], bins=bins, labels=False, include_lowest=True)
        df = df[df['time_bin'].notna()].copy()

        if df.empty:
            print(f"  [WARNING] No data in time bins")
            return pd.DataFrame(), {}

        grouped = df.groupby(['time_bin', 'publisher_id']).last().reset_index()

        grouped['bid'] = grouped['bid_px_00']
        grouped['ask'] = grouped['ask_px_00']
        grouped['bid_size'] = grouped['bid_sz_00']
        grouped['ask_size'] = grouped['ask_sz_00']

        grouped = grouped[(grouped['bid'] > 0) & (grouped['ask'] > 0)]

        if grouped.empty:
            print(f"  [WARNING] No valid quotes after filtering")
            return pd.DataFrame(), {}

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

        nbbo = nbbo_bids.join(nbbo_asks)
        nbbo['timestamp'] = bins[nbbo.index.astype(int)]

        exchange_data = grouped.pivot_table(
            index='time_bin',
            columns='publisher_id',
            values=['bid', 'ask', 'bid_size', 'ask_size'],
            aggfunc='first'
        )

        exchange_data.columns = [f'ex_{col[1]}_{col[0]}' for col in exchange_data.columns]

        resampled_df = nbbo.join(exchange_data).reset_index(drop=True)

        nbbo_cols = ['timestamp', 'nbbo_bid', 'nbbo_ask', 'nbbo_bid_size', 'nbbo_ask_size',
                     'nbbo_bid_publisher', 'nbbo_ask_publisher']
        exchange_cols = [col for col in resampled_df.columns if col.startswith('ex_')]
        resampled_df = resampled_df[nbbo_cols + exchange_cols]

        print(f"  Resampled ticks: {len(resampled_df):,}")
        print(f"  Reduction: {100 * (1 - len(resampled_df) / original_tick_count):.1f}%")

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


# ============================================================================
# Binary Compressor
# ============================================================================

class NBBOBinaryCompressor:
    """Compresses NBBO resampled data to custom binary format (Version 3)."""

    def __init__(self):
        self.price_scale = Config.PRICE_SCALE
        self.size_scale = Config.SIZE_SCALE
        self.time_unit = Config.TIME_UNIT

    def compress_file(self, parquet_file: Path, output_dir: Path, publisher_map: dict) -> Dict:
        """Compress a single NBBO parquet file to binary format Version 3."""
        df = pd.read_parquet(parquet_file)

        if df.empty:
            raise ValueError("Empty DataFrame")

        df = df.sort_values('timestamp').reset_index(drop=True)

        t0 = df['timestamp'].iloc[0]
        initial_timestamp_us = int(t0.timestamp() * self.time_unit)

        publisher_map_str = ','.join([f"{idx}:{pub_id}" for pub_id, idx in publisher_map.items()])
        publisher_map_bytes = publisher_map_str.encode('utf-8')

        publisher_id_to_idx = {pub_id: idx for pub_id, idx in publisher_map.items()}

        num_samples = len(df)
        buffer = bytearray()

        header = struct.pack(
            '<4sHHIQ',
            Config.BINARY_MAGIC,
            Config.BINARY_VERSION_V3,
            Config.NBBO_RESAMPLE_INTERVAL_MS,
            num_samples,
            initial_timestamp_us
        )
        buffer.extend(header)

        buffer.extend(struct.pack('<H', len(publisher_map_bytes)))
        buffer.extend(publisher_map_bytes)

        prev_timestamp_ms = int(t0.timestamp() * 1000)

        for i in range(num_samples):
            row = df.iloc[i]

            current_timestamp_ms = int(row['timestamp'].timestamp() * 1000)
            time_delta_ms = current_timestamp_ms - prev_timestamp_ms
            prev_timestamp_ms = current_timestamp_ms

            nbbo_bid = int(row['nbbo_bid'] * self.price_scale)
            nbbo_ask = int(row['nbbo_ask'] * self.price_scale)
            nbbo_bid_size = int(row['nbbo_bid_size'] * self.size_scale)
            nbbo_ask_size = int(row['nbbo_ask_size'] * self.size_scale)
            best_bid_pub = publisher_id_to_idx.get(row['nbbo_bid_publisher'], 0)
            best_ask_pub = publisher_id_to_idx.get(row['nbbo_ask_publisher'], 0)

            nbbo_data = struct.pack(
                '<iiiiiBB',
                time_delta_ms,
                nbbo_bid,
                nbbo_ask,
                nbbo_bid_size,
                nbbo_ask_size,
                best_bid_pub,
                best_ask_pub
            )
            buffer.extend(nbbo_data)

            exchanges_data = []
            for pub_id, pub_idx in publisher_map.items():
                bid_col = f'ex_{pub_id}_bid'
                ask_col = f'ex_{pub_id}_ask'
                bid_size_col = f'ex_{pub_id}_bid_size'
                ask_size_col = f'ex_{pub_id}_ask_size'

                if bid_col in row.index and not pd.isna(row[bid_col]):
                    bid = int(row[bid_col] * self.price_scale)
                    ask = int(row[ask_col] * self.price_scale)
                    bid_size = int(row[bid_size_col] * self.size_scale)
                    ask_size = int(row[ask_size_col] * self.size_scale)

                    exchanges_data.append((pub_idx, bid, ask, bid_size, ask_size))

            buffer.extend(struct.pack('<B', len(exchanges_data)))

            for pub_idx, bid, ask, bid_size, ask_size in exchanges_data:
                exchange_data = struct.pack(
                    '<BiiII',
                    pub_idx,
                    bid,
                    ask,
                    bid_size,
                    ask_size
                )
                buffer.extend(exchange_data)

        compressed = gzip.compress(bytes(buffer), compresslevel=Config.GZIP_LEVEL)

        filename = parquet_file.stem
        symbol = filename.split('_')[0]
        date_str = filename.split('_')[1].replace('-', '')

        output_dir.mkdir(parents=True, exist_ok=True)
        dest_file = output_dir / f"{symbol}-{date_str}.bin.gz"

        with open(dest_file, 'wb') as f:
            f.write(compressed)

        stats = {
            'symbol': symbol,
            'date': date_str,
            'input_file': str(parquet_file),
            'output_file': str(dest_file),
            'num_rows': num_samples,
            'original_size_mb': len(buffer) / (1024 * 1024),
            'compressed_size_mb': len(compressed) / (1024 * 1024),
            'compression_ratio': len(buffer) / len(compressed),
            'compression_pct': (len(compressed) / len(buffer)) * 100
        }

        return stats


# ============================================================================
# Session Processing Functions
# ============================================================================

def load_sessions():
    """Load sessions from CSV file."""
    print(f"\n{'='*80}")
    print("Loading Sessions")
    print(f"{'='*80}\n")
    print(f"Reading: {SESSIONS_CSV}")
    
    if not SESSIONS_CSV.exists():
        print(f"[ERROR] File not found: {SESSIONS_CSV}")
        sys.exit(1)
    
    # Read CSV with date as string (not parsed as datetime)
    df = pd.read_csv(SESSIONS_CSV, skipinitialspace=True, dtype={'date': str})
    df.columns = df.columns.str.strip()
    
    # Strip whitespace from all string columns
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].str.strip()
    
    print(f"Loaded {len(df)} sessions")
    print(f"Columns: {list(df.columns)}")
    
    # Debug: show first row
    if len(df) > 0:
        first_row = df.iloc[0]
        print(f"First row: symbol='{first_row['symbol']}' (type={type(first_row['symbol'])}), date='{first_row['date']}' (type={type(first_row['date'])})")
        print(f"  Date repr: {repr(first_row['date'])}")
    
    return df


def get_existing_sessions():
    """Get list of existing session binary files."""
    print(f"\nScanning for existing binary files in {Config.SESSIONS_DIR}...")
    
    existing = set()
    for bin_file in Config.SESSIONS_DIR.glob("*.bin.gz"):
        # Extract symbol and date from filename (e.g., "AMIX-20251117.bin.gz")
        parts = bin_file.stem.split('-')
        if len(parts) == 2:
            symbol = parts[0]
            date_str = parts[1]
            # Convert YYYYMMDD to YYYY-MM-DD
            date_formatted = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
            print(f"  Found: {bin_file.name} -> symbol='{symbol}', date_str='{date_str}', date_formatted='{date_formatted}'")
            existing.add((symbol, date_formatted))
    
    print(f"Found {len(existing)} existing sessions: {existing}")
    return existing


def find_missing_sessions(sessions_df, existing):
    """Find sessions that don't have binary files yet."""
    missing = []
    
    print(f"\nComparing sessions with existing files...")
    print(f"Existing sessions: {existing}")
    
    for _, row in sessions_df.iterrows():
        symbol = str(row['symbol']).strip()
        date = str(row['date']).strip()
        
        # Debug each comparison
        is_existing = (symbol, date) in existing
        print(f"  Checking: symbol='{symbol}' (len={len(symbol)}), date='{date}' (len={len(date)}), exists={is_existing}")
        
        # Debug: show repr to see any hidden characters
        if not is_existing and len(existing) > 0:
            print(f"    repr: ({repr(symbol)}, {repr(date)})")
            for ex_symbol, ex_date in existing:
                print(f"    vs: ({repr(ex_symbol)}, {repr(ex_date)})")
        
        if not is_existing:
            missing.append(row)
    
    return missing


def fetch_mbp1_multi_exchange(fetcher, symbol, start_date, end_date, output_dir):
    """Fetch MBP-1 data from multiple exchanges."""
    print(f"\n{'='*80}")
    print("Fetching MBP-1 Data (Multi-Exchange)")
    print(f"{'='*80}\n")
    print(f"Symbol: {symbol}")
    print(f"Start: {start_date}")
    print(f"End: {end_date}")
    print(f"Exchanges: {len(Config.DATABENTO_DATASETS_MBP1)}")
    for ds in Config.DATABENTO_DATASETS_MBP1:
        print(f"  - {ds}")

    start_str = start_date.strftime('%Y-%m-%d')

    output_path = output_dir / start_str
    output_path.mkdir(parents=True, exist_ok=True)

    all_data = []

    for i, dataset in enumerate(Config.DATABENTO_DATASETS_MBP1, 1):
        print(f"\n[{i}/{len(Config.DATABENTO_DATASETS_MBP1)}] Querying {dataset}...")

        try:
            data = fetcher.client.timeseries.get_range(
                dataset=dataset,
                symbols=[symbol],
                schema='mbp-1',
                start=start_date.isoformat(),
                end=end_date.isoformat(),
                stype_in='raw_symbol',
            )

            df = data.to_df()

            if df.empty:
                print(f"  [WARNING] No data from {dataset}")
                continue

            print(f"  [SUCCESS] {len(df):,} quotes from {dataset}")

            if 'publisher_id' in df.columns and not df.empty:
                pub_ids_original = df['publisher_id'].unique()
                print(f"  Original Publisher IDs: {pub_ids_original}")
                
                # Remap to standard Databento publisher IDs
                if dataset in Config.DATASET_TO_PUBLISHER_ID:
                    correct_pub_id = Config.DATASET_TO_PUBLISHER_ID[dataset]
                    df['publisher_id'] = correct_pub_id
                    print(f"  Remapped to Publisher ID: {correct_pub_id}")
                else:
                    print(f"  [WARNING] No mapping found for {dataset}, keeping original IDs")

            all_data.append(df)

        except Exception as e:
            print(f"  [ERROR] Failed to fetch from {dataset}: {e}")
            continue

    if not all_data:
        print("\n[ERROR] No data retrieved from any exchange")
        return None

    print(f"\n{'='*80}")
    print("Combining Multi-Exchange Data")
    print(f"{'='*80}\n")

    df_combined = pd.concat(all_data, ignore_index=True)
    df_combined = df_combined.sort_values('ts_event').reset_index(drop=True)

    print(f"Total quotes: {len(df_combined):,}")

    if 'publisher_id' in df_combined.columns:
        exchange_counts = df_combined['publisher_id'].value_counts().to_dict()
        print("\nQuotes per exchange:")
        for pub_id, count in sorted(exchange_counts.items()):
            print(f"  Publisher {pub_id}: {count:,}")

    parquet_file = output_path / f"{symbol}_{start_str}_mbp1.parquet"
    df_combined.to_parquet(parquet_file, compression='snappy')

    file_size_mb = parquet_file.stat().st_size / (1024 * 1024)
    print(f"\nSaved: {parquet_file}")
    print(f"Size: {file_size_mb:.2f} MB")

    return parquet_file


def resample_to_nbbo(parquet_file, output_dir):
    """Resample MBP-1 data to NBBO."""
    print(f"\n{'='*80}")
    print("Resampling to NBBO")
    print(f"{'='*80}\n")

    resampler = NBBOResampler()
    resampled_df, metadata = resampler.resample_file(parquet_file)

    if resampled_df.empty:
        print("[ERROR] Resampling failed - no data")
        return None

    filename = parquet_file.stem
    parts = filename.split('_')
    symbol = parts[0]
    date_str = parts[1]

    output_path = output_dir / date_str
    output_path.mkdir(parents=True, exist_ok=True)

    nbbo_file = output_path / f"{symbol}_{date_str}_nbbo.parquet"
    resampled_df.to_parquet(nbbo_file, compression='snappy')

    print(f"Saved: {nbbo_file}")
    print(f"Samples: {len(resampled_df):,}")

    return nbbo_file


def compress_nbbo(nbbo_file, output_dir):
    """Compress NBBO data to binary format."""
    print(f"\n{'='*80}")
    print("Compressing to Binary Format")
    print(f"{'='*80}\n")

    df = pd.read_parquet(nbbo_file)
    if df.empty:
        print("[ERROR] Empty NBBO file")
        return None

    publishers = []
    for col in df.columns:
        if col.startswith('ex_') and col.endswith('_bid'):
            pub_id = int(col.split('_')[1])
            if pub_id not in publishers:
                publishers.append(pub_id)

    publishers.sort()
    publisher_map = {pub_id: idx for idx, pub_id in enumerate(publishers)}

    print(f"Publishers: {publishers}")
    print(f"Publisher map: {publisher_map}")

    compressor = NBBOBinaryCompressor()
    stats = compressor.compress_file(nbbo_file, output_dir, publisher_map)

    print(f"\nCompression Results:")
    print(f"  Input: {stats['input_file']}")
    print(f"  Output: {stats['output_file']}")
    print(f"  Samples: {stats['num_rows']:,}")
    print(f"  Original size: {stats['original_size_mb']:.2f} MB")
    print(f"  Compressed size: {stats['compressed_size_mb']:.2f} MB")
    print(f"  Compression ratio: {stats['compression_ratio']:.2f}x")
    print(f"  Space saved: {100 - stats['compression_pct']:.1f}%")

    return Path(stats['output_file'])


def process_session(session, fetcher):
    """Process a single session - fetch, resample, and compress."""
    symbol = session['symbol']
    date_str = session['date']
    start_time = session['start_time']
    end_time = session['end_time']
    
    # Parse date and times
    date = datetime.strptime(date_str, '%Y-%m-%d')
    start_dt = datetime.strptime(f"{date_str} {start_time}", '%Y-%m-%d %H:%M:%S')
    end_dt = datetime.strptime(f"{date_str} {end_time}", '%Y-%m-%d %H:%M:%S')
    
    print(f"\n{'='*80}")
    print(f"Processing: {symbol} on {date_str}")
    print(f"{'='*80}\n")
    print(f"Time range: {start_time} - {end_time}")
    
    try:
        # Step 1: Fetch MBP-1 data
        parquet_file = fetch_mbp1_multi_exchange(
            fetcher, symbol, start_dt, end_dt, Config.DATA_DIR_MBP1
        )
        
        if parquet_file is None:
            print(f"\n[ERROR] Failed to fetch MBP-1 data for {symbol}")
            return False
        
        # Step 2: Resample to NBBO
        nbbo_file = resample_to_nbbo(parquet_file, Config.DATA_DIR_NBBO)
        
        if nbbo_file is None:
            print(f"\n[ERROR] Failed to resample to NBBO for {symbol}")
            return False
        
        # Step 3: Compress
        compressed_file = compress_nbbo(nbbo_file, Config.SESSIONS_DIR)
        
        if compressed_file is None:
            print(f"\n[ERROR] Failed to compress data for {symbol}")
            return False
        
        print(f"\n[SUCCESS] Processed {symbol} - {date_str}")
        print(f"Output: {compressed_file}")
        return True
        
    except Exception as e:
        print(f"\n[ERROR] Failed to process {symbol} - {date_str}: {e}")
        import traceback
        traceback.print_exc()
        return False


# ============================================================================
# Main
# ============================================================================

def main():
    """Main execution function."""
    print(f"\n{'='*80}")
    print("Session Processor")
    print(f"{'='*80}\n")
    
    # Validate API key
    if not Config.DATABENTO_API_KEY:
        print("[ERROR] DATABENTO_API_KEY environment variable not set")
        sys.exit(1)
    
    # Setup directories
    Config.setup_directories()
    
    # Load sessions from CSV
    sessions_df = load_sessions()
    
    # Get existing sessions
    existing = get_existing_sessions()
    
    # Find missing sessions
    missing = find_missing_sessions(sessions_df, existing)
    
    if not missing:
        print(f"\n{'='*80}")
        print("All sessions already processed!")
        print(f"{'='*80}\n")
        print(f"Total sessions: {len(sessions_df)}")
        print(f"Existing: {len(existing)}")
        print(f"Missing: 0")
        return
    
    print(f"\n{'='*80}")
    print(f"Missing Sessions: {len(missing)}")
    print(f"{'='*80}\n")
    
    for session in missing:
        print(f"  - {session['symbol']} on {session['date']} ({session['start_time']} - {session['end_time']})")
    
    print(f"\n{'='*80}")
    print("Processing Missing Sessions")
    print(f"{'='*80}\n")
    
    # Initialize fetcher
    try:
        fetcher = DatabentoFetcher()
    except Exception as e:
        print(f"[ERROR] Failed to initialize Databento client: {e}")
        sys.exit(1)
    
    success_count = 0
    fail_count = 0
    
    for i, session in enumerate(missing, 1):
        print(f"\n{'='*80}")
        print(f"[{i}/{len(missing)}]")
        print(f"{'='*80}")
        
        try:
            if process_session(session, fetcher):
                success_count += 1
            else:
                fail_count += 1
        except KeyboardInterrupt:
            print("\n\n[INTERRUPTED] Stopped by user")
            break
        except Exception as e:
            print(f"\n[ERROR] Unexpected error: {e}")
            import traceback
            traceback.print_exc()
            fail_count += 1
    
    # Cleanup
    print(f"\n{'='*80}")
    print("Cleaning up temporary files...")
    print(f"{'='*80}\n")
    Config.cleanup_temp()
    
    # Summary
    print(f"\n{'='*80}")
    print("Processing Complete")
    print(f"{'='*80}\n")
    print(f"Total sessions in CSV: {len(sessions_df)}")
    print(f"Already existed: {len(existing)}")
    print(f"Missing: {len(missing)}")
    print(f"Successfully processed: {success_count}")
    print(f"Failed: {fail_count}")
    print(f"Remaining: {fail_count}")


if __name__ == '__main__':
    main()
