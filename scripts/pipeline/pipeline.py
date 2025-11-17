"""
Main pipeline orchestrator.
"""
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
import json

from .config import Config
from .models import PipelineResult
from .fetchers import FundamentalsFetcher, DatabentoFetcher
from .analyzers import RunUpAnalyzer
from .compressor import BinaryCompressor
from .summarizer import SummaryGenerator


class MomentumPipeline:
    """Main pipeline orchestrator for momentum stock data collection."""

    def __init__(self, date: Optional[str] = None, skip_compression: bool = False):
        """
        Initialize pipeline.

        Args:
            date: Date string (YYYY-MM-DD). If None, uses yesterday.
            skip_compression: Skip compression step (for testing)
        """
        if date:
            self.date = date
        else:
            yesterday = datetime.now() - timedelta(days=1)
            self.date = yesterday.strftime('%Y-%m-%d')

        self.skip_compression = skip_compression

        # Initialize result tracker
        self.result = PipelineResult(
            date=self.date,
            started_at=datetime.utcnow().isoformat() + 'Z'
        )

        # Setup
        Config.setup_directories()

    def run(self) -> PipelineResult:
        """Execute the complete pipeline."""
        print(f"\n{'='*80}")
        print(f"MOMENTUM STOCK DATA PIPELINE")
        print(f"{'='*80}")
        print(f"Date: {self.date}")
        print(f"Started: {self.result.started_at}")
        print(f"{'='*80}\n")

        try:
            # Validate configuration
            if not Config.validate():
                raise ValueError("Configuration validation failed")

            # Step 1: Fetch and filter fundamentals
            self._step_fundamentals()

            # Step 2: Fetch OHLCV and analyze run-ups
            self._step_ohlcv_analysis()

            # Step 3: Fetch MBP-1 data (conditional)
            if self.result.runup_passed_count > 0:
                self._step_mbp1_data()
            else:
                self.result.add_log('Fetch MBP-1', 'skipped', 'No stocks passed filter')

            # Step 4: Compress data (conditional)
            if not self.skip_compression and self.result.mbp1_files_count > 0:
                self._step_compression()
            else:
                reason = 'Skipped by flag' if self.skip_compression else 'No MBP-1 data'
                self.result.add_log('Compress Data', 'skipped', reason)

            # Step 5: Generate summary
            self._step_summary()

            # Mark completion
            self.result.completed_at = datetime.utcnow().isoformat() + 'Z'

            # Final report
            self._print_final_report()

            return self.result

        except KeyboardInterrupt:
            print("\n\n[INTERRUPTED] Pipeline cancelled by user")
            self.result.add_error('Pipeline', 'Cancelled by user')
            raise

        except Exception as e:
            print(f"\n[FATAL ERROR] Pipeline failed: {e}")
            self.result.add_error('Pipeline', str(e))
            import traceback
            traceback.print_exc()
            raise

        finally:
            # Always cleanup temporary files
            print(f"\n{'='*80}")
            print("Cleaning up temporary files...")
            print(f"{'='*80}\n")
            Config.cleanup_temp()

    def _step_fundamentals(self):
        """Step 1: Fetch and filter fundamentals."""
        print(f"\n{'='*80}")
        print(f"STEP 1/5: Fetch & Filter Fundamentals")
        print(f"{'='*80}\n")

        try:
            self.result.add_log('Fetch Fundamentals', 'started')

            fetcher = FundamentalsFetcher()
            data = fetcher.fetch_latest()

            self.result.fundamentals_count = len(data.get('tickers', []))

            # Filter stocks
            filtered_stocks = fetcher.filter_stocks(data)
            self.result.filtered_count = len(filtered_stocks)

            # Store symbols for next step
            self.filtered_symbols = [s.symbol for s in filtered_stocks]

            # Save filtered data
            self._save_fundamentals(data, filtered_stocks)

            self.result.add_log('Fetch Fundamentals', 'success',
                              f'{self.result.filtered_count} stocks filtered')

        except Exception as e:
            self.result.add_error('Fetch Fundamentals', str(e))
            raise

    def _step_ohlcv_analysis(self):
        """Step 2: Fetch OHLCV and analyze run-ups."""
        print(f"\n{'='*80}")
        print(f"STEP 2/5: Fetch OHLCV & Analyze Run-Ups")
        print(f"{'='*80}\n")

        try:
            self.result.add_log('Fetch OHLCV', 'started')

            # Fetch OHLCV data
            fetcher = DatabentoFetcher()
            df_ohlcv = fetcher.fetch_ohlcv_batch(self.filtered_symbols, self.date)

            self.result.ohlcv_symbols_count = df_ohlcv['symbol'].nunique() if 'symbol' in df_ohlcv.columns else 0

            # Analyze run-ups
            analyzer = RunUpAnalyzer()
            runup_results = analyzer.analyze_ohlcv_data(df_ohlcv)

            self.result.runup_results = runup_results
            self.result.runup_passed_count = len(runup_results)

            # Save analysis results to temp directory
            analyzer.save_results(runup_results, self.date, str(Config.TEMP_DIR))

            self.result.add_log('Fetch OHLCV & Analyze', 'success',
                              f'{self.result.runup_passed_count} stocks passed filter')

        except Exception as e:
            self.result.add_error('Fetch OHLCV & Analyze', str(e))
            raise

    def _step_mbp1_data(self):
        """Step 3: Fetch MBP-1 tick data from multiple exchanges."""
        print(f"\n{'='*80}")
        print(f"STEP 3/5: Fetch MBP-1 Tick Data (Multi-Exchange)")
        print(f"{'='*80}\n")

        try:
            self.result.add_log('Fetch MBP-1', 'started')

            # Get symbols that passed filter
            symbols = [r.symbol for r in self.result.runup_results]

            # Fetch MBP-1 data from multiple exchanges
            fetcher = DatabentoFetcher()

            # Use multi-exchange fetcher to get data from all exchanges
            mbp1_data = fetcher.fetch_mbp1_multi_exchange(
                symbols,
                self.date,
                Config.DATA_DIR_MBP1
            )

            self.result.mbp1_files_count = len(mbp1_data)

            self.result.add_log('Fetch MBP-1', 'success',
                              f'{self.result.mbp1_files_count} files fetched (multi-exchange)')

        except Exception as e:
            self.result.add_error('Fetch MBP-1', str(e))
            # Don't raise - MBP-1 fetch is optional

    def _step_compression(self):
        """Step 4: Compress MBP-1 data to binary format."""
        print(f"\n{'='*80}")
        print(f"STEP 4/5: Compress to Binary Format")
        print(f"{'='*80}\n")

        try:
            self.result.add_log('Compress Data', 'started')

            compressor = BinaryCompressor()
            compression_stats = compressor.compress_directory(
                Config.DATA_DIR_MBP1,
                self.date,
                Config.SESSIONS_DIR
            )

            self.result.compression_stats = compression_stats
            self.result.compressed_files_count = len(compression_stats)

            self.result.add_log('Compress Data', 'success',
                              f'{self.result.compressed_files_count} files compressed')

        except Exception as e:
            self.result.add_error('Compress Data', str(e))
            # Don't raise - compression is optional

    def _step_summary(self):
        """Step 5: Generate summary."""
        print(f"\n{'='*80}")
        print(f"STEP 5/5: Generate Summary")
        print(f"{'='*80}\n")

        try:
            self.result.add_log('Generate Summary', 'started')

            summarizer = SummaryGenerator()
            summary = summarizer.generate(self.result)

            self.result.add_log('Generate Summary', 'success')

        except Exception as e:
            self.result.add_error('Generate Summary', str(e))
            # Don't raise - summary is optional

    def _save_fundamentals(self, data: dict, filtered_stocks: list):
        """Save fundamentals data to files."""
        # Save filtered data to temp directory
        filtered_data = {
            'metadata': {
                'date': self.date,
                'count': len(filtered_stocks),
                'filter_criteria': {
                    'max_float': Config.MAX_SHARE_FLOAT,
                    'max_market_cap': Config.MAX_MARKET_CAP,
                    'price_range': [Config.MIN_PRICE, Config.MAX_PRICE]
                }
            },
            'tickers': [s.raw_data for s in filtered_stocks]
        }

        output_file = Config.TEMP_DIR / f'fundamentals_{self.date}_filtered.json'
        with open(output_file, 'w') as f:
            json.dump(filtered_data, f, indent=2)

        print(f"\n[SUCCESS] Saved filtered fundamentals to: {output_file}")

    def _print_final_report(self):
        """Print final pipeline execution report."""
        print(f"\n{'='*80}")
        print(f"PIPELINE EXECUTION COMPLETE")
        print(f"{'='*80}")
        print(f"Date: {self.date}")
        print(f"Started: {self.result.started_at}")
        print(f"Completed: {self.result.completed_at}")

        if self.result.started_at and self.result.completed_at:
            try:
                start_dt = datetime.fromisoformat(self.result.started_at.replace('Z', '+00:00'))
                end_dt = datetime.fromisoformat(self.result.completed_at.replace('Z', '+00:00'))
                duration = (end_dt - start_dt).total_seconds() / 60
                print(f"Duration: {duration:.2f} minutes")
            except:
                pass

        print(f"\nPIPELINE RESULTS:")
        print(f"  • Fundamentals: {self.result.fundamentals_count} -> {self.result.filtered_count} filtered")
        print(f"  • OHLCV symbols: {self.result.ohlcv_symbols_count}")
        print(f"  • Run-up passed: {self.result.runup_passed_count} (>{Config.RUNUP_THRESHOLD_PCT}%)")
        print(f"  • MBP-1 files: {self.result.mbp1_files_count}")
        print(f"  • Compressed: {self.result.compressed_files_count}")

        if self.result.errors:
            print(f"\nERRORS: {len(self.result.errors)}")
            for err in self.result.errors:
                print(f"  • {err['step']}: {err['error'][:100]}")

        # Save execution log to temp directory
        log_file = Config.TEMP_DIR / f'pipeline_log_{self.date}.json'
        with open(log_file, 'w') as f:
            json.dump(self.result.to_dict(), f, indent=2)

        print(f"\nExecution log: {log_file}")
        print(f"{'='*80}\n")
