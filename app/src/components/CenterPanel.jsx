import React, { useState, useEffect, forwardRef, useMemo, useCallback } from "react";
import ControlsBar from "./ControlsBar";
import ChartArea from "./ChartArea";
import SessionSearchModal from "./SessionSearchModal";
import { api } from "../utils/api";
// Import SessionDataProvider for replay engine integration
import { SessionDataProvider } from "../providers/SessionDataProvider";

const CenterPanel = forwardRef(({ 
  currentSession, 
  sessionData, 
  setSessionData, 
  isLoading, 
  onLoadingChange, 
  onSelectSession, 
  chartType, 
  setChartType, 
  timeframe, 
  setTimeframe, 
  positionSummary,
}, ref) => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  
  // Create provider instance for replay engine
  const provider = useMemo(() => {
    return new SessionDataProvider();
  }, []);
  
  // Initialize provider on mount
  useEffect(() => {
    const initProvider = async () => {
      try {
        await provider.initialize({});
        console.log('✅ SessionDataProvider initialized');
      } catch (error) {
        console.error('❌ Failed to initialize provider:', error);
      }
    };
    
    initProvider();
    
    // Clean up provider on unmount
    return () => {
      provider.disconnect();
    };
  }, [provider]);
  
  // Subscribe to replay engine tick events to update sessionData
  useEffect(() => {
    if (!provider) return;
    
    const engine = provider.getReplayEngine();
    
    // Handler for tick events - updates sessionData with current quote
    const handleTick = (tick, state) => {
      const metadata = tick.metadata || {};
      
      // Build quote object from tick data
      const quote = {
        t: tick.timestamp,
        bid: metadata.bid || tick.price,
        ask: metadata.ask || tick.price,
        bidSize: metadata.bidSize || 0,
        askSize: metadata.askSize || 0,
        exchanges: metadata.exchanges || [],
        nbbo: metadata.nbbo || false,
      };
      
      // Update sessionData with new quote
      setSessionData(prev => ({
        ...prev,
        quote,
        stats: {
          ...prev.stats,
          quoteCount: (prev.stats?.quoteCount || 0) + 1,
        }
      }));
    };
    
    // Subscribe to tick events
    const unsubscribe = engine.on('tick', handleTick);
    
    // Also listen for ended to log completion
    const handleEnded = () => {
      console.log('📊 Replay ended');
    };
    
    const unsubscribeEnded = engine.on('ended', handleEnded);
    
    return () => {
      unsubscribe();
      unsubscribeEnded();
    };
  }, [provider, setSessionData]);
  
  // Listen for state changes to detect stop and reset sessionData
  useEffect(() => {
    if (!provider) return;
    
    const engine = provider.getReplayEngine();
    
    const handleStateChange = (state) => {
      // When replay is stopped (idle), reset quote count to allow preview
      if (state.status === 'idle') {
        setSessionData(prev => ({
          ...prev,
          quote: null,
          stats: {
            ...prev.stats,
            quoteCount: 0,
          }
        }));
      }
    };
    
    const unsubscribe = engine.on('stateChange', handleStateChange);
    
    return () => {
      unsubscribe();
    };
  }, [provider, setSessionData]);
  
  // Handle chart ready callback
  const handleChartReady = useCallback((oakView) => {
    console.log('📊 OakView chart ready:', oakView);
  }, []);
  
  // Handle session change from OakView (sync with React state)
  const handleSessionChange = useCallback((session) => {
    console.log('📊 Session selected via OakView:', session.id);
    onSelectSession(session);
  }, [onSelectSession]);

  // Load preview data when session is selected
  useEffect(() => {
    const loadPreviewData = async () => {
      if (!currentSession) {
        setPreviewData(null);
        return;
      }

      // Clear preview if playback has started
      if (sessionData.stats?.quoteCount > 0) {
        setPreviewData(null);
        return;
      }

      try {
        console.log('📊 Loading preview data for:', currentSession.id);
        onLoadingChange?.(true);
        const data = await api.loadSessionData(currentSession.id);

        // Limit preview to max 10,000 ticks to prevent memory issues
        const MAX_PREVIEW_TICKS = 10000;
        let previewSample = data;

        if (data.length > MAX_PREVIEW_TICKS) {
          console.log(`⚠️ Large dataset (${data.length.toLocaleString()} ticks), sampling every ${Math.ceil(data.length / MAX_PREVIEW_TICKS)}th tick for preview`);
          const step = Math.ceil(data.length / MAX_PREVIEW_TICKS);
          previewSample = [];
          for (let i = 0; i < data.length; i += step) {
            previewSample.push(data[i]);
          }
          console.log(`✅ Preview sample: ${previewSample.length.toLocaleString()} ticks`);
        }

        setPreviewData(previewSample);
        console.log('✅ Preview data loaded:', previewSample.length, 'ticks (full session:', data.length.toLocaleString(), 'ticks)');
      } catch (err) {
        console.error('❌ Failed to load preview data:', err);
      } finally {
        onLoadingChange?.(false);
      }
    };

    loadPreviewData();
  }, [currentSession, sessionData.stats?.quoteCount, onLoadingChange]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#131722]">
      {/* Chart Area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChartArea
          ref={ref}
          sessionData={sessionData}
          isLoading={isLoading}
          chartType={chartType}
          timeframe={timeframe}
          previewData={previewData}
          positionSummary={positionSummary}
          provider={provider}
          onChartReady={handleChartReady}
          onSessionChange={handleSessionChange}
        />
      </div>

      {/* Controls Bar */}
      <div className="flex-shrink-0">
        <ControlsBar
          currentSession={currentSession}
          provider={provider}
          onLoadingChange={onLoadingChange}
        />
      </div>

      {/* Session Search Modal */}
      <SessionSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectSession={onSelectSession}
        currentSession={currentSession}
      />
    </div>
  );
});

CenterPanel.displayName = 'CenterPanel';

export default CenterPanel;