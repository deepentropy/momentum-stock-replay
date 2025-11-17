"""
Data models and schemas.
"""
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any
from datetime import datetime, UTC


@dataclass
class StockFundamentals:
    """Fundamental data for a stock."""
    symbol: str
    market_cap: Optional[float] = None
    share_float: Optional[float] = None
    price: Optional[float] = None
    company_name: Optional[str] = None
    exchange: Optional[str] = None
    raw_data: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RunUpResult:
    """Result of run-up analysis for a stock."""
    symbol: str
    premarket_open: float
    day_high: float
    runup_pct: float
    day_low: Optional[float] = None
    day_close: Optional[float] = None
    volume: Optional[int] = None

    # RVOL/ROC filtering results
    max_rvol: Optional[float] = None
    max_roc: Optional[float] = None
    rvol_roc_timestamp: Optional[str] = None
    passed_rvol_roc: bool = False


@dataclass
class CompressionStats:
    """Statistics from compression operation."""
    symbol: str
    date: str
    input_file: str
    output_file: str
    num_rows: int
    original_size_mb: float
    compressed_size_mb: float
    compression_ratio: float
    compression_pct: float


@dataclass
class PipelineResult:
    """Complete pipeline execution result."""
    date: str
    started_at: str
    completed_at: Optional[str] = None

    # Step results
    fundamentals_count: int = 0
    filtered_count: int = 0
    ohlcv_symbols_count: int = 0
    runup_passed_count: int = 0
    rvol_roc_passed_count: int = 0
    mbp1_files_count: int = 0
    compressed_files_count: int = 0

    # Data collected
    runup_results: List[RunUpResult] = field(default_factory=list)
    compression_stats: List[CompressionStats] = field(default_factory=list)

    # Errors
    errors: List[Dict[str, str]] = field(default_factory=list)

    # Metadata
    execution_log: List[Dict[str, Any]] = field(default_factory=list)

    def add_error(self, step: str, error: str):
        """Add an error to the result."""
        self.errors.append({
            'step': step,
            'error': error,
            'timestamp': datetime.now(UTC).isoformat().replace('+00:00', 'Z')
        })

    def add_log(self, step: str, status: str, message: str = None):
        """Add a log entry."""
        entry = {
            'step': step,
            'status': status,
            'timestamp': datetime.now(UTC).isoformat().replace('+00:00', 'Z')
        }
        if message:
            entry['message'] = message
        self.execution_log.append(entry)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            'date': self.date,
            'started_at': self.started_at,
            'completed_at': self.completed_at,
            'fundamentals_count': self.fundamentals_count,
            'filtered_count': self.filtered_count,
            'ohlcv_symbols_count': self.ohlcv_symbols_count,
            'runup_passed_count': self.runup_passed_count,
            'rvol_roc_passed_count': self.rvol_roc_passed_count,
            'mbp1_files_count': self.mbp1_files_count,
            'compressed_files_count': self.compressed_files_count,
            'runup_results': [
                {
                    'symbol': r.symbol,
                    'premarket_open': r.premarket_open,
                    'day_high': r.day_high,
                    'runup_pct': r.runup_pct,
                    'max_rvol': r.max_rvol,
                    'max_roc': r.max_roc,
                    'passed_rvol_roc': r.passed_rvol_roc
                }
                for r in self.runup_results
            ],
            'compression_stats': [
                {
                    'symbol': c.symbol,
                    'num_rows': c.num_rows,
                    'compressed_size_mb': c.compressed_size_mb,
                    'compression_ratio': c.compression_ratio
                }
                for c in self.compression_stats
            ],
            'errors': self.errors,
            'execution_log': self.execution_log
        }
