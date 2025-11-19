/**
 * ChartContainer - OakView Integration
 * 
 * Wraps OakView chart component for session replay functionality.
 * Replaces the old ChartArea.jsx with OakView-based implementation.
 */

import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import ReplaySessionDataProvider from '../providers/ReplaySessionDataProvider';

const ChartContainer = forwardRef(({ currentSession, sessionData, isLoading, chartType, timeframe, providerRef }, ref) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const internalProviderRef = useRef(null);
  const [chartReady, setChartReady] = useState(false);

  // Expose the provider via the parent's providerRef
  useEffect(() => {
    if (providerRef && internalProviderRef.current) {
      providerRef.current = internalProviderRef.current;
    }
  }, [providerRef, internalProviderRef.current]);

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    addMarker: (marker) => {
      if (chartRef.current && chartRef.current.addMarker) {
        chartRef.current.addMarker(marker);
      }
    },
    clearMarkers: () => {
      if (chartRef.current && chartRef.current.clearMarkers) {
        chartRef.current.clearMarkers();
      }
    },
    getProvider: () => internalProviderRef.current
  }));

  // Initialize chart when container is ready
  useEffect(() => {
    if (!chartContainerRef.current) return;

    console.log('📊 Initializing OakView chart...');

    // Import and register OakView Web Component
    import('oakview').then((oakview) => {
      // OakView automatically registers the web component
      console.log('✓ OakView loaded');
      
      // Create the chart element
      const chartElement = document.createElement('oakview-chart');
      chartElement.setAttribute('theme', 'dark');
      chartElement.setAttribute('width', '100%');
      chartElement.setAttribute('height', '100%');
      
      chartContainerRef.current.appendChild(chartElement);
      chartRef.current = chartElement;

      // Wait for chart to be ready
      chartElement.addEventListener('chart-ready', (event) => {
        console.log('✓ Chart ready', event.detail);
        setChartReady(true);
      });
    }).catch(error => {
      console.error('❌ Failed to load OakView:', error);
    });

    return () => {
      // Cleanup
      if (chartContainerRef.current) {
        chartContainerRef.current.innerHTML = '';
      }
      chartRef.current = null;
    };
  }, []);

  // Load session when currentSession changes
  useEffect(() => {
    if (!chartReady || !currentSession || !chartRef.current) return;

    const loadSession = async () => {
      console.log('📥 Loading session:', currentSession.id);

      try {
        // Create provider if doesn't exist
        if (!internalProviderRef.current) {
          internalProviderRef.current = new ReplaySessionDataProvider();
        }

        const provider = internalProviderRef.current;

        // Initialize with session
        const metadata = await provider.initialize({ 
          sessionId: currentSession.id 
        });

        console.log('✓ Session metadata:', metadata);

        // Get the underlying lightweight-charts instance
        const lwChart = chartRef.current.getChart();

        // Create candlestick series
        const candleSeries = chartRef.current.addCandlestickSeries();
        
        // Create line series for bid/ask/mid
        const bidSeries = chartRef.current.addLineSeries([], {
          color: '#26a69a',
          lineWidth: 1,
          title: 'Bid'
        });

        const askSeries = chartRef.current.addLineSeries([], {
          color: '#ef5350',
          lineWidth: 1,
          title: 'Ask'
        });

        const midSeries = chartRef.current.addLineSeries([], {
          color: '#2962ff',
          lineWidth: 2,
          title: 'Mid'
        });

        // Load preview data (historical)
        const previewBars = await provider.fetchHistorical(metadata.symbol, '1');
        
        // Display preview
        console.log('📊 Displaying preview:', previewBars.length, 'bars');
        candleSeries.setData(previewBars);
        
        // Fit content
        lwChart.timeScale().fitContent();

      } catch (error) {
        console.error('❌ Failed to load session:', error);
      }
    };

    loadSession();

    return () => {
      // Cleanup provider on session change
      if (internalProviderRef.current) {
        internalProviderRef.current.disconnect();
        internalProviderRef.current = null;
      }
    };
  }, [currentSession, chartReady]);

  return (
    <div 
      ref={chartContainerRef} 
      className="relative w-full h-full bg-[#131722]"
      style={{ minHeight: '400px' }}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#131722] bg-opacity-75">
          <div className="text-[#B2B5BE]">Loading...</div>
        </div>
      )}
    </div>
  );
});

ChartContainer.displayName = 'ChartContainer';

export default ChartContainer;
