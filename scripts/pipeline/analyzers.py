"""
Analysis modules for run-up calculation and pattern detection.
"""
import pandas as pd
from typing import List, Dict, Optional
from .config import Config
from .models import RunUpResult
from .utils.relativevolume import relative_volume
from .utils.roc import roc


class RunUpAnalyzer:
    """Analyzes intraday run-ups from premarket to day high."""

    def __init__(self, threshold_pct: float = Config.RUNUP_THRESHOLD_PCT):
        self.threshold_pct = threshold_pct

    def calculate_runup(self, premarket_open: float, day_high: float) -> float:
        """Calculate run-up percentage."""
        if premarket_open <= 0:
            return 0.0
        return ((day_high - premarket_open) / premarket_open) * 100

    def analyze_ohlcv_data(self, df: pd.DataFrame) -> List[RunUpResult]:
        """
        Analyze 1-hour OHLCV data to find run-ups.

        Args:
            df: DataFrame with columns: symbol, ts_event, open, high, low, close, volume

        Returns:
            List of RunUpResult for stocks passing threshold
        """
        print(f"\n{'='*80}")
        print("Analyzing Run-Ups")
        print(f"{'='*80}\n")
        print(f"Threshold: {self.threshold_pct}%")

        if 'symbol' not in df.columns:
            print("[ERROR] No 'symbol' column in data")
            return []

        results = []
        symbols = df['symbol'].unique()

        print(f"Analyzing {len(symbols)} symbols...")

        for symbol in symbols:
            symbol_data = df[df['symbol'] == symbol].sort_values('ts_event')

            if symbol_data.empty:
                continue

            # Get premarket open (first bar's open)
            premarket_open = symbol_data.iloc[0]['open']

            # Get day high
            day_high = symbol_data['high'].max()

            # Get other stats
            day_low = symbol_data['low'].min()
            day_close = symbol_data.iloc[-1]['close']
            total_volume = symbol_data['volume'].sum()

            # Calculate run-up
            runup_pct = self.calculate_runup(premarket_open, day_high)

            result = RunUpResult(
                symbol=symbol,
                premarket_open=premarket_open,
                day_high=day_high,
                runup_pct=runup_pct,
                day_low=day_low,
                day_close=day_close,
                volume=int(total_volume)
            )

            # Only include if passes threshold
            if runup_pct >= self.threshold_pct:
                results.append(result)

        # Sort by run-up percentage (descending)
        results.sort(key=lambda x: x.runup_pct, reverse=True)

        print(f"\n[SUCCESS] Found {len(results)} stocks with >{self.threshold_pct}% run-up")

        if results:
            print(f"\nTop 10 performers:")
            for i, result in enumerate(results[:10], 1):
                print(f"  {i}. {result.symbol}: {result.runup_pct:.2f}% "
                      f"(${result.premarket_open:.2f} -> ${result.day_high:.2f})")

        return results

    def save_results(self, results: List[RunUpResult], date: str, output_dir: str = "."):
        """Save analysis results to JSON and CSV."""
        from pathlib import Path
        import json

        output_path = Path(output_dir)

        # JSON format
        json_data = {
            'date': date,
            'threshold_pct': self.threshold_pct,
            'count': len(results),
            'symbols': [
                {
                    'symbol': r.symbol,
                    'premarket_open': r.premarket_open,
                    'day_high': r.day_high,
                    'runup_pct': r.runup_pct,
                    'day_low': r.day_low,
                    'day_close': r.day_close,
                    'volume': r.volume
                }
                for r in results
            ]
        }

        json_file = output_path / f'runup_analysis_{date}.json'
        with open(json_file, 'w') as f:
            json.dump(json_data, f, indent=2)

        # CSV format
        if results:
            df = pd.DataFrame([
                {
                    'symbol': r.symbol,
                    'premarket_open': r.premarket_open,
                    'day_high': r.day_high,
                    'runup_pct': r.runup_pct,
                    'day_low': r.day_low,
                    'day_close': r.day_close,
                    'volume': r.volume
                }
                for r in results
            ])
            csv_file = output_path / f'runup_analysis_{date}.csv'
            df.to_csv(csv_file, index=False)

        print(f"\n[SUCCESS] Saved analysis to:")
        print(f"  {json_file}")
        if results:
            print(f"  {csv_file}")


