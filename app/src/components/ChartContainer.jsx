/**
 * ChartContainer - OakView Integration
 * 
 * Wraps OakView chart component for session replay functionality.
 * Replaces the old ChartArea.jsx with OakView-based implementation.
 */

import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import ReplaySessionDataProvider from '../providers/ReplaySessionDataProvider';
import { OakViewChart } from 'oakview';

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

    // Check if chart element already exists (React StrictMode double-mount)
    if (chartContainerRef.current.querySelector('oakview-chart')) {
      console.log('✓ OakView chart already exists (StrictMode)');
      const existingChart = chartContainerRef.current.querySelector('oakview-chart');
      chartRef.current = existingChart;
      setChartReady(true);
      return;
    }

    console.log('📊 Initializing OakView chart...');

    // OakViewChart is imported, so Web Component should be registered
    // Wait for it to be defined
    customElements.whenDefined('oakview-chart').then(() => {
      console.log('✓ oakview-chart Web Component is defined');
      
      // Create the chart element
      const chartElement = document.createElement('oakview-chart');
      chartElement.setAttribute('theme', 'dark');
      chartElement.setAttribute('width', '100%');
      chartElement.setAttribute('height', '100%');
      
      chartContainerRef.current.appendChild(chartElement);
      chartRef.current = chartElement;

      // oakview-chart doesn't have chart-ready event
      // Chart is ready after connectedCallback
      // Use requestAnimationFrame to ensure element is fully connected
      requestAnimationFrame(() => {
        console.log('✓ OakView chart element connected');
        setChartReady(true);
      });
    }).catch(error => {
      console.error('❌ Failed to initialize OakView chart:', error);
    });

    return () => {
      // Cleanup - but don't remove if React is just re-mounting
      // Only clear the ref
      chartRef.current = null;
      setChartReady(false);
    };
  }, []);

  // Load session when currentSession changes
  useEffect(() => {
    console.log('🔍 Session effect triggered:', { 
      chartReady, 
      currentSession: currentSession?.id, 
      hasChartRef: !!chartRef.current 
    });
    
    if (!chartReady || !currentSession || !chartRef.current) {
      console.log('⏳ Waiting for chart ready...', { chartReady, currentSession: !!currentSession, chartRef: !!chartRef.current });
      return;
    }

    const loadSession = async () => {
      console.log('📥 OakView: Loading session:', currentSession.id);

      try {
        // Verify chart element exists
        if (!chartRef.current.getChart) {
          console.error('❌ Chart element does not have getChart method');
          return;
        }

        // Create provider if doesn't exist
        if (!internalProviderRef.current) {
          internalProviderRef.current = new ReplaySessionDataProvider();
        }

        const provider = internalProviderRef.current;

        // Initialize with session
        const metadata = await provider.initialize({ 
          sessionId: currentSession.id 
        });

        console.log('✓ OakView: Session metadata:', metadata);

        // Get the underlying lightweight-charts instance
        const lwChart = chartRef.current.getChart();
        console.log('✓ OakView: Got chart instance:', lwChart);

        // Clear existing series
        chartRef.current.clearSeries();

        // Create candlestick series
        const candleSeries = chartRef.current.addCandlestickSeries();
        console.log('✓ OakView: Added candlestick series');
        
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
        console.log('✓ OakView: Added line series (bid/ask/mid)');

        // Load preview data (historical)
        const previewBars = await provider.fetchHistorical(metadata.symbol, '1');
        
        // Display preview
        console.log('📊 OakView: Displaying preview:', previewBars.length, 'bars');
        candleSeries.setData(previewBars);
        
        // Fit content
        lwChart.timeScale().fitContent();
        console.log('✓ OakView: Chart ready with preview data');

      } catch (error) {
        console.error('❌ OakView: Failed to load session:', error);
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
