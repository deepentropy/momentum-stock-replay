import React, { useState, useCallback, useEffect } from "react";
import { useTickPlayer } from "../hooks/useTickPlayer";
import { useReplay } from "../hooks/useReplay";
import { api } from "../utils/api";

export default function ControlsBar({ 
  currentSession, 
  sessionData, 
  setSessionData, 
  onLoadingChange,
  // New props for provider-based replay
  provider = null,
}) {
  const [status, setStatus] = useState('disconnected');
  const [error, setError] = useState(null);
  const [tickData, setTickData] = useState(null);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [currentTime, setCurrentTime] = useState(null);
  const [showPlayTooltip, setShowPlayTooltip] = useState(false);

  // Use the replay hook when provider is available
  const replay = useReplay(provider);
  const useProviderMode = Boolean(provider);

  const handleTick = useCallback((tick, virtualTime) => {
    setError(null);

    // Use virtual time for clock display (increments by 0.1s per tick)
    // This ensures the timer shows continuous wall-clock progression
    setCurrentTime(virtualTime);

    // Use actual data timestamp for chart
    const unixTime = tick.adjustedTimestamp;

    setSessionData(prev => ({
      ...prev,  // Preserve level2Data
      quote: {
        t: unixTime,
        bid: parseFloat(tick.bid_price),
        ask: parseFloat(tick.ask_price),
        bidSize: parseFloat(tick.bid_size),
        askSize: parseFloat(tick.ask_size),
        timestamp: tick.timestamp,
        nbbo: true,
        exchanges: tick.exchanges || []  // Include exchange data for OrderBookPanel
      },
      stats: {
        ...prev.stats,
        quoteCount: prev.stats.quoteCount + 1
      }
    }));
  }, [setSessionData]);

  const handleInit = useCallback((meta) => {
    console.log('📊 Session initialized:', meta);
    setSessionData(prev => ({
      ...prev,
      stats: { ...prev.stats, sessionMeta: meta }
    }));
    setStatus('connected');
    onLoadingChange?.(false);
  }, [setSessionData, onLoadingChange]);

  const handleEnd = useCallback(() => {
    console.log('✅ Session playback ended');
    setStatus('completed');
  }, []);

  const {
    loadAndPlay,
    stop,
    pause,
    resume,
    changeSpeed,
    isPlaying,
    isPaused,
    speed,
    progress
  } = useTickPlayer(handleTick, handleInit, handleEnd);

  const handlePlay = useCallback(async () => {
    if (!currentSession) return;
    // If paused, resume instead of restarting
    if (isPlaying && isPaused) {
      return handlePause(); // This will resume
    }
    if (isPlaying && !isPaused) return;

    console.log('▶️ Starting playback for:', currentSession.id);
    setStatus('loading');
    onLoadingChange?.(true);
    setError(null);

    setSessionData({
      quote: null,
      stats: { quoteCount: 0, sessionMeta: null }
    });

    try {
      let tickArray = null;

      if (!tickData || tickData.sessionId !== currentSession.id) {
        console.log('📥 Loading tick data from GitHub...');
        const loadedData = await api.loadSessionData(currentSession.id);

        // The loadedData is the tick array
        tickArray = loadedData;

        // Store the tick data
        setTickData({
          sessionId: currentSession.id,
          data: tickArray
        });
      } else {
        // Use cached data
        tickArray = tickData.data;
      }

      await loadAndPlay(currentSession.id, tickArray);
    } catch (err) {
      console.error('❌ Failed to load session:', err);
      setError(`Failed to load session: ${err.message}`);
      setStatus('error');
      onLoadingChange?.(false);
    }
  }, [currentSession, tickData, isPlaying, isPaused, loadAndPlay, onLoadingChange, setSessionData]);

  const handlePause = () => {
    if (!isPlaying) return;

    if (isPaused) {
      console.log('▶️ Resuming playback');
      resume();
      setStatus('connected');
    } else {
      console.log('⏸️ Pausing playback');
      pause();
      setStatus('paused');
    }
  };

  const handleStop = () => {
    if (!isPlaying) return;

    console.log('⏹️ Stopping playback');
    stop();
    setStatus('disconnected');
    setError(null);
    onLoadingChange?.(false);
    setSessionData(prev => ({
      ...prev,  // Preserve level2Data
      quote: null,
      stats: { quoteCount: 0, sessionMeta: null }
    }));
  };

  const handleSpeedChange = (newSpeed) => {
    const speedValue = parseFloat(newSpeed);
    changeSpeed(speedValue);
    if (isPlaying) {
      console.log('⚡ Changing speed to:', speedValue);
    }
  };

  const speedOptions = [
    { value: 0.1, label: '0.1x' },
    { value: 0.25, label: '0.25x' },
    { value: 0.5, label: '0.5x' },
    { value: 1, label: '1x' },
    { value: 2, label: '2x' },
    { value: 5, label: '5x' },
    { value: 10, label: '10x' },
    { value: 50, label: '50x' },
    { value: 100, label: '100x' },
  ];

  // Show tooltip when session is selected but not playing
  useEffect(() => {
    if (currentSession && !isPlaying && status === 'disconnected') {
      setShowPlayTooltip(true);
      // Hide tooltip after 5 seconds
      const timer = setTimeout(() => {
        setShowPlayTooltip(false);
      }, 5000);
      return () => clearTimeout(timer);
    } else {
      setShowPlayTooltip(false);
    }
  }, [currentSession, isPlaying, status]);

  return (
    <div className="bg-[#1E222D] border-t border-[#2A2E39] px-4 py-2.5">
      {error && (
        <div className="mb-2 px-3 py-2 bg-[#F23645]/10 border border-[#F23645]/30 rounded text-[#F23645] text-[12px]">
          ⚠️ {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        {/* Play/Pause Button with Tooltip */}
        <div className="relative">
          <button
            onClick={isPlaying && !isPaused ? handlePause : handlePlay}
            disabled={status === 'loading'}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#2A2E39] transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[#B2B5BE] hover:text-white"
            title={isPlaying && !isPaused ? 'Pause' : 'Play'}
          >
            {isPlaying && !isPaused ? (
              // Pause Icon
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="4" y="3" width="3" height="10" rx="1"/>
                <rect x="9" y="3" width="3" height="10" rx="1"/>
              </svg>
            ) : (
              // Play Icon
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M5 3.5C5 3.22386 5.22386 3 5.5 3C5.63261 3 5.75979 3.05268 5.85355 3.14645L12.3536 9.64645C12.5488 9.84171 12.5488 10.1583 12.3536 10.3536L5.85355 16.8536C5.65829 17.0488 5.34171 17.0488 5.14645 16.8536C5.05268 16.7598 5 16.6326 5 16.5V3.5Z" transform="translate(-1, -3)"/>
              </svg>
            )}
          </button>

          {/* Tooltip - TradingView Style */}
          {showPlayTooltip && (
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="bg-[#2962FF] text-white px-3 py-2 rounded shadow-lg whitespace-nowrap text-[12px] font-medium">
                Click to start playback
                {/* Arrow pointing down */}
                <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-[1px]">
                  <div className="border-4 border-transparent border-t-[#2962FF]"></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Stop Button */}
        <button
          onClick={handleStop}
          disabled={!isPlaying}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#2A2E39] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-[#B2B5BE] hover:text-white"
          title="Stop"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <rect x="2" y="2" width="10" height="10" rx="1"/>
          </svg>
        </button>

        <div className="w-px h-5 bg-[#2A2E39]"></div>

        {/* Speed Selector Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowSpeedMenu(!showSpeedMenu)}
            className="h-7 px-3 text-[12px] font-medium rounded transition-colors bg-[#2A2E39] text-white hover:bg-[#363A45] flex items-center gap-1"
          >
            <span>{speed}x</span>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {showSpeedMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSpeedMenu(false)}></div>
              <div className="absolute bottom-[calc(100%+4px)] left-0 z-50 bg-[#1E222D] border border-[#2A2E39] rounded shadow-xl min-w-[100px]">
                {speedOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => { handleSpeedChange(option.value); setShowSpeedMenu(false); }}
                    className={`w-full px-3 py-2 text-left text-[12px] hover:bg-[#2A2E39] ${
                      speed === option.value ? 'bg-[#2A2E39] text-white' : 'text-[#B2B5BE]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Clock Display - TradingView Style */}
        {currentTime && (
          <>
            <div className="w-px h-5 bg-[#2A2E39]"></div>
            <div className="flex items-center gap-1.5 ml-auto bg-[#131722] px-2.5 py-1 rounded">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-[#787B86]">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M8 5V8L10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <span className="text-[12px] text-[#B2B5BE] font-mono">
                {new Date(currentTime * 1000).toLocaleString('en-US', {
                  timeZone: 'America/New_York',
                  month: '2-digit',
                  day: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false
                }).replace(',', '')}
              </span>
              <span className="text-[10px] text-[#787B86] uppercase">EST</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}