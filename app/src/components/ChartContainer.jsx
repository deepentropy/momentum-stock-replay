/**
 * ChartContainer - OakView Integration
 * 
 * Wraps OakView chart component for session replay functionality.
 * Replaces the old ChartArea.jsx with OakView-based implementation.
 */

import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import ReplaySessionDataProvider from '../providers/ReplaySessionDataProvider';
// OakView is loaded as a Web Component - no React import needed
// The oak-view element is registered globally when the library loads
import 'oakview';

const ChartContainer = forwardRef(({ currentSession, sessionData, isLoading, chartType, timeframe, providerRef, onSessionSelect }, ref) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const internalProviderRef = useRef(null);
  const [chartReady, setChartReady] = useState(false);
  const initializingRef = useRef(false); // Prevent double initialization

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
    if (!chartContainerRef.current || initializingRef.current) return;

    // Check if chart element already exists
    const existingChart = chartContainerRef.current.querySelector('oak-view');
    if (existingChart) {
      console.log('✓ OakView chart already exists, reusing it');
      chartRef.current = existingChart;
      setChartReady(true);
      return;
    }

    initializingRef.current = true;
    console.log('📊 Initializing OakView chart layout...');

    // Wait for oak-view Web Component to be defined
    customElements.whenDefined('oak-view').then(() => {
      console.log('✓ oak-view Web Component is defined');
      
      // Double-check it wasn't created in the meantime
      if (chartContainerRef.current?.querySelector('oak-view')) {
        console.log('⚠️ Chart was created while waiting, using existing one');
        chartRef.current = chartContainerRef.current.querySelector('oak-view');
        setChartReady(true);
        return;
      }
      
      // Create the oak-view layout element (single pane layout)
      const chartElement = document.createElement('oak-view');
      chartElement.setAttribute('layout', 'single'); // Single pane layout
      chartElement.setAttribute('theme', 'dark');
      
      if (chartContainerRef.current) {
        chartContainerRef.current.appendChild(chartElement);
        chartRef.current = chartElement;

        // Use requestAnimationFrame to ensure element is fully connected
        requestAnimationFrame(() => {
          console.log('✓ OakView layout element connected');
          
          // Create and set the data provider AFTER the element is connected
          const provider = new ReplaySessionDataProvider();
          internalProviderRef.current = provider;
          
          // Use the setDataProvider method
          if (chartElement.setDataProvider) {
            chartElement.setDataProvider(provider);
            console.log('📡 OakView: Data provider set via setDataProvider()');
          } else {
            console.error('❌ OakView: setDataProvider method not found');
          }
          
          // Listen for symbol-change events from OakView
          chartElement.addEventListener('symbol-change', (e) => {
            console.log('🔔 OakView symbol-change event:', e.detail);
            const sessionId = e.detail.symbol; // This is the session ID (e.g., "OLMA-20251118")
            
            // Call the parent callback to load the session
            if (onSessionSelect) {
              // Parse session ID to get symbol and date
              const [symbol, date] = sessionId.split('-');
              onSessionSelect({
                id: sessionId,
                symbol: symbol,
                date: date
              });
            }
          });
          
          setChartReady(true);
        });
      }
    }).catch(error => {
      console.error('❌ Failed to initialize OakView:', error);
      initializingRef.current = false;
    });

    // Don't clean up on unmount - let the element persist
    return () => {
      // Just clear refs, don't remove DOM
      chartRef.current = null;
      setChartReady(false);
    };
  }, [onSessionSelect]);

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
        // Use existing provider (already set on the element)
        const provider = internalProviderRef.current;
        
        if (!provider) {
          console.error('❌ OakView: No data provider found!');
          return;
        }

        // Initialize with session
        const metadata = await provider.initialize({ 
          sessionId: currentSession.id 
        });

        console.log('✓ OakView: Session metadata:', metadata);

        // ✅ OAKVIEW RECOMMENDED PATTERN:
        // 1. Fetch historical bars first
        const historicalBars = await provider.fetchHistorical(currentSession.id, '1');
        
        console.log('📊 OakView: Loaded historical bars:', historicalBars.length);
        
        // Get the first pane chart
        const paneChart = chartRef.current.getChartAt(0);
        
        if (paneChart) {
          // 2. Load ONLY first bar as preview to initialize the series
          // This creates the series so updateRealtime() works
          const firstBar = historicalBars.slice(0, 1);
          paneChart.setData(firstBar);
          console.log('✓ OakView: Initialized with first bar - ready for playback');
          
          // Tell provider to start from beginning (no skipping)
          // The first bar will be updated/replaced as playback begins
        }

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

  // Subscribe to provider updates and update chart in real-time
  useEffect(() => {
    if (!chartReady || !chartRef.current || !internalProviderRef.current) return;

    const provider = internalProviderRef.current;
    const paneChart = chartRef.current.getChartAt(0);
    
    if (!paneChart) {
      console.error('❌ Cannot get pane chart for real-time updates');
      return;
    }

    console.log('🔗 Setting up real-time chart updates via OakView updateRealtime()');

    // ✅ OAKVIEW RECOMMENDED PATTERN:
    // 3. Subscribe to real-time updates and use updateRealtime()
    const unsubscribe = provider.subscribe('replay', '1', (bar) => {
      // Debug: Log the actual bar we receive
      console.log('📊 Received bar from provider:', JSON.stringify(bar));
      
      // Debug: Verify bar format before sending to OakView
      if (typeof bar.time !== 'number') {
        console.error('❌ Bar has invalid time type:', {
          bar,
          timeType: typeof bar.time,
          timeValue: bar.time,
          isObject: bar.time === Object(bar.time)
        });
        return; // Skip this bar
      }
      
      // Use OakView's updateRealtime() method
      try {
        paneChart.updateRealtime(bar);
      } catch (error) {
        console.error('❌ Failed to update realtime bar:', {
          error: error.message,
          bar,
          barJSON: JSON.stringify(bar),
          stack: error.stack
        });
      }
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [chartReady, chartRef.current, internalProviderRef.current]);

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
