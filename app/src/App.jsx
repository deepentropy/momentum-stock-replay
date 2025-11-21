import { useState, useEffect, useRef } from "react";
import { SettingsProvider } from "./contexts/SettingsContext";
import SettingsPanel from "./components/SettingsPanel";
import CenterPanel from "./components/CenterPanel";
import OrderBookPanel from "./components/OrderBookPanel";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentSession, setCurrentSession] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionData, setSessionData] = useState({
    quote: null,
    stats: {
      quoteCount: 0,
      sessionMeta: null,
    }
  });
  const [positionSummary, setPositionSummary] = useState(null);

  const chartRef = useRef(null);

  // Chart controls state
  const [chartType, setChartType] = useState('candlestick');
  const [timeframe, setTimeframe] = useState(10);

  const handleAddMarker = (marker) => {
    if (chartRef.current && chartRef.current.addMarker) {
      chartRef.current.addMarker(marker);
    }
  };

  const handlePositionChange = (summary) => {
    setPositionSummary(summary);
  };

  // Global keyboard shortcut for session search (Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        const searchButton = document.querySelector('[data-search-trigger]');
        if (searchButton) searchButton.click();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <SettingsProvider>
      <div className="flex h-screen w-screen bg-gray-900 text-gray-100 overflow-hidden">
        <div className="flex-1 min-w-0 overflow-hidden">
          <CenterPanel
            ref={chartRef}
            currentSession={currentSession}
            sessionData={sessionData}
            setSessionData={setSessionData}
            isLoading={isLoading}
            onLoadingChange={setIsLoading}
            onSelectSession={setCurrentSession}
            chartType={chartType}
            setChartType={setChartType}
            timeframe={timeframe}
            setTimeframe={setTimeframe}
            onOpenSettings={() => setSettingsOpen(true)}
            positionSummary={positionSummary}
          />
        </div>

        <div className="flex-shrink-0">
          <OrderBookPanel
            sessionData={sessionData}
            onAddMarker={handleAddMarker}
            onPositionChange={handlePositionChange}
          />
        </div>

        {/* Settings Modal */}
        {settingsOpen && (
          <>
            <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setSettingsOpen(false)}></div>
            <div className="fixed top-0 right-0 h-full w-[400px] z-50 shadow-2xl">
              <div className="relative h-full">
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded hover:bg-[#2A2E39] transition-colors text-[#B2B5BE] hover:text-white"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 5L5 15M5 5l10 10"/>
                  </svg>
                </button>
                <SettingsPanel />
              </div>
            </div>
          </>
        )}
      </div>
    </SettingsProvider>
  );
}