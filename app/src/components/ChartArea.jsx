import React, { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { createChart, LineSeries, CandlestickSeries } from "lightweight-charts";
import LoadingSpinner from "./LoadingSpinner";

const ChartArea = forwardRef(({ sessionData, isLoading, chartType, timeframe }, ref) => {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const seriesRefs = useRef({ bid: null, ask: null, mid: null, candlestick: null });
  const resizeObserverRef = useRef(null);
  const lastQuoteCountRef = useRef(0);
  const markersRef = useRef([]);
  const markerSeriesRef = useRef(null);

  const allTicksData = useRef([]);
  const aggregatedLineData = useRef({ bid: [], ask: [], mid: [] });
  const aggregatedCandleData = useRef([]);

  // Expose method to add markers
  useImperativeHandle(ref, () => ({
    addMarker: (marker) => {
      markersRef.current.push(marker);
      updateMarkers();
    },
    clearMarkers: () => {
      markersRef.current = [];
      updateMarkers();
    }
  }));

  const updateMarkers = () => {
    // Determine which series to use for markers based on chart type
    const targetSeries = chartType === 'candlestick'
      ? seriesRefs.current.candlestick
      : seriesRefs.current.mid;

    if (targetSeries) {
      targetSeries.setMarkers(markersRef.current);
    }
  };

  useEffect(() => {
    if (!chartRef.current || chartInstance.current) return;

    const chart = createChart(chartRef.current, {
      layout: {
        background: { color: "#131722" },
        textColor: "#787B86"
      },
      grid: {
        vertLines: { color: "#1E222D" },
        horzLines: { color: "#1E222D" }
      },
      leftPriceScale: {
        borderColor: "#2A2E39",
        visible: false
      },
      rightPriceScale: {
        borderColor: "#2A2E39",
        visible: true
      },
      timeScale: {
        borderColor: "#2A2E39",
        timeVisible: true,
        secondsVisible: true,
        tickMarkFormatter: (time) => {
          const date = new Date(time * 1000);
          return date.toLocaleTimeString('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });
        },
      },
      localization: {
        timeFormatter: (time) => {
          const date = new Date(time * 1000);
          return date.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          });
        },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: '#787B86',
          width: 1,
          style: 3,
          labelBackgroundColor: '#2962FF',
        },
        horzLine: {
          color: '#787B86',
          width: 1,
          style: 3,
          labelBackgroundColor: '#2962FF',
        },
      },
      width: chartRef.current.clientWidth,
      height: chartRef.current.clientHeight,
    });

    chartInstance.current = chart;

    seriesRefs.current.bid = chart.addSeries(LineSeries, {
      color: "#F23645",
      lineWidth: 2,
      title: "Bid",
      lastValueVisible: true,
      priceLineVisible: true,
    });

    seriesRefs.current.ask = chart.addSeries(LineSeries, {
      color: "#089981",
      lineWidth: 2,
      title: "Ask",
      lastValueVisible: true,
      priceLineVisible: true,
    });

    seriesRefs.current.mid = chart.addSeries(LineSeries, {
      color: "#2962FF",
      lineWidth: 2,
      title: "Mid",
      lastValueVisible: true,
      priceLineVisible: false,
    });

    seriesRefs.current.candlestick = chart.addSeries(CandlestickSeries, {
      upColor: '#089981',
      downColor: '#F23645',
      borderVisible: false,
      wickUpColor: '#089981',
      wickDownColor: '#F23645',
    });

    resizeObserverRef.current = new ResizeObserver((entries) => {
      if (!entries.length || !chartRef.current) return;
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        chart.applyOptions({ width, height });
      }
    });

    resizeObserverRef.current.observe(chartRef.current);

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      if (markerSeriesRef.current) {
        markerSeriesRef.current = null;
      }
      if (chartInstance.current) {
        chart.remove();
        chartInstance.current = null;
      }
    };
  }, []);

  const updateTimeScale = (tf) => {
    if (!chartInstance.current) return;

    chartInstance.current.timeScale().applyOptions({
      tickMarkFormatter: (time, tickMarkType, locale) => {
        const date = new Date(time * 1000);

        if (tf >= 60) {
          return date.toLocaleTimeString('en-US', {
            hour12: false,
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit'
          });
        } else {
          return date.toLocaleTimeString('en-US', {
            hour12: false,
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
        }
      },
      minBarSpacing: tf === 1 ? 0.001 : tf <= 10 ? 0.01 : tf === 60 ? 0.5 : 2,
    });
  };

  useEffect(() => {
    if (!seriesRefs.current.bid) return;

    if (chartType === 'line') {
      seriesRefs.current.bid.applyOptions({ visible: true });
      seriesRefs.current.ask.applyOptions({ visible: true });
      seriesRefs.current.mid.applyOptions({ visible: true });
      seriesRefs.current.candlestick.applyOptions({ visible: false });
    } else {
      seriesRefs.current.bid.applyOptions({ visible: false });
      seriesRefs.current.ask.applyOptions({ visible: false });
      seriesRefs.current.mid.applyOptions({ visible: false });
      seriesRefs.current.candlestick.applyOptions({ visible: true });
    }

    // Update markers when chart type changes
    if (markersRef.current.length > 0) {
      updateMarkers();
    }
  }, [chartType]);

  useEffect(() => {
    if (!seriesRefs.current.candlestick || allTicksData.current.length === 0) return;

    const newLineData = aggregateLineData(allTicksData.current, timeframe);
    aggregatedLineData.current = newLineData;

    const newCandleData = aggregateCandleData(allTicksData.current, timeframe);
    aggregatedCandleData.current = newCandleData;

    seriesRefs.current.bid.setData(newLineData.bid);
    seriesRefs.current.ask.setData(newLineData.ask);
    seriesRefs.current.mid.setData(newLineData.mid);
    seriesRefs.current.candlestick.setData(newCandleData);

    updateTimeScale(timeframe);
    chartInstance.current.timeScale().fitContent();

    // Reapply markers after data update
    if (markersRef.current.length > 0) {
      updateMarkers();
    }
  }, [timeframe]);

  useEffect(() => {
    const currentQuoteCount = sessionData.stats?.quoteCount || 0;

    if (lastQuoteCountRef.current > 0 && currentQuoteCount === 0) {
      if (seriesRefs.current.bid) {
        seriesRefs.current.bid.setData([]);
        seriesRefs.current.ask.setData([]);
        seriesRefs.current.mid.setData([]);
        seriesRefs.current.candlestick.setData([]);
        allTicksData.current = [];
        aggregatedLineData.current = { bid: [], ask: [], mid: [] };
        aggregatedCandleData.current = [];
        markersRef.current = [];
        markerSeriesRef.current = null;
      }
    }

    lastQuoteCountRef.current = currentQuoteCount;
  }, [sessionData.stats?.quoteCount]);

  const aggregateLineData = (ticks, tf) => {
    if (ticks.length === 0) return { bid: [], ask: [], mid: [] };

    const bidData = [], askData = [], midData = [];
    let currentTime = null, currentBid = null, currentAsk = null, currentMid = null;

    ticks.forEach(tick => {
      const bucketTime = Math.floor(tick.time / tf) * tf;

      if (currentTime !== bucketTime) {
        if (currentTime !== null) {
          bidData.push({ time: currentTime, value: currentBid });
          askData.push({ time: currentTime, value: currentAsk });
          midData.push({ time: currentTime, value: currentMid });
        }
        currentTime = bucketTime;
        currentBid = tick.bid;
        currentAsk = tick.ask;
        currentMid = tick.mid;
      } else {
        currentBid = tick.bid;
        currentAsk = tick.ask;
        currentMid = tick.mid;
      }
    });

    if (currentTime !== null) {
      bidData.push({ time: currentTime, value: currentBid });
      askData.push({ time: currentTime, value: currentAsk });
      midData.push({ time: currentTime, value: currentMid });
    }

    return { bid: bidData, ask: askData, mid: midData };
  };

  const aggregateCandleData = (ticks, tf) => {
    if (ticks.length === 0) return [];

    const candles = [];
    let currentCandle = null, currentCandleTime = null;

    ticks.forEach(tick => {
      const bucketTime = Math.floor(tick.time / tf) * tf;

      if (currentCandleTime !== bucketTime) {
        if (currentCandle) candles.push(currentCandle);
        currentCandleTime = bucketTime;
        currentCandle = {
          time: bucketTime,
          open: tick.mid,
          high: tick.mid,
          low: tick.mid,
          close: tick.mid,
        };
      } else {
        currentCandle.high = Math.max(currentCandle.high, tick.mid);
        currentCandle.low = Math.min(currentCandle.low, tick.mid);
        currentCandle.close = tick.mid;
      }
    });

    if (currentCandle) candles.push(currentCandle);
    return candles;
  };

  useEffect(() => {
    if (!sessionData.quote || !seriesRefs.current.bid) return;

    const { t, bid, ask } = sessionData.quote;
    const mid = (bid + ask) / 2;

    try {
      allTicksData.current.push({ time: t, bid, ask, mid });
      const bucketTime = Math.floor(t / timeframe) * timeframe;

      const updateLineSeries = (series, data, value) => {
        if (data.length === 0 || data[data.length - 1].time !== bucketTime) {
          const newPoint = { time: bucketTime, value: value };
          data.push(newPoint);
          series.update(newPoint);
        } else {
          data[data.length - 1].value = value;
          series.update({ time: bucketTime, value: value });
        }
      };

      updateLineSeries(seriesRefs.current.bid, aggregatedLineData.current.bid, bid);
      updateLineSeries(seriesRefs.current.ask, aggregatedLineData.current.ask, ask);
      updateLineSeries(seriesRefs.current.mid, aggregatedLineData.current.mid, mid);

      const candleData = aggregatedCandleData.current;
      if (candleData.length === 0 || candleData[candleData.length - 1].time !== bucketTime) {
        const newCandle = { time: bucketTime, open: mid, high: mid, low: mid, close: mid };
        candleData.push(newCandle);
        seriesRefs.current.candlestick.update(newCandle);
      } else {
        const lastCandle = candleData[candleData.length - 1];
        lastCandle.high = Math.max(lastCandle.high, mid);
        lastCandle.low = Math.min(lastCandle.low, mid);
        lastCandle.close = mid;
        seriesRefs.current.candlestick.update(lastCandle);
      }
    } catch (error) {
      console.error('Error updating chart:', error);
    }
  }, [sessionData.quote, timeframe]);

  return (
    <div className="relative w-full h-full bg-[#131722]">
      <div ref={chartRef} className="w-full h-full" />
      {isLoading && <LoadingSpinner message="Loading Session Data" />}
    </div>
  );
});

ChartArea.displayName = 'ChartArea';

export default ChartArea;