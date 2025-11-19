/**
 * ChartContainer - OakView Integration
 * 
 * Wraps OakView chart component for session replay functionality.
 * Replaces the old ChartArea.jsx with OakView-based implementation.
 */

import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import ReplaySessionDataProvider from '../providers/ReplaySessionDataProvider';
// Import OakViewChartUI to get the version with toolbar
import { OakViewChartUI } from 'oakview';

const ChartContainer = forwardRef(({ currentSession, sessionData, isLoading, chartType, timeframe, providerRef }, ref) => {
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
    const existingChart = chartContainerRef.current.querySelector('oakview-chart');
    if (existingChart) {
      console.log('✓ OakView chart already exists, reusing it');
      chartRef.current = existingChart;
      setChartReady(true);
      return;
    }

    initializingRef.current = true;
    console.log('📊 Initializing OakView chart (with toolbar)...');

    // Wait for oakview-chart Web Component to be defined
    customElements.whenDefined('oakview-chart').then(() => {
      console.log('✓ oakview-chart Web Component is defined');
      
      // Double-check it wasn't created in the meantime
      if (chartContainerRef.current?.querySelector('oakview-chart')) {
        console.log('⚠️ Chart was created while waiting, using existing one');
        chartRef.current = chartContainerRef.current.querySelector('oakview-chart');
        setChartReady(true);
        return;
      }
      
      // Create the chart element (this will be the UI version with toolbar)
      const chartElement = document.createElement('oakview-chart');
      chartElement.setAttribute('theme', 'dark');
      chartElement.setAttribute('show-toolbar', 'true');
      chartElement.setAttribute('hide-sidebar', 'true'); // Hide sidebar, keep toolbar
      
      if (chartContainerRef.current) {
        chartContainerRef.current.appendChild(chartElement);
        chartRef.current = chartElement;

        // Use requestAnimationFrame to ensure element is fully connected
        requestAnimationFrame(() => {
          console.log('✓ OakView chart element connected (with toolbar)');
          setChartReady(true);
        });
      }
    }).catch(error => {
      console.error('❌ Failed to initialize OakView chart:', error);
      initializingRef.current = false;
    });

    // Don't clean up on unmount - let the element persist
    return () => {
      // Just clear refs, don't remove DOM
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

        // Load preview data (historical)
        const previewBars = await provider.fetchHistorical(metadata.symbol, '1');
        
        // Display preview using oakview-chart-ui's simple API
        console.log('📊 OakView: Setting data:', previewBars.length, 'bars');
        chartRef.current.setData(previewBars);
        
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
