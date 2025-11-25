"""
Diagnostic script to identify source of negative spreads.

This script helps determine if negative spreads are:
1. Present in the original Databento data
2. Introduced during NBBO processing

Usage:
    python diagnose_negative_spreads.py
"""

import os
import sys
import pandas as pd
import numpy as np
import databento as db
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Tuple

# Configuration
class Config:
    DATABENTO_API_KEY = os.environ.get('DATABENTO_API_KEY')
    
    DATABENTO_DATASETS_MBP1 = [
        'XNAS.ITCH',     # NASDAQ
        'XNYS.PILLAR',   # NYSE
        'IEXG.TOPS',     # IEX
        'ARCX.PILLAR',   # NYSE Arca
        'BATS.PITCH',    # Cboe BZX
        'XBOS.ITCH',     # NASDAQ BX
        'XPSX.ITCH',     # NASDAQ PSX
    ]
    
    DATASET_TO_PUBLISHER_ID = {
        'XNAS.ITCH': 1,
        'XNYS.PILLAR': 2,
        'ARCX.PILLAR': 3,
        'BATS.PITCH': 4,
        'IEXG.TOPS': 5,
        'XBOS.ITCH': 6,
        'BATY.PITCH': 9,
        'EDGA.PITCH': 38,
        'XPSX.ITCH': 43,
    }
    
    NBBO_RESAMPLE_INTERVAL_MS = 100


def check_raw_data_spreads(df: pd.DataFrame, dataset_name: str) -> Dict:
    """Check for negative/crossed spreads in raw exchange data."""
    print(f"\n{'='*80}")
    print(f"RAW DATA CHECK: {dataset_name}")
    print(f"{'='*80}")
    
    # Filter to valid quotes (both bid and ask > 0)
    valid_quotes = df[(df['bid_px_00'] > 0) & (df['ask_px_00'] > 0)].copy()
    
    if len(valid_quotes) == 0:
        print("  ⚠️  No valid quotes found")
        return {'total': 0, 'negative': 0, 'zero': 0, 'positive': 0}
    
    # Calculate spread
    valid_quotes['spread'] = valid_quotes['ask_px_00'] - valid_quotes['bid_px_00']
    
    # Analyze spreads
    negative = len(valid_quotes[valid_quotes['spread'] < 0])
    zero = len(valid_quotes[valid_quotes['spread'] == 0])
    positive = len(valid_quotes[valid_quotes['spread'] > 0])
    total = len(valid_quotes)
    
    print(f"  Total valid quotes: {total:,}")
    print(f"  Negative spreads: {negative:,} ({negative/total*100:.2f}%)")
    print(f"  Zero spreads: {zero:,} ({zero/total*100:.2f}%)")
    print(f"  Positive spreads: {positive:,} ({positive/total*100:.2f}%)")
    
    if negative > 0:
        print(f"\n  ⚠️  FOUND NEGATIVE SPREADS IN RAW DATA!")
        print(f"  Sample of negative spreads:")
        neg_samples = valid_quotes[valid_quotes['spread'] < 0].head(10)
        for idx, row in neg_samples.iterrows():
            print(f"    Time: {row['ts_event']}, Bid: {row['bid_px_00']:.4f}, Ask: {row['ask_px_00']:.4f}, Spread: {row['spread']:.4f}")
    
    return {
        'total': total,
        'negative': negative,
        'zero': zero,
        'positive': positive,
        'dataset': dataset_name
    }


