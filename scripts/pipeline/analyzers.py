"""
Analysis modules for run-up calculation and pattern detection.
"""
import pandas as pd
from typing import List, Dict
from .config import Config
from .models import RunUpResult


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
