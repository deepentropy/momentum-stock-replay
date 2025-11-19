import { useRef, useCallback, useState, useEffect } from 'react';

export function useTickPlayer(onTick, onInit, onEnd) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [progress, setProgress] = useState(0);

  const ticksRef = useRef([]);
  const currentIndexRef = useRef(0);
  const intervalRef = useRef(null);
  const sessionMetaRef = useRef(null);
  const isPausedRef = useRef(false);
  const speedRef = useRef(1);
  const virtualTimeRef = useRef(0); // Virtual wall-clock time in seconds

  const stopPlayback = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPlaying(false);
    setIsPaused(false);
    isPausedRef.current = false;
    currentIndexRef.current = 0;
    virtualTimeRef.current = 0;
    setProgress(0);
  }, []);

  const playNextTick = useCallback(() => {
    if (isPausedRef.current) return;

    const ticks = ticksRef.current;
    const currentIndex = currentIndexRef.current;

    if (currentIndex >= ticks.length) {
      stopPlayback();
      onEnd?.();
      return;
    }

    const currentTick = ticks[currentIndex];
    
    // Send tick data with virtual time
    onTick?.(currentTick, virtualTimeRef.current);

    currentIndexRef.current++;
    // Increment virtual time by 0.1 seconds (100ms) per tick
    virtualTimeRef.current += 0.1;
    setProgress((currentIndexRef.current / ticks.length) * 100);
  }, [onTick, onEnd, stopPlayback]);

  const loadAndPlay = useCallback(async (sessionId, tickData) => {
    stopPlayback();

    ticksRef.current = tickData;
    currentIndexRef.current = 0;

    // Extract metadata
    const meta = {
      symbol: sessionId.split('-')[0],
      totalTicks: tickData.length,
      startTime: tickData[0]?.timestamp || tickData[0]?.time,
      endTime: tickData[tickData.length - 1]?.timestamp || tickData[tickData.length - 1]?.time
    };

    sessionMetaRef.current = meta;
    
    // Initialize virtual time from first tick's timestamp
    const firstTick = tickData[0];
    if (firstTick) {
      virtualTimeRef.current = firstTick.adjustedTimestamp || 
                               (new Date(firstTick.timestamp || firstTick.time).getTime() / 1000);
    }
    
    onInit?.(meta);

    setIsPlaying(true);
    setIsPaused(false);
    isPausedRef.current = false;

    // Fixed delay: 100ms per tick (10 ticks/second), adjusted by speed
    const intervalMs = 100 / speedRef.current;
    
    intervalRef.current = setInterval(playNextTick, intervalMs);
  }, [playNextTick, stopPlayback, onInit]);

  const pause = useCallback(() => {
    setIsPaused(true);
    isPausedRef.current = true;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const resume = useCallback(() => {
    if (!isPlaying) return;
    setIsPaused(false);
    isPausedRef.current = false;
    
    const intervalMs = 100 / speedRef.current;
    intervalRef.current = setInterval(playNextTick, intervalMs);
  }, [isPlaying, playNextTick]);

  const changeSpeed = useCallback((newSpeed) => {
    setSpeed(newSpeed);
    speedRef.current = newSpeed;
    
    // Restart interval with new speed if playing
    if (isPlaying && !isPausedRef.current && intervalRef.current) {
      clearInterval(intervalRef.current);
      const intervalMs = 100 / newSpeed;
      intervalRef.current = setInterval(playNextTick, intervalMs);
    }
  }, [isPlaying, playNextTick]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    loadAndPlay,
    stop: stopPlayback,
    pause,
    resume,
    changeSpeed,
    isPlaying,
    isPaused,
    speed,
    progress,
    sessionMeta: sessionMetaRef.current
  };
}