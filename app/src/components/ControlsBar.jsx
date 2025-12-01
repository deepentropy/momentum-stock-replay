import React, { useState, useCallback, useEffect } from "react";
import { useReplay } from "../hooks/useReplay";

export default function ControlsBar({ 
  currentSession, 
  onLoadingChange,
  provider = null,
}) {
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showPlayTooltip, setShowPlayTooltip] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Use the replay hook for all playback control
  const {
    state,
    progress,
    isIdle,
    isPlaying,
    isPaused,
    hasEnded,
    speed,
    availableSpeeds,
    currentTimeFormatted,
    endTimeFormatted,
    play,
    pause,
    stop,
    seekToPercent,
    setSpeed,
    togglePlayPause,
  } = useReplay(provider);

  // Speed options for the dropdown
  const speedOptions = availableSpeeds.map(s => ({
    value: s,
    label: `${s}x`
  }));

  // Handle play button click
  const handlePlay = useCallback(async () => {
    if (!currentSession || !provider) return;
    
    // If already playing, just toggle play/pause
    if (isPlaying || isPaused || hasEnded) {
      togglePlayPause();
      return;
    }

    // Otherwise, load the session and start playback
    setIsLoading(true);
    setError(null);
    onLoadingChange?.(true);

    try {
      console.log('▶️ Loading and starting playback for:', currentSession.id);
      await provider.loadSession(currentSession.id);
      play();
    } catch (err) {
      console.error('❌ Failed to load session:', err);
      setError(`Failed to load session: ${err.message}`);
    } finally {
      setIsLoading(false);
      onLoadingChange?.(false);
    }
  }, [currentSession, provider, isPlaying, isPaused, hasEnded, togglePlayPause, play, onLoadingChange]);

  // Handle stop button click
  const handleStop = useCallback(() => {
    if (!provider) return;
    console.log('⏹️ Stopping playback');
    stop();
    setError(null);
  }, [provider, stop]);

  // Handle speed change
  const handleSpeedChange = useCallback((newSpeed) => {
    const speedValue = parseFloat(newSpeed);
    setSpeed(speedValue);
    console.log('⚡ Changing speed to:', speedValue);
    setShowSpeedMenu(false);
  }, [setSpeed]);

  // Handle seek via progress bar
  const handleSeek = useCallback((e) => {
    const percent = parseFloat(e.target.value);
    seekToPercent(percent);
  }, [seekToPercent]);

  // Show tooltip when session is selected but not playing
  useEffect(() => {
    if (currentSession && isIdle && !isLoading) {
      setShowPlayTooltip(true);
      // Hide tooltip after 5 seconds
      const timer = setTimeout(() => {
        setShowPlayTooltip(false);
      }, 5000);
      return () => clearTimeout(timer);
    } else {
      setShowPlayTooltip(false);
    }
  }, [currentSession, isIdle, isLoading]);

  // Determine if controls should be disabled
  const hasData = state && state.startTime > 0 && state.endTime > 0 && state.startTime !== state.endTime;
  const progressValue = hasData ? progress : 0;
  const canPlay = Boolean(currentSession && provider);
  const canStop = isPlaying || isPaused || hasEnded;

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
            onClick={isPlaying ? pause : handlePlay}
            disabled={isLoading || !canPlay}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#2A2E39] transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[#B2B5BE] hover:text-white"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
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
          disabled={!canStop}
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
                    onClick={() => handleSpeedChange(option.value)}
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

        <div className="w-px h-5 bg-[#2A2E39]"></div>

        {/* Progress Bar Section */}
        <div className="flex-1 flex items-center gap-3">
          {/* Current Time */}
          <span className="text-[12px] font-mono text-[#B2B5BE] min-w-[65px]">
            {hasData ? currentTimeFormatted : '--:--:--'}
          </span>
          
          {/* Progress Slider */}
          <div className="flex-1 relative h-6 flex items-center group">
            {/* Track background */}
            <div className="absolute inset-x-0 h-1 bg-[#2A2E39] rounded-full" />
            
            {/* Progress fill */}
            <div 
              className="absolute left-0 h-1 bg-[#2962FF] rounded-full transition-all"
              style={{ width: `${progressValue}%` }}
            />
            
            {/* Slider input (invisible but functional) */}
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={progressValue}
              onChange={handleSeek}
              disabled={!hasData}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default"
            />
            
            {/* Thumb indicator */}
            <div 
              className="absolute w-3 h-3 bg-[#2962FF] rounded-full shadow-lg transform -translate-x-1/2 pointer-events-none group-hover:scale-125 transition-transform"
              style={{ left: `${progressValue}%` }}
            />
          </div>
          
          {/* End Time */}
          <span className="text-[12px] font-mono text-[#787B86] min-w-[65px] text-right">
            {hasData ? endTimeFormatted : '--:--:--'}
          </span>
        </div>
      </div>
    </div>
  );
}