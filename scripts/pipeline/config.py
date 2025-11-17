"""
Configuration and constants for the pipeline.
"""
import os
from pathlib import Path
from typing import Optional


class Config:
    """Global configuration for the pipeline."""

    # API Keys and Tokens
    STOCKFUNDAMENTALS_PAT: Optional[str] = os.environ.get('STOCKFUNDAMENTALS_PAT')
    DATABENTO_API_KEY: Optional[str] = os.environ.get('DATABENTO_API_KEY')

    # GitHub Repository
    FUNDAMENTALS_REPO = "deepentropy/stockfundamentals"
    FUNDAMENTALS_BRANCH = "main"
    FUNDAMENTALS_PATH = "data"

    # Stock Filtering Criteria
    MAX_SHARE_FLOAT = 100_000_000  # 100M shares
    MAX_MARKET_CAP = 300_000_000   # $300M
    MIN_PRICE = 1.0                # $1
    MAX_PRICE = 50.0               # $50

    # Run-up Analysis
    RUNUP_THRESHOLD_PCT = 30.0  # 30% run-up threshold

    # Databento Settings
    # Single dataset (legacy)
    DATABENTO_DATASET = 'XNAS.ITCH'  # NASDAQ only

    # Multi-exchange datasets for MBP-1 (most active US equity venues)
    DATABENTO_DATASETS_MBP1 = [
        'XNAS.ITCH',     # NASDAQ - Most active for small caps
        'XNYS.PILLAR',   # NYSE
        'IEXG.TOPS',     # IEX
        'ARCX.PILLAR',   # NYSE Arca
        'BATS.PITCH',    # Cboe BZX (formerly BATS)
        'XBOS.ITCH',     # NASDAQ BX
        'XPSX.ITCH',     # NASDAQ PSX
        # Add more if needed
    ]

    # Compression Settings
    PRICE_SCALE = 100_000   # 5 decimal places
    SIZE_SCALE = 100        # 2 decimal places
    TIME_UNIT = 1_000_000   # microseconds
    GZIP_LEVEL = 9

    # NBBO Resampling Settings
    NBBO_RESAMPLE_INTERVAL_MS = 100  # 100ms intervals for NBBO sampling

    # Directory Structure
    # Pipeline is now in scripts/pipeline/, so go up two levels to get to project root
    BASE_DIR = Path(__file__).parent.parent.parent
    TEMP_DIR = BASE_DIR / ".pipeline_temp"  # Temporary directory for intermediate files
    DATA_DIR_FUNDAMENTALS = TEMP_DIR / "fundamentals_data"
    DATA_DIR_OHLCV = TEMP_DIR / "databento_data"
    DATA_DIR_MBP1 = TEMP_DIR / "databento_mbp1_data"
    DATA_DIR_NBBO = TEMP_DIR / "databento_nbbo_data"  # Resampled NBBO data
    SESSIONS_DIR = BASE_DIR / "sessions"  # Output: committed to git
    SUMMARY_DIR = BASE_DIR / "summary"    # Output: committed to git

    # Binary Format
    BINARY_MAGIC = b'TICK'
    BINARY_VERSION_V2 = 2  # Version 2: all MBP-1 columns (legacy)
    BINARY_VERSION_V3 = 3  # Version 3: NBBO + exchange snapshots (new)
    BINARY_VERSION = 3     # Current version
    HEADER_SIZE_V2 = 18    # bytes (4 + 2 + 4 + 8) for V2
    ROW_SIZE_V2 = 64       # bytes (all MBP-1 columns) for V2

    @classmethod
    def validate(cls) -> bool:
        """Validate that required configuration is present."""
        errors = []

        if not cls.STOCKFUNDAMENTALS_PAT:
            errors.append("STOCKFUNDAMENTALS_PAT environment variable not set")

        if not cls.DATABENTO_API_KEY:
            errors.append("DATABENTO_API_KEY environment variable not set")

        if errors:
            for error in errors:
                print(f"[ERROR] {error}")
            return False

        return True

    @classmethod
    def setup_directories(cls):
        """Create necessary directories."""
        for directory in [
            cls.TEMP_DIR,
            cls.DATA_DIR_FUNDAMENTALS,
            cls.DATA_DIR_OHLCV,
            cls.DATA_DIR_MBP1,
            cls.DATA_DIR_NBBO,
            cls.SESSIONS_DIR,
            cls.SUMMARY_DIR
        ]:
            directory.mkdir(parents=True, exist_ok=True)

    @classmethod
    def cleanup_temp(cls):
        """Clean up temporary directory."""
        import shutil
        if cls.TEMP_DIR.exists():
            shutil.rmtree(cls.TEMP_DIR)
            print(f"[CLEANUP] Removed temporary directory: {cls.TEMP_DIR}")
