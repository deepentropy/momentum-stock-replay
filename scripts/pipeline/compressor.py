"""
Binary compression for MBP-1 market data.
"""
import gzip
import struct
from pathlib import Path
from typing import List
import pandas as pd
import numpy as np

from .config import Config
from .models import CompressionStats


class BinaryCompressor:
    """Compresses MBP-1 parquet data to custom binary format."""

    def __init__(self):
        self.price_scale = Config.PRICE_SCALE
        self.size_scale = Config.SIZE_SCALE
        self.time_unit = Config.TIME_UNIT

    def compress_file(self, parquet_file: Path, output_dir: Path) -> CompressionStats:
        """
        Compress a single MBP-1 parquet file to binary format.

        Binary format:
        - Header: TICK (4 bytes) + version (2 byte) + num_rows (4 bytes) + initial_timestamp (8 bytes) = 18 bytes
        - Rows (64 bytes each):
          * ts_event delta (8 bytes, int64)
          * rtype (1 byte, uint8)
          * publisher_id (2 bytes, uint16)
          * instrument_id (4 bytes, uint32)
          * action (1 byte, uint8)
          * side (1 byte, uint8)
          * depth (1 byte, uint8)
          * price (8 bytes, int64, scaled)
          * size (4 bytes, int32, scaled)
          * flags (2 bytes, uint16)
          * ts_in_delta (4 bytes, int32)
          * sequence (4 bytes, uint32)
          * bid_px_00 (4 bytes, int32, scaled)
          * ask_px_00 (4 bytes, int32, scaled)
          * bid_sz_00 (4 bytes, int32, scaled)
          * ask_sz_00 (4 bytes, int32, scaled)
          * bid_ct_00 (4 bytes, uint32)
          * ask_ct_00 (4 bytes, uint32)
        """
        # Read parquet
        df = pd.read_parquet(parquet_file)

        # Keep all MBP-1 columns
        all_cols = ['ts_event', 'rtype', 'publisher_id', 'instrument_id', 'action', 'side',
                    'depth', 'price', 'size', 'flags', 'ts_in_delta', 'sequence',
                    'bid_px_00', 'ask_px_00', 'bid_sz_00', 'ask_sz_00', 'bid_ct_00', 'ask_ct_00']

        # Filter to available columns (some might be missing in older data)
        available_cols = [col for col in all_cols if col in df.columns]
        df = df[available_cols].copy()

        # Convert ts_event to datetime
        if not pd.api.types.is_datetime64_any_dtype(df['ts_event']):
            df['time'] = pd.to_datetime(df['ts_event'], utc=True)
        else:
            df['time'] = pd.to_datetime(df['ts_event'], utc=True)

        df.sort_values('time', inplace=True)
        df.reset_index(drop=True, inplace=True)

        # Initial timestamp
        t0 = df['time'].iloc[0]
        initial_timestamp_us = int(t0.timestamp() * self.time_unit)

        # Calculate time deltas
        deltas = (df['time'] - t0).dt.total_seconds().fillna(0).to_numpy()
        deltas_us = (deltas * self.time_unit).astype(np.int64)

        # Handle NaN values and convert all columns to appropriate types
        # Fill forward/backward for critical columns
        for col in ['bid_px_00', 'ask_px_00', 'bid_sz_00', 'ask_sz_00']:
            if col in df.columns:
                df[col] = df[col].ffill().bfill().fillna(0)

        # Convert to appropriate types with default values for missing columns
        def get_column(name, default_val, dtype):
            if name in df.columns:
                return df[name].fillna(default_val).astype(dtype).to_numpy()
            else:
                return np.full(len(df), default_val, dtype=dtype)

        def get_char_column(name, default_char=' '):
            """Convert character column to ASCII values."""
            if name in df.columns:
                # Convert to string, take first character, convert to ASCII
                return df[name].fillna(default_char).astype(str).str[0].apply(ord).astype(np.uint8).to_numpy()
            else:
                return np.full(len(df), ord(default_char), dtype=np.uint8)

        # Extract all columns
        rtype = get_column('rtype', 0, np.uint8)
        publisher_id = get_column('publisher_id', 0, np.uint16)
        instrument_id = get_column('instrument_id', 0, np.uint32)
        action = get_char_column('action', ' ')  # Convert char to ASCII
        side = get_char_column('side', ' ')      # Convert char to ASCII
        depth = get_column('depth', 0, np.uint8)
        flags = get_column('flags', 0, np.uint16)
        ts_in_delta = get_column('ts_in_delta', 0, np.int32)
        sequence = get_column('sequence', 0, np.uint32)
        bid_ct_00 = get_column('bid_ct_00', 0, np.uint32)
        ask_ct_00 = get_column('ask_ct_00', 0, np.uint32)

        # Convert prices and sizes (scaled)
        price = ((get_column('price', 0, np.float64)) * self.price_scale).round().astype(np.int64)
        size = ((get_column('size', 0, np.float64)) * self.size_scale).round().astype(np.int32)
        price_bid = ((get_column('bid_px_00', 0, np.float64)) * self.price_scale).round().astype(np.int32)
        price_ask = ((get_column('ask_px_00', 0, np.float64)) * self.price_scale).round().astype(np.int32)
        size_bid = ((get_column('bid_sz_00', 0, np.float64)) * self.size_scale).round().astype(np.int32)
        size_ask = ((get_column('ask_sz_00', 0, np.float64)) * self.size_scale).round().astype(np.int32)

        # Build binary buffer
        num_rows = len(df)
        buffer = bytearray()

        # Header: TICK (4 bytes) + version (2 bytes) + num_rows (4 bytes) + initial_timestamp (8 bytes) = 18 bytes
        header = struct.pack(
            '<4sHIQ',
            Config.BINARY_MAGIC,
            2,  # Version 2 for full MBP-1 data
            num_rows,
            initial_timestamp_us
        )
        buffer.extend(header)

        # Data rows (64 bytes per row)
        # Format: qBHIBBBqiHiIiiiiII
        for i in range(num_rows):
            row_data = struct.pack(
                '<qBHIBBBqiHiIiiiiII',
                deltas_us[i],         # 8 bytes: ts_event delta
                rtype[i],             # 1 byte: rtype
                publisher_id[i],      # 2 bytes: publisher_id
                instrument_id[i],     # 4 bytes: instrument_id
                action[i],            # 1 byte: action
                side[i],              # 1 byte: side
                depth[i],             # 1 byte: depth
                price[i],             # 8 bytes: price
                size[i],              # 4 bytes: size
                flags[i],             # 2 bytes: flags
                ts_in_delta[i],       # 4 bytes: ts_in_delta
                sequence[i],          # 4 bytes: sequence
                price_bid[i],         # 4 bytes: bid_px_00
                price_ask[i],         # 4 bytes: ask_px_00
                size_bid[i],          # 4 bytes: bid_sz_00
                size_ask[i],          # 4 bytes: ask_sz_00
                bid_ct_00[i],         # 4 bytes: bid_ct_00
                ask_ct_00[i]          # 4 bytes: ask_ct_00
            )
            buffer.extend(row_data)

        # Compress with gzip
        compressed = gzip.compress(bytes(buffer), compresslevel=Config.GZIP_LEVEL)

        # Extract filename and save
        filename = parquet_file.stem
        parts = filename.split('_')
        symbol = parts[0]
        date_str = parts[1].replace('-', '')

        output_dir.mkdir(parents=True, exist_ok=True)
        dest_file = output_dir / f"{symbol}-{date_str}.bin.gz"

        with open(dest_file, 'wb') as f:
            f.write(compressed)

        # Create stats
        stats = CompressionStats(
            symbol=symbol,
            date=date_str,
            input_file=str(parquet_file),
            output_file=str(dest_file),
            num_rows=num_rows,
            original_size_mb=len(buffer) / (1024 * 1024),
            compressed_size_mb=len(compressed) / (1024 * 1024),
            compression_ratio=len(buffer) / len(compressed),
            compression_pct=(len(compressed) / len(buffer)) * 100
        )

        return stats

    def compress_directory(self, mbp1_dir: Path, date: str, output_dir: Path) -> List[CompressionStats]:
        """Compress all MBP-1 files for a given date."""
        print(f"\n{'='*80}")
        print("Compressing MBP-1 Data to Binary Format")
        print(f"{'='*80}\n")

        date_dir = mbp1_dir / date
        parquet_files = list(date_dir.glob('*_mbp1.parquet'))

        if not parquet_files:
            print(f"[WARNING] No MBP-1 files found in {date_dir}")
            return []

        print(f"Found {len(parquet_files)} files to compress")
        print(f"Output: {output_dir}")

        all_stats = []
        for i, pf in enumerate(parquet_files, 1):
            try:
                print(f"[{i}/{len(parquet_files)}] {pf.name}...", end=' ')
                stats = self.compress_file(pf, output_dir)
                all_stats.append(stats)
                print(f"{stats.num_rows:,} rows -> {stats.compressed_size_mb:.2f} MB "
                      f"({stats.compression_ratio:.2f}x)")
            except Exception as e:
                print(f"[ERROR] {e}")

        # Summary
        if all_stats:
            total_original = sum(s.original_size_mb for s in all_stats)
            total_compressed = sum(s.compressed_size_mb for s in all_stats)
            total_rows = sum(s.num_rows for s in all_stats)

            print(f"\n{'='*80}")
            print(f"COMPRESSION SUMMARY")
            print(f"{'='*80}")
            print(f"Files: {len(all_stats)}")
            print(f"Total rows: {total_rows:,}")
            print(f"Original size: {total_original:.2f} MB")
            print(f"Compressed size: {total_compressed:.2f} MB")
            print(f"Compression ratio: {total_original / total_compressed:.2f}x")
            print(f"Space saved: {(1 - total_compressed / total_original) * 100:.1f}%")

        return all_stats
