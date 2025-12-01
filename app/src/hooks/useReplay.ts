import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ReplayState } from '@momentum/replay-engine';
import type { SessionDataProvider } from '../providers/SessionDataProvider';

/**
 * Return type of the useReplay hook
 */
export interface UseReplayReturn {
  /** Current replay state */
  state: ReplayState | null;
  /** Progress percentage (0-100) */
  progress: number;
  /** Whether playback is active */
  isPlaying: boolean;
  /** Whether playback is paused */
  isPaused: boolean;
  /** Whether replay has ended */
  hasEnded: boolean;
  /** Current playback speed */
  speed: number;
  /** Available playback speeds */
  availableSpeeds: number[];
  /** Current time formatted as string */
  currentTimeFormatted: string;
  /** Duration formatted as string */
  durationFormatted: string;
  /** Start playback */
  play: () => void;
  /** Pause playback */
  pause: () => void;
  /** Toggle play/pause */
  togglePlayPause: () => void;
  /** Stop playback and reset */
  stop: () => void;
  /** Seek to a specific timestamp */
  seekTo: (timestamp: number) => void;
  /** Seek to a percentage (0-100) */
  seekToPercent: (percent: number) => void;
  /** Set playback speed */
  setSpeed: (speed: number) => void;
}

/**
 * Format a Unix timestamp to a readable time string
 */
function formatTime(timestamp: number): string {
  if (!timestamp || timestamp === 0) return '--:--:--';
  
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Format duration in seconds to a readable string
 */
function formatDuration(seconds: number): string {
  if (!seconds || seconds === 0) return '--:--';
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  }
  
  return `${mins}m ${secs}s`;
}

/**
 * Default replay state
 */
const DEFAULT_STATE: ReplayState = {
  status: 'idle',
  currentTime: 0,
  speed: 1,
  startTime: 0,
  endTime: 0,
};

/**
 * Hook for managing replay state from a SessionDataProvider
 * 
 * @param provider - The SessionDataProvider instance
 * @returns Reactive state and control functions for replay
 */
export function useReplay(provider: SessionDataProvider | null): UseReplayReturn {
  const [state, setState] = useState<ReplayState | null>(null);
  const [availableSpeeds, setAvailableSpeeds] = useState<number[]>([1, 2, 5, 10, 25, 50, 100]);

  // Subscribe to state changes from the replay engine
  useEffect(() => {
    if (!provider) {
      setState(null);
      return;
    }

    const engine = provider.getReplayEngine();
    setAvailableSpeeds(engine.getAvailableSpeeds());

    // Get initial state
    setState(engine.getState());

    // Subscribe to state changes
    const unsubscribe = engine.on('stateChange', (newState: ReplayState) => {
      setState(newState);
    });

    return () => {
      unsubscribe();
    };
  }, [provider]);

  // Computed values
  const progress = useMemo(() => {
    if (!state || state.startTime === state.endTime) return 0;
    const duration = state.endTime - state.startTime;
    const elapsed = state.currentTime - state.startTime;
    return (elapsed / duration) * 100;
  }, [state]);

  const isPlaying = useMemo(() => {
    return state?.status === 'playing';
  }, [state]);

  const isPaused = useMemo(() => {
    return state?.status === 'paused';
  }, [state]);

  const hasEnded = useMemo(() => {
    return state?.status === 'ended';
  }, [state]);

  const speed = useMemo(() => {
    return state?.speed ?? 1;
  }, [state]);

  const currentTimeFormatted = useMemo(() => {
    return formatTime(state?.currentTime ?? 0);
  }, [state?.currentTime]);

  const durationFormatted = useMemo(() => {
    if (!state) return '--:--';
    return formatDuration(state.endTime - state.startTime);
  }, [state]);

  // Control functions
  const play = useCallback(() => {
    provider?.play();
  }, [provider]);

  const pause = useCallback(() => {
    provider?.pause();
  }, [provider]);

  const togglePlayPause = useCallback(() => {
    if (!provider || !state) return;
    
    if (state.status === 'playing') {
      provider.pause();
    } else {
      provider.play();
    }
  }, [provider, state]);

  const stop = useCallback(() => {
    provider?.stop();
  }, [provider]);

  const seekTo = useCallback((timestamp: number) => {
    provider?.seekTo(timestamp);
  }, [provider]);

  const seekToPercent = useCallback((percent: number) => {
    provider?.seekToPercent(percent);
  }, [provider]);

  const setSpeedFn = useCallback((newSpeed: number) => {
    provider?.setSpeed(newSpeed);
  }, [provider]);

  return {
    state,
    progress,
    isPlaying,
    isPaused,
    hasEnded,
    speed,
    availableSpeeds,
    currentTimeFormatted,
    durationFormatted,
    play,
    pause,
    togglePlayPause,
    stop,
    seekTo,
    seekToPercent,
    setSpeed: setSpeedFn,
  };
}

export default useReplay;