def check_nbbo_spreads(df: pd.DataFrame) -> Dict:
    """Check for negative spreads in NBBO data."""
    print(f"\n{'='*80}")
    print(f"NBBO DATA CHECK")
    print(f"{'='*80}")
    
    # Calculate spread
    df['spread'] = df['nbbo_ask'] - df['nbbo_bid']
    
    # Analyze spreads
    negative = len(df[df['spread'] < 0])
    zero = len(df[df['spread'] == 0])
    positive = len(df[df['spread'] > 0])
    total = len(df)
    
    print(f"  Total NBBO samples: {total:,}")
    print(f"  Negative spreads: {negative:,} ({negative/total*100:.2f}%)")
    print(f"  Zero spreads: {zero:,} ({zero/total*100:.2f}%)")
    print(f"  Positive spreads: {positive:,} ({positive/total*100:.2f}%)")
    
    if negative > 0:
        print(f"\n  ⚠️  FOUND NEGATIVE SPREADS IN NBBO!")
        print(f"  Sample of negative spreads:")
        neg_samples = df[df['spread'] < 0].head(10)
        for idx, row in neg_samples.iterrows():
            print(f"    Time: {row['timestamp']}, Bid: {row['nbbo_bid']:.4f}, Ask: {row['nbbo_ask']:.4f}, Spread: {row['spread']:.4f}")
            print(f"      Bid Publisher: {row['nbbo_bid_publisher']}, Ask Publisher: {row['nbbo_ask_publisher']}")
            
            # Show exchange data
            ex_cols = [col for col in df.columns if col.startswith('ex_')]
            print(f"      Exchange data:")
            for col in ex_cols:
                if pd.notna(row[col]) and row[col] > 0:
                    print(f"        {col}: {row[col]:.4f}")
    
    return {
        'total': total,
        'negative': negative,
        'zero': zero,
        'positive': positive
    }


def download_and_check_raw_data(symbol: str, start_date: datetime, end_date: datetime) -> pd.DataFrame:
    """Download raw data from all exchanges and check each individually."""
    print(f"\n{'='*80}")
    print(f"DOWNLOADING RAW DATA FOR {symbol}")
    print(f"{'='*80}")
    print(f"Date range: {start_date.date()} to {end_date.date()}")
    
    if not Config.DATABENTO_API_KEY:
        raise ValueError("DATABENTO_API_KEY not set in environment")
    
    client = db.Historical(Config.DATABENTO_API_KEY)
    
    all_data = []
    raw_spread_results = []
    
    for dataset in Config.DATABENTO_DATASETS_MBP1:
        print(f"\nFetching from {dataset}...")
        
        try:
            data = client.timeseries.get_range(
                dataset=dataset,
                symbols=[symbol],
                schema='mbp-1',
                start=start_date.isoformat(),
                end=end_date.isoformat(),
                stype_in='raw_symbol'
            )
            
            df = data.to_df()
            
            if df.empty:
                print(f"  ⚠️  No data from {dataset}")
                continue
            
            print(f"  ✅ {len(df):,} quotes from {dataset}")
            
            # Check for negative spreads in raw data
            spread_check = check_raw_data_spreads(df, dataset)
            raw_spread_results.append(spread_check)
            
            # Remap publisher ID
            if dataset in Config.DATASET_TO_PUBLISHER_ID:
                correct_pub_id = Config.DATASET_TO_PUBLISHER_ID[dataset]
                df['publisher_id'] = correct_pub_id
            
            all_data.append(df)
            
        except Exception as e:
            print(f"  ❌ Error fetching from {dataset}: {e}")
            continue
    
    if not all_data:
        raise ValueError("No data retrieved from any exchange")
    
    # Combine and sort
    print(f"\n{'='*80}")
    print("COMBINING DATA FROM ALL EXCHANGES")
    print(f"{'='*80}")
    
    df_combined = pd.concat(all_data, ignore_index=True)
    df_combined = df_combined.sort_values('ts_event').reset_index(drop=True)
    
    print(f"Total quotes: {len(df_combined):,}")
    
    # Print summary of raw spread checks
    print(f"\n{'='*80}")
    print("RAW DATA SPREAD SUMMARY")
    print(f"{'='*80}")
    
    for result in raw_spread_results:
        if result['negative'] > 0:
            print(f"❌ {result['dataset']}: {result['negative']:,} negative spreads out of {result['total']:,} ({result['negative']/result['total']*100:.2f}%)")
        else:
            print(f"✅ {result['dataset']}: No negative spreads in {result['total']:,} quotes")
    
    return df_combined


