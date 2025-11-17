import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Tuple, List, Optional
import bisect


class RelativeVolume:
    """
    Python implementation of TradingView's relativeVolume function.

    This class maintains state across bars to calculate:
    1. Current volume (cumulative or non-cumulative)
    2. Historical average volume at equivalent time offsets
    3. Ratio of current to historical average volume
    """

    def __init__(self):
        # Store historical data for each completed period (limited to 'length')
        self.historical_periods = []
        # Current period data
        self.current_period = {
            'data': [],
            'times': [],
            'start_time': None
        }
        # For cumulative calculations - STORAGE (never adjusted for realtime)
        self.cumulative_sum_storage = 0.0
        self.last_anchor_time_storage = None

    def _maintain_array(self, max_length: int, new_data: dict) -> None:
        """
        Maintains the historical_periods array at a maximum length.
        When adding new data, if array exceeds max_length, removes oldest element.

        This matches Pinescript's maintainArray behavior.

        Args:
            max_length: Maximum number of periods to keep
            new_data: The new period data to potentially add
        """
        if len(self.historical_periods) >= max_length:
            self.historical_periods.pop(0)  # Remove oldest

    def _parse_timeframe(self, anchorTimeframe: str) -> Tuple[int, str]:
        """
        Parses a TradingView timeframe string into multiplier and unit.

        Timeframe format rules:
        - Composed of multiplier + unit: "1S", "30" (minutes), "1D", "3M"
        - Units: T (ticks), S (seconds), no letter (minutes), D (days), W (weeks), M (months)
        - No multiplier assumes 1: "S" = "1S", "D" = "1D"
        - Only "1" = 1 minute
        - No hour unit exists (use minutes, e.g., "60" for 1 hour)

        Args:
            anchorTimeframe: TradingView timeframe string

        Returns:
            Tuple of (multiplier, unit) where unit is 'T', 'S', 'min', 'D', 'W', or 'M'

        Raises:
            ValueError: If timeframe format is invalid
        """
        if not anchorTimeframe:
            raise ValueError("anchorTimeframe cannot be empty")

        # Extract unit (last character if it's a letter)
        if anchorTimeframe[-1].isalpha():
            unit = anchorTimeframe[-1].upper()
            multiplier_str = anchorTimeframe[:-1]
        else:
            # No unit letter means minutes
            unit = 'min'
            multiplier_str = anchorTimeframe

        # Parse multiplier
        if multiplier_str == '':
            multiplier = 1
        else:
            try:
                multiplier = int(multiplier_str)
            except ValueError:
                raise ValueError(f"Invalid timeframe multiplier: {multiplier_str}")

        # Validate unit
        valid_units = ['T', 'S', 'min', 'D', 'W', 'M']
        if unit not in valid_units:
            raise ValueError(f"Invalid timeframe unit: {unit}. Valid units are: T, S, (none for minutes), D, W, M")

        # Validate multiplier ranges
        if unit == 'T' and multiplier not in [1, 10, 100, 1000]:
            raise ValueError(f"Invalid tick multiplier: {multiplier}. Valid: 1, 10, 100, 1000")
        elif unit == 'S' and multiplier not in [1, 5, 10, 15, 30, 45]:
            raise ValueError(f"Invalid second multiplier: {multiplier}. Valid: 1, 5, 10, 15, 30, 45")
        elif unit == 'min' and not (1 <= multiplier <= 1440):
            raise ValueError(f"Invalid minute multiplier: {multiplier}. Valid: 1-1440")
        elif unit == 'D' and not (1 <= multiplier <= 365):
            raise ValueError(f"Invalid day multiplier: {multiplier}. Valid: 1-365")
        elif unit == 'W' and not (1 <= multiplier <= 52):
            raise ValueError(f"Invalid week multiplier: {multiplier}. Valid: 1-52")
        elif unit == 'M' and not (1 <= multiplier <= 12):
            raise ValueError(f"Invalid month multiplier: {multiplier}. Valid: 1-12")

        return multiplier, unit

    def _get_timeframe_boundary(self, timestamp, anchorTimeframe: str) -> pd.Timestamp:
        """
        Gets the timeframe boundary (like Pinescript's time(timeframe)).

        This returns the opening time of the timeframe bar that contains the timestamp.

        Args:
            timestamp: Current bar timestamp (pd.Timestamp or int/datetime-like)
            anchorTimeframe: TradingView timeframe string

        Returns:
            The timeframe boundary timestamp
        """
        # Ensure timestamp is a pd.Timestamp
        if not isinstance(timestamp, pd.Timestamp):
            timestamp = pd.Timestamp(timestamp)

        multiplier, unit = self._parse_timeframe(anchorTimeframe)

        if unit == 'S':
            # Floor to seconds
            freq = f'{multiplier}S'
            return timestamp.floor(freq)
        elif unit == 'min':
            # Floor to minutes
            freq = f'{multiplier}min'
            return timestamp.floor(freq)
        elif unit == 'D':
            # Floor to days
            freq = f'{multiplier}D'
            return timestamp.floor(freq)
        elif unit == 'W':
            # Floor to weeks (Monday start)
            freq = f'{multiplier}W-MON'
            return timestamp.floor(freq)
        elif unit == 'M':
            # Floor to months
            freq = f'{multiplier}MS'  # MS = Month Start
            return timestamp.floor(freq)
        else:
            raise ValueError(f"Unsupported timeframe unit for boundary calculation: {unit}")

    def _anchor_condition(self, timestamp, prev_timestamp: Optional[pd.Timestamp],
                          anchorTimeframe: str) -> bool:
        """
        Determines if we've crossed into a new anchor period.
        Matches Pinescript's timeframe.change(timeframe).

        Args:
            timestamp: Current bar timestamp (pd.Timestamp or datetime-like)
            prev_timestamp: Previous bar timestamp
            anchorTimeframe: TradingView timeframe string

        Returns:
            True if we've entered a new period
        """
        if prev_timestamp is None:
            return True

        # Ensure timestamps are pd.Timestamp objects
        if not isinstance(timestamp, pd.Timestamp):
            timestamp = pd.Timestamp(timestamp)
        if not isinstance(prev_timestamp, pd.Timestamp):
            prev_timestamp = pd.Timestamp(prev_timestamp)

        # Get the timeframe boundaries for both timestamps
        curr_boundary = self._get_timeframe_boundary(timestamp, anchorTimeframe)
        prev_boundary = self._get_timeframe_boundary(prev_timestamp, anchorTimeframe)

        # Anchor is true when we cross into a new timeframe boundary
        return curr_boundary != prev_boundary

    def _get_bar_close_time(self, timestamp: pd.Timestamp, next_timestamp: Optional[pd.Timestamp],
                            bar_interval: Optional[timedelta], is_last_bar: bool) -> Optional[pd.Timestamp]:
        """
        Calculates the bar close time.

        For historical bars: uses the next bar's open time
        For the last (realtime) bar: returns None (unpredictable for some chart types)

        Args:
            timestamp: Current bar timestamp
            next_timestamp: Next bar timestamp (if available)
            bar_interval: Estimated bar interval
            is_last_bar: Whether this is the most recent bar

        Returns:
            Bar close time or None for realtime bars
        """
        if is_last_bar:
            # On the last bar, time_close is unpredictable for some chart types
            # We'll return None to indicate this
            return None

        if next_timestamp is not None:
            return next_timestamp

        # Fallback: estimate based on bar interval
        if bar_interval is not None:
            return timestamp + bar_interval

        return None

    def _calc_cumulative_series_storage(self, volume: float, anchor: bool,
                                        current_time) -> float:
        """
        Calculates cumulative sum of volume since last anchor FOR STORAGE.
        This version never applies adjustRealtime adjustments.

        Args:
            volume: Current bar volume
            anchor: Whether this bar triggers a new period
            current_time: Current timestamp (pd.Timestamp or datetime-like)

        Returns:
            Cumulative volume (unadjusted)
        """
        # Ensure current_time is a pd.Timestamp
        if not isinstance(current_time, pd.Timestamp):
            current_time = pd.Timestamp(current_time)

        if anchor:
            self.cumulative_sum_storage = 0.0
            self.last_anchor_time_storage = current_time

        self.cumulative_sum_storage += volume

        return self.cumulative_sum_storage

    def _calc_cumulative_series_output(self, volume: float, anchor: bool,
                                       adjustRealtime: bool, current_time,
                                       bar_close_time: Optional[pd.Timestamp],
                                       is_last_bar: bool, cumulative_sum_base: float) -> float:
        """
        Calculates the OUTPUT cumulative sum with optional realtime adjustment.

        Args:
            volume: Current bar volume
            anchor: Whether this bar triggers a new period
            adjustRealtime: Whether to estimate incomplete bar values
            current_time: Current timestamp (pd.Timestamp or datetime-like)
            bar_close_time: When the current bar will close (None for realtime bars)
            is_last_bar: Whether this is the most recent (unclosed) bar
            cumulative_sum_base: The base cumulative sum (from storage)

        Returns:
            Cumulative volume (potentially adjusted)
        """
        # Ensure current_time is a pd.Timestamp
        if not isinstance(current_time, pd.Timestamp):
            current_time = pd.Timestamp(current_time)

        # Start with the storage cumulative sum
        result = cumulative_sum_base

        # Adjust for realtime (incomplete) bars
        # Only applies when adjustRealtime=True, on unclosed bars, and we have valid times
        if adjustRealtime and is_last_bar and self.last_anchor_time_storage is not None and bar_close_time is not None:
            # Convert to Unix timestamps (milliseconds)
            current_unix = int(current_time.timestamp() * 1000)
            last_anchor_unix = int(self.last_anchor_time_storage.timestamp() * 1000)
            close_unix = int(bar_close_time.timestamp() * 1000)

            # Use timenow as current time for realtime bar
            # For historical data, this would be the bar's open time
            time_passed = current_unix - last_anchor_unix
            time_total = close_unix - last_anchor_unix

            if time_passed > 0 and time_total > 0:
                current_ratio = result / time_passed
                result = current_ratio * time_total

        return result

    def _calc_average_by_time(self, time_offset_ms: float) -> float:
        """
        Calculates the average value at the given time offset from historical periods.

        Matches Pinescript's calcAverageByTime which uses binary_search_leftmost.

        Args:
            time_offset_ms: Time offset from start of current period in milliseconds

        Returns:
            Average volume at this time offset across historical periods
        """
        if len(self.historical_periods) == 0:
            return np.nan

        values_at_offset = []

        for period in self.historical_periods:
            if len(period['times']) == 0:
                continue

            start_time_ms = period['start_time']
            target_time = start_time_ms + time_offset_ms

            # Binary search leftmost: find the index where target_time would be inserted
            # This gives us the bar whose time is >= target_time
            times_list = period['times']
            index = bisect.bisect_left(times_list, target_time)

            # If index is within bounds, use that data point
            # Otherwise, use the last available value from that period
            if index < len(period['data']):
                value = period['data'][index]
            else:
                # Use the last value if we've exceeded the period's data
                value = period['data'][-1] if len(period['data']) > 0 else np.nan

            if not np.isnan(value):
                values_at_offset.append(value)

        return np.mean(values_at_offset) if values_at_offset else np.nan

    def calculate(self, df: pd.DataFrame, length: int = 10,
                  anchorTimeframe: str = 'D', isCumulative: bool = True,
                  adjustRealtime: bool = False) -> Tuple[pd.Series, pd.Series, pd.Series]:
        """
        Main function to calculate relative volume metrics.

        Args:
            df: DataFrame with 'volume' column and DatetimeIndex
            length: Number of historical periods to average
            anchorTimeframe: Anchor timeframe ('D', 'W', 'M', etc.)
            isCumulative: Whether to accumulate volume within periods
            adjustRealtime: Whether to adjust the last bar estimate

        Returns:
            Tuple of (current_volume, historical_avg_volume, volume_ratio) as Series

        Raises:
            ValueError: If df doesn't have required structure
            TypeError: If df.index is not a DatetimeIndex
        """
        # Validate DataFrame structure
        if not isinstance(df.index, pd.DatetimeIndex):
            raise TypeError(
                f"DataFrame index must be a DatetimeIndex, got {type(df.index).__name__}. "
                f"Use df.set_index('time_column') if your timestamps are in a column."
            )

        if 'volume' not in df.columns:
            raise ValueError(
                f"DataFrame must have a 'volume' column. "
                f"Found columns: {list(df.columns)}"
            )

        # Reset state
        self.__init__()

        current_volumes = []
        historical_volumes = []
        volume_ratios = []

        prev_timestamp = None

        # Calculate bar interval for time_close estimation
        if len(df) > 1:
            bar_interval = df.index[1] - df.index[0]
        else:
            bar_interval = None

        for idx, (timestamp, row) in enumerate(df.iterrows()):
            volume = row['volume']
            is_last_bar = (idx == len(df) - 1)

            # Determine if anchor condition is met (like timeframe.change(timeframe))
            anchor = self._anchor_condition(timestamp, prev_timestamp, anchorTimeframe)

            # Calculate bar close time
            next_timestamp = df.index[idx + 1] if idx < len(df) - 1 else None
            bar_close_time = self._get_bar_close_time(timestamp, next_timestamp,
                                                      bar_interval, is_last_bar)

            # Get the timeframe boundary (like time(timeframe) in Pinescript)
            timeframe_boundary = self._get_timeframe_boundary(timestamp, anchorTimeframe)
            timeframe_boundary_ms = int(timeframe_boundary.timestamp() * 1000)

            # Handle new anchor period
            if anchor:
                # Save completed period to historical data
                if self.current_period['start_time'] is not None and len(self.current_period['data']) > 0:
                    new_period = {
                        'data': self.current_period['data'].copy(),
                        'times': self.current_period['times'].copy(),
                        'start_time': self.current_period['start_time']
                    }

                    # Maintain array at max length before adding
                    self._maintain_array(length, new_period)

                    # Add the new period
                    self.historical_periods.append(new_period)

                # Start new period with timeframe boundary as startTime
                # This matches: collectedData.new(array.new<float>(), array.new<int>(), time(timeframe))
                self.current_period = {
                    'data': [],
                    'times': [],
                    'start_time': timeframe_boundary_ms
                }

            # Calculate current volume
            if isCumulative:
                # Calculate storage cumulative (never adjusted)
                curr_vol_storage = self._calc_cumulative_series_storage(volume, anchor, timestamp)

                # Calculate output cumulative (with adjustRealtime if requested)
                curr_vol = self._calc_cumulative_series_output(
                    volume, anchor, adjustRealtime, timestamp, bar_close_time,
                    is_last_bar, curr_vol_storage
                )
            else:
                curr_vol = volume
                curr_vol_storage = volume

            # Add to current period (store the UNADJUSTED cumulative for historical averaging)
            # Store current bar time (not timeframe boundary)
            current_time_ms = int(timestamp.timestamp() * 1000)
            self.current_period['times'].append(current_time_ms)
            self.current_period['data'].append(curr_vol_storage)

            # Calculate historical average at current time offset
            # Offset is from timeframe boundary, matching: time - newData.startTime
            if self.current_period['start_time'] is not None:
                time_offset_ms = current_time_ms - self.current_period['start_time']
                past_vol = self._calc_average_by_time(time_offset_ms)
            else:
                past_vol = np.nan

            # Calculate ratio
            vol_ratio = curr_vol / past_vol if past_vol and past_vol > 0 and not np.isnan(past_vol) else np.nan

            current_volumes.append(curr_vol)
            historical_volumes.append(past_vol)
            volume_ratios.append(vol_ratio)

            prev_timestamp = timestamp

        return (
            pd.Series(current_volumes, index=df.index, name='current_volume'),
            pd.Series(historical_volumes, index=df.index, name='historical_avg_volume'),
            pd.Series(volume_ratios, index=df.index, name='volume_ratio')
        )


