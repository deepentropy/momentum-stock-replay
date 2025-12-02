import React, { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { createChart, LineSeries, CandlestickSeries } from "lightweight-charts";
import LoadingSpinner from "./LoadingSpinner";
import { ta } from '@deepentropy/oakscriptjs';
// Import OakView for optional use with data provider
import '@deepentropy/oakview';

const ChartArea = forwardRef(({ 
  sessionData, 
  isLoading, 
  chartType, 
  timeframe, 
  previewData, 
  positionSummary,
  // New prop for OakView integration
  provider = null,
  onChartReady = null,
  onSessionChange = null
}, ref) => {
  const chartRef = useRef(null);
  const oakViewRef = useRef(null);
  const chartInstance = useRef(null);
  const seriesRefs = useRef({ bid: null, ask: null, mid: null, candlestick: null, ema9: null, ema20: null, ema9_1m: null, ema20_1m: null, ema9_5m: null, ema20_5m: null, positionAvg: null });
  const resizeObserverRef = useRef(null);
  const lastQuoteCountRef = useRef(0);
  const markersRef = useRef([]);
  const markerSeriesRef = useRef(null);
  const priceLineRefs = useRef({ bid: null, ask: null });

  const allTicksData = useRef([]);
  const aggregatedLineData = useRef({ bid: [], ask: [], mid: [] });
  const aggregatedCandleData = useRef([]);
  const emaData = useRef({ ema9: [], ema20: [], ema9_1m: [], ema20_1m: [], ema9_5m: [], ema20_5m: [] });
  const isPreviewDisplayed = useRef(false);
  
  // Track if we're using OakView mode
  const useOakView = Boolean(provider);

  // Expose method to add markers
  useImperativeHandle(ref, () => ({
    addMarker: (marker) => {
      markersRef.current.push(marker);
      updateMarkers();
    },
    clearMarkers: () => {
      markersRef.current = [];
      updateMarkers();
    },
    // Expose chart methods for OakView mode
    getChart: () => {
      if (useOakView && oakViewRef.current) {
        return oakViewRef.current.getChart?.();
      }
      return chartInstance.current;
    },
    getSeries: () => seriesRefs.current,
    fitContent: () => {
      if (chartInstance.current) {
        chartInstance.current.timeScale().fitContent();
      }
    }
  }));
  
  // Set up OakView when provider is available
  useEffect(() => {
    if (!provider || !oakViewRef.current) return;
    
    const oakView = oakViewRef.current;
    
    // Handle symbol-change event to sync session selection with React state
    const handleSymbolChange = (event) => {
      const sessionId = event.detail?.symbol;
      if (sessionId && onSessionChange) {
        // Retrieve session metadata from the provider
        const session = provider?.getSession?.(sessionId);
        if (session) {
          onSessionChange(session);
        }
      }
    };
    
    oakView.addEventListener('symbol-change', handleSymbolChange);
    
    // Initialize provider and set it on oak-view
    const initProvider = async () => {
      try {
        await provider.initialize({});
        oakView.setDataProvider(provider);
        
        // Register bar callback to update OakView chart during playback
        if (provider.setBarCallback) {
          provider.setBarCallback((bar, isFirstBar) => {
            // Get the actual chart component inside oak-view layout.
            // oak-view is a layout wrapper that can contain multiple charts.
            // We use index 0 as this layout uses a single chart configuration.
            if (typeof oakView.getChartAt !== 'function') {
              console.warn('⚠️ oak-view does not have getChartAt method');
              return;
            }
            const chartElement = oakView.getChartAt(0);
            if (!chartElement) {
              console.warn('⚠️ No chart element found in oak-view at index 0');
              return;
            }

            if (isFirstBar) {
              console.log('🔄 Clearing OakView preview, starting live playback');
              // Initialize chart with first bar instead of empty array
              // This properly resets the chart and avoids the "Cannot update oldest data" error
              if (chartElement.setData) {
                chartElement.setData([bar]);
              }
              return; // Don't call updateRealtime for first bar since setData already added it
            }
            
            // Subsequent bars use updateRealtime for efficient incremental updates
            if (chartElement.updateRealtime) {
              chartElement.updateRealtime(bar);
            } else {
              // Fallback to series.update if updateRealtime is not available
              const series = chartElement.getSeries?.();
              if (series && series.update) {
                series.update(bar);
              }
            }
          });
        }
        
        onChartReady?.(oakView);
        console.log('✅ OakView provider initialized');
      } catch (error) {
        console.error('❌ Failed to initialize OakView provider:', error);
      }
    };
    
    initProvider();
    
    return () => {
      oakView.removeEventListener('symbol-change', handleSymbolChange);
      provider.clearBarCallback?.();
      provider.disconnect();
    };
  }, [provider, onChartReady, onSessionChange]);

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
    // Skip creating the chart if we're using OakView mode
    if (useOakView) return;
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
        mode: 0,
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
      color: "#089981",
      lineWidth: 2,
      title: "Bid",
      lastValueVisible: true,
      priceLineVisible: true,
      lineVisible: false,
    });

    seriesRefs.current.ask = chart.addSeries(LineSeries, {
      color: "#F23645",
      lineWidth: 2,
      title: "Ask",
      lastValueVisible: true,
      priceLineVisible: true,
      lineVisible: false,
    });

    seriesRefs.current.mid = chart.addSeries(LineSeries, {
      color: "#2962FF",
      lineWidth: 2,
      title: "Mid",
      lastValueVisible: true,
      priceLineVisible: true,
      lineVisible: false,
    });

    // Create price lines for bid/ask to show current values only (after mid series is created)
    priceLineRefs.current.bid = seriesRefs.current.mid.createPriceLine({
      price: 0,
      color: '#089981',
      lineWidth: 2,
      lineStyle: 0,
      axisLabelVisible: true,
      title: 'Bid',
    });

    priceLineRefs.current.ask = seriesRefs.current.mid.createPriceLine({
      price: 0,
      color: '#F23645',
      lineWidth: 2,
      lineStyle: 0,
      axisLabelVisible: true,
      title: 'Ask',
    });

    seriesRefs.current.candlestick = chart.addSeries(CandlestickSeries, {
      upColor: '#089981',
      downColor: '#F23645',
      borderVisible: false,
      wickUpColor: '#089981',
      wickDownColor: '#F23645',
    });

    seriesRefs.current.ema9 = chart.addSeries(LineSeries, {
      color: "#FFA500",
      lineWidth: 2,
      title: "EMA 9 (10s)",
      lastValueVisible: true,
      priceLineVisible: false,
    });

    seriesRefs.current.ema20 = chart.addSeries(LineSeries, {
      color: "#9C27B0",
      lineWidth: 2,
      title: "EMA 20 (10s)",
      lastValueVisible: true,
      priceLineVisible: false,
    });

    seriesRefs.current.ema9_1m = chart.addSeries(LineSeries, {
      color: "#00FFFF",
      lineWidth: 2,
      title: "EMA 9 (1m)",
      lastValueVisible: true,
      priceLineVisible: false,
    });

    seriesRefs.current.ema20_1m = chart.addSeries(LineSeries, {
      color: "#FF00FF",
      lineWidth: 2,
      title: "EMA 20 (1m)",
      lastValueVisible: true,
      priceLineVisible: false,
    });

    seriesRefs.current.ema9_5m = chart.addSeries(LineSeries, {
      color: "#FFFF00",
      lineWidth: 3,
      title: "EMA 9 (5m)",
      lastValueVisible: true,
      priceLineVisible: false,
    });

    seriesRefs.current.ema20_5m = chart.addSeries(LineSeries, {
      color: "#00FF00",
      lineWidth: 3,
      title: "EMA 20 (5m)",
      lastValueVisible: true,
      priceLineVisible: false,
    });

    seriesRefs.current.positionAvg = chart.addSeries(LineSeries, {
      color: "#FFD700",
      lineWidth: 2,
      lineStyle: 2,
      title: "Entry",
      lastValueVisible: true,
      priceLineVisible: true,
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
      seriesRefs.current.bid.applyOptions({ visible: true, lineVisible: true });
      seriesRefs.current.ask.applyOptions({ visible: true, lineVisible: true });
      seriesRefs.current.mid.applyOptions({ visible: true });
      seriesRefs.current.candlestick.applyOptions({ visible: false });
    } else {
      seriesRefs.current.bid.applyOptions({ visible: true});
      seriesRefs.current.ask.applyOptions({ visible: true});
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

    // Calculate and update EMAs
    // Also aggregate to 1-minute and 5-minute for multi-timeframe EMAs
    const midData1m = aggregateLineData(allTicksData.current, 60).mid;
    const midData5m = aggregateLineData(allTicksData.current, 300).mid;
    const newEMAs = calculateEMAs(newLineData.mid, midData1m, midData5m);
    emaData.current = newEMAs;
    seriesRefs.current.ema9.setData(newEMAs.ema9);
    seriesRefs.current.ema20.setData(newEMAs.ema20);
    seriesRefs.current.ema9_1m.setData(newEMAs.ema9_1m);
    seriesRefs.current.ema20_1m.setData(newEMAs.ema20_1m);
    seriesRefs.current.ema9_5m.setData(newEMAs.ema9_5m);
    seriesRefs.current.ema20_5m.setData(newEMAs.ema20_5m);

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
        seriesRefs.current.ema9.setData([]);
        seriesRefs.current.ema20.setData([]);
        seriesRefs.current.ema9_1m.setData([]);
        seriesRefs.current.ema20_1m.setData([]);
        seriesRefs.current.ema9_5m.setData([]);
        seriesRefs.current.ema20_5m.setData([]);
        allTicksData.current = [];
        aggregatedLineData.current = { bid: [], ask: [], mid: [] };
        aggregatedCandleData.current = [];
        emaData.current = { ema9: [], ema20: [], ema9_1m: [], ema20_1m: [], ema9_5m: [], ema20_5m: [] };
        markersRef.current = [];
        markerSeriesRef.current = null;
        isPreviewDisplayed.current = false;
      }
    }

    lastQuoteCountRef.current = currentQuoteCount;
  }, [sessionData.stats?.quoteCount]);

  // Display preview data when available
  useEffect(() => {
    if (!previewData || !seriesRefs.current.bid) return;

    // Don't show preview if playback has started
    if (sessionData.stats?.quoteCount > 0) {
      return;
    }

    // Clear existing data first (important for session changes)
    console.log('🔄 Clearing chart for new preview');
    seriesRefs.current.bid.setData([]);
    seriesRefs.current.ask.setData([]);
    seriesRefs.current.mid.setData([]);
    seriesRefs.current.candlestick.setData([]);
    seriesRefs.current.ema9.setData([]);
    seriesRefs.current.ema20.setData([]);
    seriesRefs.current.ema9_1m.setData([]);
    seriesRefs.current.ema20_1m.setData([]);
    seriesRefs.current.ema9_5m.setData([]);
    seriesRefs.current.ema20_5m.setData([]);
    seriesRefs.current.positionAvg.setData([]);
    allTicksData.current = [];
    aggregatedLineData.current = { bid: [], ask: [], mid: [] };
    aggregatedCandleData.current = [];
    emaData.current = { ema9: [], ema20: [], ema9_1m: [], ema20_1m: [], ema9_5m: [], ema20_5m: [] };

    console.log('📊 Displaying preview with', previewData.length, 'ticks');

    // Check if this is NBBO data (V3 format)
    const isNBBO = previewData.length > 0 && previewData[0].nbbo === true;
    console.log(`📊 Preview data format: ${isNBBO ? 'V3 NBBO' : 'V2 Legacy'}`);
    if (previewData.length > 0) {
      console.log('📊 First tick:', {
        bid_price: previewData[0].bid_price,
        ask_price: previewData[0].ask_price,
        nbbo: previewData[0].nbbo,
        exchanges: previewData[0].exchanges?.length
      });
    }

    // Convert preview data to tick format
    const previewTicks = previewData.map(tick => ({
      time: tick.adjustedTimestamp,
      bid: parseFloat(tick.bid_price || tick.priceBid),
      ask: parseFloat(tick.ask_price || tick.priceAsk),
      mid: (parseFloat(tick.bid_price || tick.priceBid) + parseFloat(tick.ask_price || tick.priceAsk)) / 2
    }));

    // Aggregate data for preview
    const previewLineData = aggregateLineData(previewTicks, timeframe);
    const previewCandleData = aggregateCandleData(previewTicks, timeframe);

    // Set data to chart
    seriesRefs.current.bid.setData(previewLineData.bid);
    seriesRefs.current.ask.setData(previewLineData.ask);
    seriesRefs.current.mid.setData(previewLineData.mid);
    seriesRefs.current.candlestick.setData(previewCandleData);

    // Calculate and display EMAs for preview
    const previewLineData1m = aggregateLineData(previewTicks, 60).mid;
    const previewLineData5m = aggregateLineData(previewTicks, 300).mid;
    const previewEMAs = calculateEMAs(previewLineData.mid, previewLineData1m, previewLineData5m);
    seriesRefs.current.ema9.setData(previewEMAs.ema9);
    seriesRefs.current.ema20.setData(previewEMAs.ema20);
    seriesRefs.current.ema9_1m.setData(previewEMAs.ema9_1m);
    seriesRefs.current.ema20_1m.setData(previewEMAs.ema20_1m);
    seriesRefs.current.ema9_5m.setData(previewEMAs.ema9_5m);
    seriesRefs.current.ema20_5m.setData(previewEMAs.ema20_5m);

    // Fit content to show entire preview
    if (chartInstance.current) {
      chartInstance.current.timeScale().fitContent();
    }

    isPreviewDisplayed.current = true;
    console.log('✅ Preview displayed');
  }, [previewData, timeframe, sessionData.stats?.quoteCount]);

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

  const calculateEMAs = (midData, midData1m = null, midData5m = null) => {
    if (midData.length === 0) return { ema9: [], ema20: [], ema9_1m: [], ema20_1m: [], ema9_5m: [], ema20_5m: [] };

    // Extract close prices from mid data
    const closePrices = midData.map(d => d.value);

    // Calculate EMAs using oakscriptjs for current timeframe
    const ema9Values = ta.ema(closePrices, 9);
    const ema20Values = ta.ema(closePrices, 20);

    // Map back to chart format with timestamps
    const ema9Data = midData.map((d, i) => ({
      time: d.time,
      value: ema9Values[i]
    })).filter(d => d.value !== null && !isNaN(d.value));

    const ema20Data = midData.map((d, i) => ({
      time: d.time,
      value: ema20Values[i]
    })).filter(d => d.value !== null && !isNaN(d.value));

    // Calculate EMA9 and EMA20 on 1-minute data if provided
    let ema9_1mData = [];
    let ema20_1mData = [];
    if (midData1m && midData1m.length > 0) {
      const closePrices1m = midData1m.map(d => d.value);
      const ema9Values1m = ta.ema(closePrices1m, 9);
      const ema20Values1m = ta.ema(closePrices1m, 20);
      ema9_1mData = midData1m.map((d, i) => ({
        time: d.time,
        value: ema9Values1m[i]
      })).filter(d => d.value !== null && !isNaN(d.value));
      ema20_1mData = midData1m.map((d, i) => ({
        time: d.time,
        value: ema20Values1m[i]
      })).filter(d => d.value !== null && !isNaN(d.value));
    }

    // Calculate EMA9 and EMA20 on 5-minute data if provided
    let ema9_5mData = [];
    let ema20_5mData = [];
    if (midData5m && midData5m.length > 0) {
      const closePrices5m = midData5m.map(d => d.value);
      const ema9Values5m = ta.ema(closePrices5m, 9);
      const ema20Values5m = ta.ema(closePrices5m, 20);
      ema9_5mData = midData5m.map((d, i) => ({
        time: d.time,
        value: ema9Values5m[i]
      })).filter(d => d.value !== null && !isNaN(d.value));
      ema20_5mData = midData5m.map((d, i) => ({
        time: d.time,
        value: ema20Values5m[i]
      })).filter(d => d.value !== null && !isNaN(d.value));
    }

    return { ema9: ema9Data, ema20: ema20Data, ema9_1m: ema9_1mData, ema20_1m: ema20_1mData, ema9_5m: ema9_5mData, ema20_5m: ema20_5mData };
  };

  useEffect(() => {
    if (!sessionData.quote || !seriesRefs.current.bid) return;

    // Clear preview on first real tick
    if (isPreviewDisplayed.current) {
      console.log('🔄 Clearing preview, starting live playback');
      seriesRefs.current.bid.setData([]);
      seriesRefs.current.ask.setData([]);
      seriesRefs.current.mid.setData([]);
      seriesRefs.current.candlestick.setData([]);
      seriesRefs.current.ema9.setData([]);
      seriesRefs.current.ema20.setData([]);
      seriesRefs.current.ema9_1m.setData([]);
      seriesRefs.current.ema20_1m.setData([]);
      seriesRefs.current.ema9_5m.setData([]);
      seriesRefs.current.ema20_5m.setData([]);
      seriesRefs.current.positionAvg.setData([]);
      allTicksData.current = [];
      aggregatedLineData.current = { bid: [], ask: [], mid: [] };
      aggregatedCandleData.current = [];
      emaData.current = { ema9: [], ema20: [], ema9_1m: [], ema20_1m: [], ema9_5m: [], ema20_5m: [] };
      isPreviewDisplayed.current = false;
    }

    const { t, bid, ask } = sessionData.quote;
    const mid = (bid + ask) / 2;

    try {
      // Keep only last 50,000 ticks in memory to prevent memory overflow on large sessions
      const MAX_TICKS_IN_MEMORY = 50000;
      allTicksData.current.push({ time: t, bid, ask, mid });
      if (allTicksData.current.length > MAX_TICKS_IN_MEMORY) {
        allTicksData.current = allTicksData.current.slice(-MAX_TICKS_IN_MEMORY);
      }
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

      // Update price lines for bid/ask (horizontal lines at current price)
      if (priceLineRefs.current.bid) {
        priceLineRefs.current.bid.applyOptions({ price: bid });
      }
      if (priceLineRefs.current.ask) {
        priceLineRefs.current.ask.applyOptions({ price: ask });
      }

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

      // Update EMAs in real-time
      const midData1m = aggregateLineData(allTicksData.current, 60).mid;
      const midData5m = aggregateLineData(allTicksData.current, 300).mid;
      const updatedEMAs = calculateEMAs(aggregatedLineData.current.mid, midData1m, midData5m);
      emaData.current = updatedEMAs;

      // Update only the last EMA values to avoid full recalculation
      if (updatedEMAs.ema9.length > 0) {
        const lastEma9 = updatedEMAs.ema9[updatedEMAs.ema9.length - 1];
        seriesRefs.current.ema9.update(lastEma9);
      }
      if (updatedEMAs.ema20.length > 0) {
        const lastEma20 = updatedEMAs.ema20[updatedEMAs.ema20.length - 1];
        seriesRefs.current.ema20.update(lastEma20);
      }
      if (updatedEMAs.ema9_1m.length > 0) {
        const lastEma9_1m = updatedEMAs.ema9_1m[updatedEMAs.ema9_1m.length - 1];
        seriesRefs.current.ema9_1m.update(lastEma9_1m);
      }
      if (updatedEMAs.ema20_1m.length > 0) {
        const lastEma20_1m = updatedEMAs.ema20_1m[updatedEMAs.ema20_1m.length - 1];
        seriesRefs.current.ema20_1m.update(lastEma20_1m);
      }
      if (updatedEMAs.ema9_5m.length > 0) {
        const lastEma9_5m = updatedEMAs.ema9_5m[updatedEMAs.ema9_5m.length - 1];
        seriesRefs.current.ema9_5m.update(lastEma9_5m);
      }
      if (updatedEMAs.ema20_5m.length > 0) {
        const lastEma20_5m = updatedEMAs.ema20_5m[updatedEMAs.ema20_5m.length - 1];
        seriesRefs.current.ema20_5m.update(lastEma20_5m);
      }
    } catch (error) {
      console.error('Error updating chart:', error);
    }
  }, [sessionData.quote, timeframe]);

  // Update position average price line
  useEffect(() => {
    if (!seriesRefs.current.positionAvg || !aggregatedLineData.current.mid.length) return;

    if (positionSummary && positionSummary.totalPosition !== 0 && positionSummary.avgPrice > 0) {
      // Create a horizontal line at the average price across the entire chart
      const firstTime = aggregatedLineData.current.mid[0]?.time;
      const lastTime = aggregatedLineData.current.mid[aggregatedLineData.current.mid.length - 1]?.time;
      
      if (firstTime && lastTime) {
        const positionLine = [
          { time: firstTime, value: positionSummary.avgPrice },
          { time: lastTime, value: positionSummary.avgPrice }
        ];
        seriesRefs.current.positionAvg.setData(positionLine);
      }
    } else {
      // Clear the line when no position
      seriesRefs.current.positionAvg.setData([]);
    }
  }, [positionSummary, aggregatedLineData.current.mid.length, sessionData.quote]);

  // Render OakView mode
  if (useOakView) {
    return (
      <div className="relative w-full h-full bg-[#131722]">
        <oak-view
          ref={oakViewRef}
          layout="single"
          theme="dark"
          style={{ width: '100%', height: '100%' }}
        />
        {isLoading && <LoadingSpinner message="Loading Session Data" />}
      </div>
    );
  }

  // Render standard chart mode
  return (
    <div className="relative w-full h-full bg-[#131722]">
      <div ref={chartRef} className="w-full h-full" />
      {isLoading && <LoadingSpinner message="Loading Session Data" />}
    </div>
  );
});

ChartArea.displayName = 'ChartArea';

export default ChartArea;