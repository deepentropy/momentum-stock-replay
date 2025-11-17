import pandas as pd
import numpy as np


def roc(source, length=9):
    """
    Calculate Rate of Change (ROC) indicator.

    Matches TradingView's Pinescript ROC calculation:
        roc = 100 * (source - source[length]) / source[length]

    Parameters
    ----------
    source : pd.Series or np.array
        Price series (typically close prices)
    length : int, default=9
        Lookback period

    Returns
    -------
    pd.Series or np.array
        ROC values. First 'length' values will be NaN.

    Examples
    --------
    >>> import pandas as pd
    >>> closes = pd.Series([100, 102, 101, 103, 105, 104, 106, 108, 107, 109, 110])
    >>> roc_values = roc(closes, length=9)
    >>> print(roc_values[9:])
    9     9.0
    10    7.843137
    dtype: float64
    """
    if isinstance(source, pd.Series):
        # Pandas implementation using shift
        return 100 * (source - source.shift(length)) / source.shift(length)
    else:
        # NumPy implementation
        source = np.array(source, dtype=float)
        roc_values = np.full(len(source), np.nan)

        for i in range(length, len(source)):
            roc_values[i] = 100 * (source[i] - source[i - length]) / source[i - length]

        return roc_values