def relative_volume(df: pd.DataFrame, length: int = 10,
                    anchorTimeframe: str = 'D', isCumulative: bool = True,
                    adjustRealtime: bool = False) -> Tuple[pd.Series, pd.Series, pd.Series]:
    """
    Convenience function matching Pinescript's relativeVolume signature.

    Args:
        df: DataFrame with 'volume' column and DatetimeIndex
        length: Number of periods for historical average
        anchorTimeframe: Anchor timeframe ('D', 'W', 'M', etc.)
        isCumulative: Accumulate volume within periods
        adjustRealtime: Adjust last bar estimate

    Returns:
        Tuple of (current_volume, historical_avg_volume, volume_ratio)
    """
    rv = RelativeVolume()
    return rv.calculate(df, length, anchorTimeframe, isCumulative, adjustRealtime)


# Example usage
if __name__ == "__main__":
    # Create sample data
    dates = pd.date_range('2024-01-01 09:30', periods=500, freq='1min')
    np.random.seed(42)
    volumes = np.random.randint(1000, 10000, size=500)

    df = pd.DataFrame({'volume': volumes}, index=dates)

    # Calculate relative volume with 5-minute anchors
    curr_vol, hist_vol, vol_ratio = relative_volume(
        df,
        length=10,
        anchorTimeframe='5',
        isCumulative=True,
        adjustRealtime=False
    )

    print("Last 10 bars:")
    print(pd.DataFrame({
        'volume': df['volume'].tail(10),
        'current_vol': curr_vol.tail(10),
        'historical_avg': hist_vol.tail(10),
        'ratio': vol_ratio.tail(10)
    }))