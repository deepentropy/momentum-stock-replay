import React, { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';

export default function SessionSearchModal({ isOpen, onClose, onSelectSession, currentSession }) {
  const [sessions, setSessions] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      loadSessions();
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const loadSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSessions();
      setSessions(data);
    } catch (err) {
      setError(err.message);
      console.error('Error loading sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredSessions = sessions.filter(session => {
    const search = searchTerm.toLowerCase();
    return (
      session.symbol.toLowerCase().includes(search) ||
      session.date.includes(search) ||
      session.id.toLowerCase().includes(search)
    );
  });

  const handleSelect = (session) => {
    onSelectSession(session);
    onClose();
    setSearchTerm('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && filteredSessions.length > 0) {
      handleSelect(filteredSessions[0]);
    }
  };

  if (!isOpen) return null;

  const categories = ['All', 'Stocks', 'Recent'];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-start justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#1E222D] rounded mt-16 w-full max-w-3xl max-h-[600px] flex flex-col border border-[#2A2E39] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#2A2E39]">
          <h2 className="text-[15px] font-semibold text-white">Symbol Search</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#2A2E39] text-[#787B86] hover:text-white transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Search Input */}
        <div className="px-5 py-3 border-b border-[#2A2E39]">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#787B86]"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search sessions..."
              className="w-full bg-[#131722] border border-[#2A2E39] rounded pl-10 pr-4 py-2.5 text-[14px] text-white placeholder-[#787B86] focus:outline-none focus:border-[#2962FF] transition-colors"
            />
          </div>
        </div>

        {/* Categories */}
        <div className="flex items-center gap-1 px-5 py-2 border-b border-[#2A2E39] overflow-x-auto">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-1.5 rounded text-[13px] font-medium transition-colors whitespace-nowrap ${
                selectedCategory === cat
                  ? 'bg-[#2A2E39] text-white'
                  : 'text-[#787B86] hover:text-white hover:bg-[#2A2E39]/50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-16 text-[#787B86]">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-[#2962FF] border-t-transparent rounded-full animate-spin"></div>
                <span className="text-[14px]">Loading sessions...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="mx-5 my-4 px-4 py-3 bg-[#F23645]/10 border border-[#F23645]/30 rounded text-[#F23645] text-[13px]">
              {error}
            </div>
          )}

          {!loading && !error && filteredSessions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-[#787B86]">
              <svg className="w-12 h-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24">
                <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <p className="text-[14px]">
                {searchTerm ? 'No sessions found' : 'Start typing to search'}
              </p>
            </div>
          )}

          {!loading && !error && filteredSessions.length > 0 && (
            <div className="divide-y divide-[#2A2E39]">
              {filteredSessions.map((session) => {
                const isActive = currentSession?.id === session.id;
                return (
                  <button
                    key={session.id}
                    onClick={() => handleSelect(session)}
                    className={`w-full px-5 py-3 flex items-center justify-between hover:bg-[#2A2E39] transition-colors group ${
                      isActive ? 'bg-[#2A2E39]/50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      {/* Symbol Icon */}
                      <div className={`w-8 h-8 rounded flex items-center justify-center text-[13px] font-bold ${
                        isActive ? 'bg-[#2962FF] text-white' : 'bg-[#2A2E39] text-[#787B86] group-hover:bg-[#363A45]'
                      }`}>
                        {session.symbol.charAt(0)}
                      </div>

                      {/* Session Info */}
                      <div className="flex flex-col items-start">
                        <div className="flex items-center gap-2">
                          <span className={`text-[15px] font-semibold ${
                            isActive ? 'text-[#2962FF]' : 'text-white'
                          }`}>
                            {session.symbol}
                          </span>
                          {isActive && (
                            <span className="px-1.5 py-0.5 bg-[#2962FF] text-white text-[10px] font-medium rounded uppercase">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-[#787B86]">
                          <span>{session.date}</span>
                          <span>•</span>
                          <span>{(session.size / 1024 / 1024).toFixed(1)} MB</span>
                        </div>
                      </div>
                    </div>

                    {/* Arrow Icon */}
                    <svg
                      className={`w-5 h-5 transition-opacity ${
                        isActive ? 'text-[#2962FF] opacity-100' : 'text-[#787B86] opacity-0 group-hover:opacity-100'
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#2A2E39] bg-[#1E222D]">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-[#787B86]">
              {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''} found
            </span>
            <div className="flex items-center gap-4 text-[#787B86]">
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 bg-[#2A2E39] rounded text-[11px] font-mono">↵</kbd>
                <span>to select</span>
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 bg-[#2A2E39] rounded text-[11px] font-mono">esc</kbd>
                <span>to close</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}