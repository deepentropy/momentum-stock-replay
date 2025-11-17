import { useRef, useCallback, useState, useEffect } from 'react';

export function useTickPlayer(onTick, onInit, onEnd) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [progress, setProgress] = useState(0);

  const ticksRef = useRef([]);
  const currentIndexRef = useRef(0);
  const animationFrameRef = useRef(null);
  const lastTickTimeRef = useRef(0);
  const sessionMetaRef = useRef(null);
  const isPausedRef = useRef(false);
  const speedRef = useRef(1);

  const stopPlayback = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setIsPlaying(false);
    setIsPaused(false);
    isPausedRef.current = false;
    currentIndexRef.current = 0;
    setProgress(0);
  }, []);

  const playTicks = useCallback((timestamp) => {
    // Use ref instead of closure to avoid stale values
    if (isPausedRef.current) return;

    const ticks = ticksRef.current;
    const currentIndex = currentIndexRef.current;

    if (currentIndex >= ticks.length) {
      stopPlayback();
      onEnd?.();
      return;
    }

    const currentTick = ticks[currentIndex];
    const nextTick = ticks[currentIndex + 1];

    if (!lastTickTimeRef.current) {
      lastTickTimeRef.current = timestamp;
    }

    const elapsed = timestamp - lastTickTimeRef.current;

    // Calculate delay between current and next tick using adjustedTimestamp
    let delay = 0;
    if (nextTick && currentTick.adjustedTimestamp && nextTick.adjustedTimestamp) {
      const timeDiff = (nextTick.adjustedTimestamp - currentTick.adjustedTimestamp) * 1000; // Convert to ms
      delay = timeDiff / speedRef.current;

      // Cap maximum delay at 1000ms to prevent frozen playback
      if (delay > 1000) {
        delay = 1000;
      }
    } else {
      delay = 10 / speedRef.current; // Default 10ms if no timestamp
    }

    if (elapsed >= delay) {
      // Send tick data
      onTick?.(currentTick);

      currentIndexRef.current++;
      lastTickTimeRef.current = timestamp;
      setProgress((currentIndexRef.current / ticks.length) * 100);
    }

    animationFrameRef.current = requestAnimationFrame(playTicks);
  }, [onTick, onEnd, stopPlayback]);

  const loadAndPlay = useCallback(async (sessionId, tickData) => {
    stopPlayback();

    ticksRef.current = tickData;
    currentIndexRef.current = 0;
    lastTickTimeRef.current = 0;

    // Extract metadata
    const meta = {
      symbol: sessionId.split('-')[0],
      totalTicks: tickData.length,
      startTime: tickData[0]?.timestamp || tickData[0]?.time,
      endTime: tickData[tickData.length - 1]?.timestamp || tickData[tickData.length - 1]?.time
    };

    sessionMetaRef.current = meta;
    onInit?.(meta);

    setIsPlaying(true);
    setIsPaused(false);
    isPausedRef.current = false;

    animationFrameRef.current = requestAnimationFrame(playTicks);
  }, [playTicks, stopPlayback, onInit]);

  const pause = useCallback(() => {
    setIsPaused(true);
    isPausedRef.current = true;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const resume = useCallback(() => {
    if (!isPlaying) return;
    setIsPaused(false);
    isPausedRef.current = false;
    lastTickTimeRef.current = 0;
    animationFrameRef.current = requestAnimationFrame(playTicks);
  }, [isPlaying, playTicks]);

  const changeSpeed = useCallback((newSpeed) => {
    setSpeed(newSpeed);
    speedRef.current = newSpeed;
    lastTickTimeRef.current = 0; // Reset timing
  }, []);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
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