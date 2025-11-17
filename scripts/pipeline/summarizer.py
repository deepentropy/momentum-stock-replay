"""
Summary generation for pipeline execution.
"""
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, Any

from .config import Config
from .models import PipelineResult


class SummaryGenerator:
    """Generates comprehensive summaries of pipeline execution."""

    def __init__(self, output_dir: Path = Config.SUMMARY_DIR):
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def generate(self, result: PipelineResult) -> Dict[str, Any]:
        """Generate comprehensive summary from pipeline result."""
        print(f"\n{'='*80}")
        print(f"Generating Pipeline Summary")
        print(f"{'='*80}\n")

        summary = {
            'date': result.date,
            'generated_at': datetime.utcnow().isoformat() + 'Z',
            'execution': {
                'started_at': result.started_at,
                'completed_at': result.completed_at,
                'duration_minutes': self._calculate_duration(result.started_at, result.completed_at)
            },
            'data_pipeline': {
                'fundamentals_total': result.fundamentals_count,
                'fundamentals_filtered': result.filtered_count,
                'ohlcv_symbols': result.ohlcv_symbols_count,
                'runup_analysis_passed': result.runup_passed_count,
                'mbp1_files_fetched': result.mbp1_files_count,
                'compressed_files': result.compressed_files_count
            },
            'run_up_analysis': {
                'threshold_pct': Config.RUNUP_THRESHOLD_PCT,
                'symbols_passing': result.runup_passed_count,
                'top_performers': [
                    {
                        'symbol': r.symbol,
                        'runup_pct': r.runup_pct,
                        'premarket_open': r.premarket_open,
                        'day_high': r.day_high
                    }
                    for r in result.runup_results[:10]  # Top 10
                ]
            },
            'compression_stats': {
                'files_compressed': len(result.compression_stats),
                'total_rows': sum(c.num_rows for c in result.compression_stats),
                'total_compressed_mb': sum(c.compressed_size_mb for c in result.compression_stats),
                'avg_compression_ratio': (
                    sum(c.compression_ratio for c in result.compression_stats) / len(result.compression_stats)
                    if result.compression_stats else 0
                ),
                'files': [
                    {
                        'symbol': c.symbol,
                        'rows': c.num_rows,
                        'compressed_mb': c.compressed_size_mb,
                        'ratio': c.compression_ratio
                    }
                    for c in result.compression_stats
                ]
            },
            'market_insights': self._generate_insights(result),
            'errors': result.errors,
            'execution_log': result.execution_log
        }

        # Save summary
        output_file = self.output_dir / f'{result.date}_summary.json'
        with open(output_file, 'w') as f:
            json.dump(summary, f, indent=2)

        print(f"[SUCCESS] Summary saved to: {output_file}")
        print(f"\nKey Metrics:")
        print(f"  • Fundamentals filtered: {result.filtered_count}")
        print(f"  • Run-up analysis passed: {result.runup_passed_count} (>{Config.RUNUP_THRESHOLD_PCT}%)")
        print(f"  • MBP-1 files fetched: {result.mbp1_files_count}")
        print(f"  • Compressed files: {result.compressed_files_count}")
        if result.compression_stats:
            avg_ratio = sum(c.compression_ratio for c in result.compression_stats) / len(result.compression_stats)
            print(f"  • Avg compression ratio: {avg_ratio:.2f}x")

        return summary

    def _calculate_duration(self, start: str, end: str = None) -> float:
        """Calculate duration in minutes."""
        if not end:
            return 0.0

        try:
            start_dt = datetime.fromisoformat(start.replace('Z', '+00:00'))
            end_dt = datetime.fromisoformat(end.replace('Z', '+00:00'))
            duration = (end_dt - start_dt).total_seconds() / 60
            return round(duration, 2)
        except:
            return 0.0

    def _generate_insights(self, result: PipelineResult) -> Dict[str, Any]:
        """Generate market insights from the data."""
        insights = {}

        if result.runup_results:
            runups = [r.runup_pct for r in result.runup_results]
            insights['runup_statistics'] = {
                'max': max(runups),
                'min': min(runups),
                'avg': sum(runups) / len(runups),
                'count': len(runups)
            }

        if result.compression_stats:
            insights['data_efficiency'] = {
                'total_quotes': sum(c.num_rows for c in result.compression_stats),
                'total_size_mb': sum(c.compressed_size_mb for c in result.compression_stats),
                'avg_quotes_per_symbol': (
                    sum(c.num_rows for c in result.compression_stats) / len(result.compression_stats)
                )
            }

        return insights
