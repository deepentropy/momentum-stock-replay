import React, { useState, useEffect } from "react";
import ControlsBar from "./ControlsBar";
import ChartArea from "./ChartArea";
import SessionSearchModal from "./SessionSearchModal";
import { api } from "../utils/api";

export default function CenterPanel({ currentSession, sessionData, setSessionData, isLoading, onLoadingChange, onSelectSession, chartType, setChartType, timeframe, setTimeframe, onOpenSettings }) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showChartTypeMenu, setShowChartTypeMenu] = useState(false);
  const [showTimeframeMenu, setShowTimeframeMenu] = useState(false);
  const [previewData, setPreviewData] = useState(null);

  const chartTypeIcons = {
    line: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">
        <path d="M7 20L13 14L17 18L25 10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    candlestick: (
      <svg width="28" height="28" viewBox="0 0 28 28" fill="currentColor">
        <path d="M8 10V6M8 10H10V18H8V10ZM8 18V22M16 8V4M16 8H18V20H16V8ZM16 20V24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
      </svg>
    ),
  };

  const chartTypeLabels = {
    line: 'Line',
    candlestick: 'Candles',
  };

  const timeframeLabels = {
    1: '1s',
    10: '10s',
    60: '1m',
    300: '5m'
  };

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
      {/* Top Bar - TradingView Style */}
      <div className="flex-shrink-0 h-[44px] bg-[#1E222D] border-b border-[#2A2E39] flex items-center px-2 gap-1">
        {/* Settings Button */}
        <button
          onClick={onOpenSettings}
          className="h-[32px] w-[32px] rounded hover:bg-[#2A2E39] transition-colors flex items-center justify-center text-[#B2B5BE] hover:text-white"
          title="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </button>

        <div className="w-px h-[20px] bg-[#2A2E39] mx-1"></div>

        {/* Session Search */}
        <button
          onClick={() => setIsSearchOpen(true)}
          data-search-trigger
          className="h-[32px] px-3 rounded hover:bg-[#2A2E39] transition-colors flex items-center gap-2 text-[13px] font-medium text-[#B2B5BE]"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M7 12C9.76142 12 12 9.76142 12 7C12 4.23858 9.76142 2 7 2C4.23858 2 2 4.23858 2 7C2 9.76142 4.23858 12 7 12Z" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span className="text-white font-semibold">
            {currentSession ? currentSession.symbol : 'SYMBOL'}
          </span>
          {currentSession && (
            <span className="text-[#787B86] text-[11px]">{currentSession.date}</span>
          )}
        </button>

        <div className="w-px h-[20px] bg-[#2A2E39] mx-1"></div>

        {/* Chart Type Selector */}
        <div className="relative">
          <button
            onClick={() => setShowChartTypeMenu(!showChartTypeMenu)}
            className="h-[32px] w-[32px] rounded hover:bg-[#2A2E39] transition-colors flex items-center justify-center text-[#B2B5BE] hover:text-white"
            title={chartTypeLabels[chartType]}
          >
            {chartTypeIcons[chartType]}
          </button>

          {showChartTypeMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowChartTypeMenu(false)}></div>
              <div className="absolute top-[36px] left-0 z-50 bg-[#1E222D] border border-[#2A2E39] rounded shadow-xl min-w-[180px]">
                <button
                  onClick={() => { setChartType('line'); setShowChartTypeMenu(false); }}
                  className={`w-full px-3 py-2 text-left text-[13px] flex items-center gap-3 hover:bg-[#2A2E39] ${chartType === 'line' ? 'bg-[#2A2E39] text-white' : 'text-[#B2B5BE]'}`}
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M3 15L8 10L12 14L18 8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>Line</span>
                </button>
                <button
                  onClick={() => { setChartType('candlestick'); setShowChartTypeMenu(false); }}
                  className={`w-full px-3 py-2 text-left text-[13px] flex items-center gap-3 hover:bg-[#2A2E39] ${chartType === 'candlestick' ? 'bg-[#2A2E39] text-white' : 'text-[#B2B5BE]'}`}
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M6 8V4M6 8H8V14H6V8ZM6 14V18M13 6V2M13 6H15V16H13V6ZM13 16V20" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                  </svg>
                  <span>Candles</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Timeframe Buttons */}
        <div className="flex items-center gap-[2px]">
          {[1, 10, 60, 300].map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`h-[28px] px-2 text-[12px] font-medium rounded transition-colors ${
                timeframe === tf
                  ? 'bg-[#2962FF] text-white'
                  : 'text-[#B2B5BE] hover:bg-[#2A2E39] hover:text-white'
              }`}
            >
              {timeframeLabels[tf]}
            </button>
          ))}

          {/* More timeframes dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowTimeframeMenu(!showTimeframeMenu)}
              className="h-[28px] w-[28px] rounded hover:bg-[#2A2E39] transition-colors flex items-center justify-center text-[#B2B5BE] hover:text-white"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {showTimeframeMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowTimeframeMenu(false)}></div>
                <div className="absolute top-[32px] right-0 z-50 bg-[#1E222D] border border-[#2A2E39] rounded shadow-xl min-w-[140px]">
                  <div className="px-3 py-2 text-[11px] text-[#787B86] uppercase font-semibold border-b border-[#2A2E39]">
                    Seconds
                  </div>
                  {[1, 5, 10, 15, 30].map((sec) => (
                    <button
                      key={sec}
                      onClick={() => { setTimeframe(sec); setShowTimeframeMenu(false); }}
                      className={`w-full px-3 py-2 text-left text-[13px] hover:bg-[#2A2E39] ${
                        timeframe === sec ? 'text-white bg-[#2A2E39]' : 'text-[#B2B5BE]'
                      }`}
                    >
                      {sec} second{sec > 1 ? 's' : ''}
                    </button>
                  ))}
                  <div className="px-3 py-2 text-[11px] text-[#787B86] uppercase font-semibold border-t border-b border-[#2A2E39] mt-1">
                    Minutes
                  </div>
                  {[60, 300, 900].map((min) => (
                    <button
                      key={min}
                      onClick={() => { setTimeframe(min); setShowTimeframeMenu(false); }}
                      className={`w-full px-3 py-2 text-left text-[13px] hover:bg-[#2A2E39] ${
                        timeframe === min ? 'text-white bg-[#2A2E39]' : 'text-[#B2B5BE]'
                      }`}
                    >
                      {min / 60} minute{min > 60 ? 's' : ''}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Chart Area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ChartArea
          sessionData={sessionData}
          isLoading={isLoading}
          chartType={chartType}
          timeframe={timeframe}
          previewData={previewData}
        />
      </div>

      {/* Controls Bar */}
      {currentSession && (
        <div className="flex-shrink-0">
          <ControlsBar
            currentSession={currentSession}
            sessionData={sessionData}
            setSessionData={setSessionData}
            onLoadingChange={onLoadingChange}
          />
        </div>
      )}

      {/* Session Search Modal */}
      <SessionSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectSession={onSelectSession}
        currentSession={currentSession}
      />
    </div>
  );
}