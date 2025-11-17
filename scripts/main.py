#!/usr/bin/env python3
"""
Momentum Stock Data Pipeline - Single Entry Point

This is the unified entry point for the complete momentum stock data pipeline.
All functionality has been refactored into modular components under the pipeline/ package.

Usage:
    # Run for yesterday's date (default)
    python scripts/main.py

    # Run for specific date
    python scripts/main.py --date 2025-11-14

    # Skip compression (for testing)
    python scripts/main.py --skip-compression

    # Show version
    python scripts/main.py --version

Environment variables needed:
- STOCKFUNDAMENTALS_PAT: GitHub token for private fundamentals repo
- DATABENTO_API_KEY: Databento API key

Pipeline steps:
1. Fetch and filter fundamentals from GitHub
2. Download 1-hour OHLCV data and analyze run-ups
3. Download MBP-1 tick data for stocks with >30% run-up
4. Compress MBP-1 data to binary format
5. Generate comprehensive summary

Output:
- sessions/*.bin.gz - Compressed binary data (committed to git)
- summary/*_summary.json - Run summaries (committed to git)
- runup_analysis_*.json/csv - Analysis results (artifacts only)
- databento_mbp1_data/ - Raw parquet files (artifacts only)
"""
import sys
import os
import argparse

# Pipeline is now in the same directory (scripts/pipeline/)
from pipeline import __version__
from pipeline.pipeline import MomentumPipeline


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Unified momentum stock data pipeline',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/main.py                      # Run for yesterday's date
  python scripts/main.py --date 2025-11-14    # Run for specific date
  python scripts/main.py --skip-compression   # Skip compression step

For more information, see README.md
        """
    )

    parser.add_argument(
        '--date',
        type=str,
        help='Date (YYYY-MM-DD) to run pipeline for (default: yesterday)'
    )

    parser.add_argument(
        '--skip-compression',
        action='store_true',
        help='Skip compression step (for testing)'
    )

    parser.add_argument(
        '--version',
        action='version',
        version=f'Momentum Pipeline v{__version__}'
    )

    args = parser.parse_args()

    try:
        # Initialize and run pipeline
        pipeline = MomentumPipeline(
            date=args.date,
            skip_compression=args.skip_compression
        )

        result = pipeline.run()

        # Check for errors
        if result.errors:
            print(f"\n[WARNING] Pipeline completed with {len(result.errors)} error(s)")
            return 1
        else:
            print("\n[SUCCESS] Pipeline completed successfully!")
            return 0

    except KeyboardInterrupt:
        print("\n\n[INTERRUPTED] Pipeline execution cancelled by user")
        return 130

    except Exception as e:
        print(f"\n[FATAL ERROR] Pipeline failed: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