def resample_to_nbbo(df: pd.DataFrame, interval_ms: int = 100) -> pd.DataFrame:
    """Simplified NBBO resampler to match the notebook's logic."""
    print(f"\n{'='*80}")
    print(f"RESAMPLING TO NBBO (interval: {interval_ms}ms)")
    print(f"{'='*80}")
    
    # Ensure timestamp column is datetime
    if not pd.api.types.is_datetime64_any_dtype(df['ts_event']):
        df['ts_event'] = pd.to_datetime(df['ts_event'], utc=True)
    else:
        df['ts_event'] = pd.to_datetime(df['ts_event'], utc=True)
    
    df = df.sort_values('ts_event').reset_index(drop=True)
    
    publishers = sorted(df['publisher_id'].unique())
    print(f"Publishers: {publishers}")
    print(f"Original ticks: {len(df):,}")
    
    start_time = df['ts_event'].iloc[0]
    end_time = df['ts_event'].iloc[-1]
    
    # Create time bins
    bins = pd.date_range(
        start=start_time.floor(f'{interval_ms}ms'),
        end=end_time.ceil(f'{interval_ms}ms'),
        freq=f'{interval_ms}ms'
    )
    
    print(f"Time range: {start_time} to {end_time}")
    print(f"Resampling bins: {len(bins):,}")
    
    # Assign each tick to a time bin
    df['time_bin'] = pd.cut(df['ts_event'], bins=bins, labels=False, include_lowest=True)
    df = df[df['time_bin'].notna()].copy()
    
    # Aggregate by bin and publisher (last quote in each bin)
    grouped = df.groupby(['time_bin', 'publisher_id']).last()
    grouped['bid'] = grouped['bid_px_00']
    grouped['ask'] = grouped['ask_px_00']
    grouped['bid_size'] = grouped['bid_sz_00']
    grouped['ask_size'] = grouped['ask_sz_00']
    
    # Filter valid quotes
    grouped = grouped[(grouped['bid'] > 0) & (grouped['ask'] > 0)]
    
    # Pivot to wide format
    ex_wide = grouped.pivot_table(
        index='time_bin',
        columns='publisher_id',
        values=['bid', 'ask', 'bid_size', 'ask_size'],
        aggfunc='last'
    ).sort_index()
    
    # Reindex to all bins and forward-fill
    all_bins = range(int(df['time_bin'].min()), int(df['time_bin'].max()) + 1)
    ex_wide = ex_wide.reindex(all_bins).ffill()
    
    # Calculate NBBO
    bid_matrix = ex_wide['bid']
    ask_matrix = ex_wide['ask']
    bid_size_matrix = ex_wide['bid_size']
    ask_size_matrix = ex_wide['ask_size']
    
    # Best bid (highest) and best ask (lowest)
    nbbo_bid = bid_matrix.max(axis=1, skipna=True)
    nbbo_bid_pub = bid_matrix.idxmax(axis=1, skipna=True)
    nbbo_ask = ask_matrix.min(axis=1, skipna=True)
    nbbo_ask_pub = ask_matrix.idxmin(axis=1, skipna=True)
    
    # Get sizes for best bid/ask
    nbbo_bid_size = pd.Series([
        bid_size_matrix.loc[idx, pub] if pd.notna(pub) else 0
        for idx, pub in zip(bid_size_matrix.index, nbbo_bid_pub)
    ], index=bid_size_matrix.index)
    
    nbbo_ask_size = pd.Series([
        ask_size_matrix.loc[idx, pub] if pd.notna(pub) else 0
        for idx, pub in zip(ask_size_matrix.index, nbbo_ask_pub)
    ], index=ask_size_matrix.index)
    
    # Create NBBO DataFrame
    nbbo = pd.DataFrame({
        'time_bin': ex_wide.index,
        'nbbo_bid': nbbo_bid,
        'nbbo_bid_size': nbbo_bid_size,
        'nbbo_bid_publisher': nbbo_bid_pub,
        'nbbo_ask': nbbo_ask,
        'nbbo_ask_size': nbbo_ask_size,
        'nbbo_ask_publisher': nbbo_ask_pub,
    })
    nbbo['timestamp'] = bins[nbbo['time_bin'].astype(int)]
    
    # Add exchange snapshots
    exchange_data = ex_wide.copy()
    exchange_data.columns = [f'ex_{col[1]}_{col[0]}' for col in exchange_data.columns]
    
    resampled_df = nbbo.join(exchange_data).reset_index(drop=True)
    
    print(f"Resampled ticks: {len(resampled_df):,}")
    print(f"Reduction: {100 * (1 - len(resampled_df) / len(df)):.1f}%")
    
    return resampled_df


