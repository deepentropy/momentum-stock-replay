"""
Fetch MBP-1 data for a specific symbol and time range.

This script fetches MBP-1 tick data from Databento, computes NBBO,
and compresses it to binary format. It reuses components from the
pipeline directory.

Usage:
    python fetch_mbp1_symbol.py AAPL 2025-01-15 2025-01-16
    python fetch_mbp1_symbol.py AAPL "2025-01-15 09:30:00" "2025-01-15 16:00:00"
"""

import argparse
import sys
from datetime import datetime
from pathlib import Path

# Add pipeline to path
sys.path.insert(0, str(Path(__file__).parent))

from pipeline.config import Config
from pipeline.fetchers import DatabentoFetcher
from pipeline.resampler import NBBOResampler
from pipeline.compressor import NBBOBinaryCompressor


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description='Fetch MBP-1 data for a symbol, compute NBBO, and compress',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Full day
  python fetch_mbp1_symbol.py AAPL 2025-01-15 2025-01-16

  # Specific time range
  python fetch_mbp1_symbol.py AAPL "2025-01-15 09:30:00" "2025-01-15 16:00:00"
  
  # Custom dataset
  python fetch_mbp1_symbol.py TSLA 2025-01-15 2025-01-16 --dataset XNYS.PILLAR
        """
    )
    
    parser.add_argument('symbol', type=str, help='Stock symbol (e.g., AAPL)')
    parser.add_argument('start', type=str, help='Start datetime (YYYY-MM-DD or "YYYY-MM-DD HH:MM:SS")')
    parser.add_argument('end', type=str, help='End datetime (YYYY-MM-DD or "YYYY-MM-DD HH:MM:SS")')
    parser.add_argument('--dataset', type=str, default=None,
                       help='Databento dataset (default: multi-exchange)')
    parser.add_argument('--multi-exchange', action='store_true', default=True,
                       help='Fetch from multiple exchanges (default: True)')
    parser.add_argument('--single-exchange', dest='multi_exchange', action='store_false',
                       help='Fetch from single exchange only')
    parser.add_argument('--output-dir', type=Path, default=None,
                       help='Output directory (default: sessions/)')
    parser.add_argument('--skip-compression', action='store_true',
                       help='Skip compression step')
    
    return parser.parse_args()


def parse_datetime(dt_str: str) -> datetime:
    """Parse datetime string in various formats."""
    formats = [
        '%Y-%m-%d',
        '%Y-%m-%d %H:%M:%S',
        '%Y-%m-%dT%H:%M:%S',
    ]
    
    for fmt in formats:
        try:
            return datetime.strptime(dt_str, fmt)
        except ValueError:
            continue
    
    raise ValueError(f"Unable to parse datetime: {dt_str}")


def format_date_for_filename(dt: datetime) -> str:
    """Format datetime for filename (YYYY-MM-DD)."""
    return dt.strftime('%Y-%m-%d')


def fetch_mbp1_single_exchange(fetcher, symbol, start_date, end_date, dataset, output_dir):
    """Fetch MBP-1 data from a single exchange."""
    print(f"\n{'='*80}")
    print("Fetching MBP-1 Data (Single Exchange)")
    print(f"{'='*80}\n")
    print(f"Symbol: {symbol}")
    print(f"Start: {start_date}")
    print(f"End: {end_date}")
    print(f"Dataset: {dataset}")
    
    # Databento expects date strings
    start_str = start_date.strftime('%Y-%m-%d')
    
    # Fetch data
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
        print("[WARNING] No data returned")
        return None
    
    print(f"[SUCCESS] Received {len(df):,} quote updates")
    
    # Create output directory
    output_path = output_dir / start_str
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Save parquet file
    parquet_file = output_path / f"{symbol}_{start_str}_mbp1.parquet"
    df.to_parquet(parquet_file, compression='snappy')
    
    file_size_mb = parquet_file.stat().st_size / (1024 * 1024)
    print(f"Saved: {parquet_file}")
    print(f"Size: {file_size_mb:.2f} MB")
    
    return parquet_file


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
    
    # Databento expects date strings
    start_str = start_date.strftime('%Y-%m-%d')
    
    # Create output directory
    output_path = output_dir / start_str
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Storage for combined data
    all_data = []
    
    # Query each exchange
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
            
            # Show publisher_id
            if 'publisher_id' in df.columns and not df.empty:
                pub_ids = df['publisher_id'].unique()
                print(f"  Publisher IDs: {pub_ids}")
            
            all_data.append(df)
            
        except Exception as e:
            print(f"  [ERROR] Failed to fetch from {dataset}: {e}")
            continue
    
    if not all_data:
        print("\n[ERROR] No data retrieved from any exchange")
        return None
    
    # Combine all data
    print(f"\n{'='*80}")
    print("Combining Multi-Exchange Data")
    print(f"{'='*80}\n")
    
    import pandas as pd
    df_combined = pd.concat(all_data, ignore_index=True)
    df_combined = df_combined.sort_values('ts_event').reset_index(drop=True)
    
    print(f"Total quotes: {len(df_combined):,}")
    
    # Show exchange breakdown
    if 'publisher_id' in df_combined.columns:
        exchange_counts = df_combined['publisher_id'].value_counts().to_dict()
        print("\nQuotes per exchange:")
        for pub_id, count in sorted(exchange_counts.items()):
            print(f"  Publisher {pub_id}: {count:,}")
    
    # Save parquet file
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
    
    # Extract date from filename
    filename = parquet_file.stem  # e.g., "AAPL_2025-01-15_mbp1"
    parts = filename.split('_')
    symbol = parts[0]
    date_str = parts[1]
    
    # Create output directory
    output_path = output_dir / date_str
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Save NBBO parquet
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
    
    import pandas as pd
    
    # Read parquet to get publisher map
    df = pd.read_parquet(nbbo_file)
    if df.empty:
        print("[ERROR] Empty NBBO file")
        return None
    
    # Extract publisher map from columns
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
    
    # Compress
    compressor = NBBOBinaryCompressor()
    stats = compressor.compress_file(nbbo_file, output_dir, publisher_map)
    
    print(f"\nCompression Results:")
    print(f"  Input: {stats.input_file}")
    print(f"  Output: {stats.output_file}")
    print(f"  Samples: {stats.num_rows:,}")
    print(f"  Original size: {stats.original_size_mb:.2f} MB")
    print(f"  Compressed size: {stats.compressed_size_mb:.2f} MB")
    print(f"  Compression ratio: {stats.compression_ratio:.2f}x")
    print(f"  Space saved: {100 - stats.compression_pct:.1f}%")
    
    return Path(stats.output_file)


def main():
    """Main execution function."""
    args = parse_args()
    
    # Parse datetimes
    try:
        start_dt = parse_datetime(args.start)
        end_dt = parse_datetime(args.end)
    except ValueError as e:
        print(f"[ERROR] {e}")
        sys.exit(1)
    
    # Validate
    if end_dt <= start_dt:
        print("[ERROR] End datetime must be after start datetime")
        sys.exit(1)
    
    # Setup directories
    Config.setup_directories()
    
    # Set output directory
    output_dir = args.output_dir or Config.SESSIONS_DIR
    
    # Setup intermediate directories
    mbp1_dir = Config.DATA_DIR_MBP1
    nbbo_dir = Config.DATA_DIR_NBBO
    
    print(f"\n{'='*80}")
    print("MBP-1 Data Fetcher")
    print(f"{'='*80}\n")
    print(f"Symbol: {args.symbol}")
    print(f"Start: {start_dt}")
    print(f"End: {end_dt}")
    print(f"Multi-Exchange: {args.multi_exchange}")
    print(f"Output: {output_dir}")
    print(f"{'='*80}\n")
    
    # Validate API key
    if not Config.DATABENTO_API_KEY:
        print("[ERROR] DATABENTO_API_KEY environment variable not set")
        sys.exit(1)
    
    try:
        # Initialize fetcher
        fetcher = DatabentoFetcher()
        
        # Step 1: Fetch MBP-1 data
        if args.multi_exchange:
            parquet_file = fetch_mbp1_multi_exchange(
                fetcher, args.symbol, start_dt, end_dt, mbp1_dir
            )
        else:
            dataset = args.dataset or Config.DATABENTO_DATASET
            parquet_file = fetch_mbp1_single_exchange(
                fetcher, args.symbol, start_dt, end_dt, dataset, mbp1_dir
            )
        
        if parquet_file is None:
            print("\n[ERROR] Failed to fetch MBP-1 data")
            sys.exit(1)
        
        # Step 2: Resample to NBBO
        nbbo_file = resample_to_nbbo(parquet_file, nbbo_dir)
        
        if nbbo_file is None:
            print("\n[ERROR] Failed to resample to NBBO")
            sys.exit(1)
        
        # Step 3: Compress (optional)
        if not args.skip_compression:
            compressed_file = compress_nbbo(nbbo_file, output_dir)
            
            if compressed_file is None:
                print("\n[ERROR] Failed to compress data")
                sys.exit(1)
        
        # Success
        print(f"\n{'='*80}")
        print("SUCCESS")
        print(f"{'='*80}\n")
        print("Pipeline completed successfully!")
        
        if not args.skip_compression:
            print(f"\nFinal output: {compressed_file}")
        else:
            print(f"\nNBBO output: {nbbo_file}")
            print("(Compression skipped)")
        
    except KeyboardInterrupt:
        print("\n\n[INTERRUPTED] Cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n[FATAL ERROR] {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        # Always cleanup temporary files
        print(f"\n{'='*80}")
        print("Cleaning up temporary files...")
        print(f"{'='*80}\n")
        Config.cleanup_temp()


if __name__ == '__main__':
    main()