class RvolRocAnalyzer:
    """Analyzes RVOL and ROC on resampled intraday data."""

    def __init__(
        self,
        rvol_threshold: float = Config.RVOL_THRESHOLD,
        roc_threshold: float = Config.ROC_THRESHOLD,
        rvol_length: int = Config.RVOL_LENGTH,
        roc_length: int = Config.ROC_LENGTH,
        resample_interval: str = Config.OHLCV_RESAMPLE_INTERVAL
    ):
        self.rvol_threshold = rvol_threshold
        self.roc_threshold = roc_threshold
        self.rvol_length = rvol_length
        self.roc_length = roc_length
        self.resample_interval = resample_interval

    def resample_to_10s(self, df_1s: pd.DataFrame) -> pd.DataFrame:
        """
        Resample 1-second OHLCV data to 10-second bars.

        Args:
            df_1s: DataFrame with 1-second OHLCV data (timestamp in index or ts_event column)

        Returns:
            DataFrame with 10-second resampled bars
        """
        if df_1s.empty:
            return df_1s

        df_1s = df_1s.copy()

        # Databento returns data with timestamp as index, not as column
        # Check if we need to reset the index to get ts_event as a column
        if df_1s.index.name == 'ts_event' or 'ts_event' not in df_1s.columns:
            # Reset index to make ts_event a column
            df_1s = df_1s.reset_index()

        # Ensure ts_event is datetime
        if not pd.api.types.is_datetime64_any_dtype(df_1s['ts_event']):
            df_1s['ts_event'] = pd.to_datetime(df_1s['ts_event'])

        # Group by symbol and resample
        resampled_dfs = []

        for symbol in df_1s['symbol'].unique():
            symbol_data = df_1s[df_1s['symbol'] == symbol].copy()
            symbol_data = symbol_data.set_index('ts_event')

            # Resample using OHLC rules
            resampled = symbol_data.resample(self.resample_interval).agg({
                'open': 'first',
                'high': 'max',
                'low': 'min',
                'close': 'last',
                'volume': 'sum'
            })

            # Drop empty bars (no data in interval)
            resampled = resampled.dropna(subset=['close'])

            # Add symbol back
            resampled['symbol'] = symbol
            resampled = resampled.reset_index()

            resampled_dfs.append(resampled)

        if not resampled_dfs:
            return pd.DataFrame()

        result = pd.concat(resampled_dfs, ignore_index=True)
        return result

    def analyze_ohlcv_1s_data(
        self,
        df_1s: pd.DataFrame,
        runup_results: List[RunUpResult]
    ) -> List[RunUpResult]:
        """
        Analyze 1-second OHLCV data with RVOL/ROC filtering.

        Args:
            df_1s: DataFrame with 1-second OHLCV data
            runup_results: List of stocks that passed run-up filter

        Returns:
            Updated list with RVOL/ROC metrics populated and filtered
        """
        print(f"\n{'='*80}")
        print("Analyzing RVOL/ROC on 10-Second Bars")
        print(f"{'='*80}\n")
        print(f"RVOL Threshold: {self.rvol_threshold}")
        print(f"ROC Threshold: {self.roc_threshold}%")
        print(f"Resampling: 1s -> {self.resample_interval}")

        if df_1s.empty:
            print("[ERROR] No 1-second data provided")
            return []

        # Step 1: Resample to 10-second bars
        print(f"\nResampling {len(df_1s):,} 1-second bars...")
        df_10s = self.resample_to_10s(df_1s)
        print(f"[SUCCESS] Resampled to {len(df_10s):,} 10-second bars")

        # Step 2: Process each symbol that passed run-up filter
        results_with_rvol_roc = []
        symbols_dict = {r.symbol: r for r in runup_results}

        print(f"\nAnalyzing {len(symbols_dict)} symbols...")

        for symbol in symbols_dict.keys():
            symbol_data = df_10s[df_10s['symbol'] == symbol].copy()

            if symbol_data.empty or len(symbol_data) < max(self.rvol_length, self.roc_length):
                # Not enough data - skip
                continue

            # Sort by timestamp and set as index (required for RVOL/ROC functions)
            symbol_data = symbol_data.sort_values('ts_event').set_index('ts_event')

            # Calculate RVOL (requires DatetimeIndex)
            _, _, rvol_ratio = relative_volume(
                symbol_data,
                length=self.rvol_length,
                anchorTimeframe='5',
                isCumulative=False,
                adjustRealtime=False
            )
            symbol_data['rvol'] = rvol_ratio

            # Calculate ROC
            symbol_data['roc'] = roc(symbol_data['close'], length=self.roc_length)

            # Find max RVOL and ROC, and check if criteria met
            symbol_data = symbol_data.dropna(subset=['rvol', 'roc'])

            # Reset index to make ts_event a column for timestamp access
            symbol_data = symbol_data.reset_index()

            if symbol_data.empty:
                continue

            # Check if ANY bar meets BOTH criteria
            passed_bars = symbol_data[
                (symbol_data['rvol'] >= self.rvol_threshold) &
                (symbol_data['roc'] >= self.roc_threshold)
            ]

            # Get original result and update with RVOL/ROC metrics
            result = symbols_dict[symbol]

            if not passed_bars.empty:
                # Stock passed filter - get metrics from best bar
                best_bar = passed_bars.iloc[0]  # First bar that meets criteria
                result.max_rvol = float(best_bar['rvol'])
                result.max_roc = float(best_bar['roc'])
                result.rvol_roc_timestamp = str(best_bar['ts_event'])
                result.passed_rvol_roc = True
                results_with_rvol_roc.append(result)
            else:
                # Stock didn't pass - still record max values but don't include in results
                result.max_rvol = float(symbol_data['rvol'].max())
                result.max_roc = float(symbol_data['roc'].max())
                result.passed_rvol_roc = False
                # Don't add to results - filtered out

        print(f"\n[SUCCESS] {len(results_with_rvol_roc)} stocks passed RVOL/ROC filter (from {len(symbols_dict)} candidates)")

        if results_with_rvol_roc:
            print(f"\nTop 10 by RVOL:")
            sorted_by_rvol = sorted(results_with_rvol_roc, key=lambda x: x.max_rvol or 0, reverse=True)
            for i, result in enumerate(sorted_by_rvol[:10], 1):
                print(f"  {i}. {result.symbol}: RVOL={result.max_rvol:.2f}, ROC={result.max_roc:.2f}%")

        return results_with_rvol_roc