def main():
    """Main diagnostic function."""
    print("\n" + "="*80)
    print("NEGATIVE SPREADS DIAGNOSTIC TOOL")
    print("="*80)
    
    # Configuration
    symbol = 'AMIX'
    start_date = datetime(2025, 11, 17, 9, 30)  # Market open
    end_date = datetime(2025, 11, 17, 16, 0)    # Market close
    
    print(f"\nSymbol: {symbol}")
    print(f"Date: {start_date.date()}")
    
    try:
        # Step 1: Download and check raw data
        df_raw = download_and_check_raw_data(symbol, start_date, end_date)
        
        # Step 2: Process to NBBO
        df_nbbo = resample_to_nbbo(df_raw, Config.NBBO_RESAMPLE_INTERVAL_MS)
        
        # Step 3: Check NBBO for negative spreads
        nbbo_results = check_nbbo_spreads(df_nbbo)
        
        # Step 4: Final diagnosis
        print(f"\n{'='*80}")
        print("DIAGNOSIS")
        print(f"{'='*80}")
        
        # Check if raw data has negative spreads
        raw_has_negatives = False
        for col in df_raw.columns:
            if 'bid_px' in col or 'ask_px' in col:
                valid = df_raw[(df_raw['bid_px_00'] > 0) & (df_raw['ask_px_00'] > 0)]
                if len(valid) > 0:
                    spreads = valid['ask_px_00'] - valid['bid_px_00']
                    if (spreads < 0).any():
                        raw_has_negatives = True
                        break
        
        nbbo_has_negatives = nbbo_results['negative'] > 0
        
        if raw_has_negatives and nbbo_has_negatives:
            print("\n✅ CONCLUSION: Negative spreads are present in ORIGINAL DATABENTO data")
            print("   The issue is NOT with your NBBO processing logic.")
            print("   The raw exchange data contains crossed markets (bid > ask).")
        elif not raw_has_negatives and nbbo_has_negatives:
            print("\n⚠️  CONCLUSION: Negative spreads are INTRODUCED during NBBO processing")
            print("   The raw data is clean, but your NBBO algorithm has a bug.")
            print("   Issue: Taking max(bid) and min(ask) across exchanges can create crossed markets")
            print("   when different exchanges have temporarily inconsistent quotes.")
        elif not raw_has_negatives and not nbbo_has_negatives:
            print("\n✅ CONCLUSION: No negative spreads found in raw data or NBBO")
            print("   Both the original data and processing are working correctly.")
        else:
            print("\n❓ CONCLUSION: Negative spreads in raw data but NOT in NBBO")
            print("   This is unusual - the NBBO processing may be filtering them out.")
        
        # Additional insight
        if nbbo_has_negatives:
            print(f"\n{'='*80}")
            print("EXPLANATION")
            print(f"{'='*80}")
            print("\nNegative NBBO spreads occur when:")
            print("1. Raw data already has crossed markets (exchange error or latency)")
            print("2. OR when taking best bid/ask across exchanges creates artificial crosses:")
            print("   - Exchange A: Bid=10.05, Ask=10.06 (valid)")
            print("   - Exchange B: Bid=10.04, Ask=10.07 (valid)")
            print("   - NBBO: Bid=10.05 (from A), Ask=10.06 (from A) ✅ OK")
            print("   But if quotes are stale and not synchronized:")
            print("   - Exchange A: Bid=10.05, Ask=10.08")
            print("   - Exchange B: Bid=10.06, Ask=10.04")
            print("   - NBBO: Bid=10.06 (from B), Ask=10.04 (from B) ❌ CROSSED!")
            print("\nTo fix if it's a processing issue:")
            print("- Ensure you're using the same timestamp/snapshot for all exchanges")
            print("- Consider using asof joins to get synchronized exchange states")
            print("- Or filter out crossed NBBOs as invalid data")
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
