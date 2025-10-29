import React, { useState, useEffect } from "react";
import { api } from "../utils/api";

export default function SessionsPanel({ currentSession, onSelectSession }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loadingMetadata, setLoadingMetadata] = useState({});

  const loadSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSessions();
      setSessions(data);

      // Optionally load metadata for each session (commented out for performance)
      // Uncomment if you want to load metadata on initial load
      // loadMetadataForSessions(data);
    } catch (err) {
      setError(err.message);
      console.error('Error loading sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadMetadataForSessions = async (sessionList) => {
    // Load metadata for first 5 sessions only to avoid too many requests
    const sessionsToLoad = sessionList.slice(0, 5);

    for (const session of sessionsToLoad) {
      if (session.px_start === null) {
        setLoadingMetadata(prev => ({ ...prev, [session.id]: true }));
        const metadata = await api.getSessionMetadata(session.id);
        if (metadata) {
          setSessions(prev => prev.map(s =>
            s.id === session.id ? { ...s, ...metadata } : s
          ));
        }
        setLoadingMetadata(prev => ({ ...prev, [session.id]: false }));
      }
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  return (
    <div className="flex flex-col h-full bg-gray-900 border-r border-gray-800">
      <div className="px-5 py-4 bg-gray-800 border-b border-gray-700">
        <h2 className="text-lg font-bold text-green-400 mb-3">📊 Trading Sessions</h2>
        <button
          onClick={loadSessions}
          disabled={loading}
          className="w-full px-4 py-2 bg-green-500 text-white rounded font-semibold hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? '⏳ Loading...' : '🔄 Refresh Sessions'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {error && (
          <div className="bg-red-900 border border-red-700 text-red-200 px-4 py-3 rounded mb-3">
            ⚠️ {error}
          </div>
        )}

        {loading && sessions.length === 0 && (
          <div className="text-gray-400 text-center mt-10">Loading sessions...</div>
        )}

        {!loading && sessions.length === 0 && !error && (
          <div className="text-gray-400 text-center mt-10">No sessions available</div>
        )}

        {sessions.map((session) => {
          const isActive = currentSession?.id === session.id;
          const hasMetadata = session.px_start !== null && session.px_end !== null;
          const isLoadingMeta = loadingMetadata[session.id];

          let priceChange = 0;
          let priceChangePercent = 0;
          let changeClass = 'positive';
          let changeSymbol = '▲';

          if (hasMetadata) {
            priceChange = session.px_end - session.px_start;
            priceChangePercent = ((priceChange / session.px_start) * 100).toFixed(2);
            changeClass = priceChange >= 0 ? 'positive' : 'negative';
            changeSymbol = priceChange >= 0 ? '▲' : '▼';
          }

          return (
            <div
              key={session.id}
              onClick={() => onSelectSession(session)}
              className={`
                bg-gray-800 border rounded-lg p-4 mb-3 cursor-pointer 
                transition-all hover:border-green-500 hover:translate-x-1
                ${isActive ? 'border-green-500 bg-gray-700' : 'border-gray-700'}
              `}
            >
              <div className="flex justify-between items-center mb-2">
                <div className="text-lg font-bold text-green-400">{session.symbol}</div>
                <div className="text-xs text-gray-400">{session.date}</div>
              </div>

              <div className="space-y-1 text-sm">
                {hasMetadata ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Start Price:</span>
                      <span className="font-medium">{session.px_start.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">End Price:</span>
                      <span className="font-medium">{session.px_end.toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Change:</span>
                      <span className={`font-bold ${changeClass === 'positive' ? 'text-green-400' : 'text-red-400'}`}>
                        {changeSymbol} {Math.abs(priceChangePercent)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Duration:</span>
                      <span className="font-medium">{session.duration_m}m</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Ticks:</span>
                      <span className="font-medium">{session.tickCount?.toLocaleString()}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-400">File Size:</span>
                      <span className="font-medium">{(session.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                    {isLoadingMeta && (
                      <div className="text-xs text-gray-500 text-center py-2">
                        Loading metadata...
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}