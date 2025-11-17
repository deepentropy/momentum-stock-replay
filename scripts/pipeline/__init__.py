"""
Unified momentum stock data pipeline.

This package provides a complete end-to-end pipeline for:
- Fetching and filtering fundamental data
- Downloading market data (OHLCV, MBP-1)
- Analyzing momentum and run-ups
- Compressing data for storage
- Generating comprehensive summaries
"""

__version__ = "1.0.0"
__all__ = [
    "config",
    "models",
    "fetchers",
    "analyzers",
    "compressor",
    "summarizer",
    "pipeline"
]
