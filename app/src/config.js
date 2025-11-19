/**
 * Application Configuration
 * 
 * Feature flags and configuration options
 */

// Feature Flags
export const USE_OAKVIEW_CHART = true; // Set to false to use legacy ChartArea

// Chart Configuration
export const DEFAULT_TIMEFRAME = 1; // seconds
export const DEFAULT_CHART_TYPE = 'candlestick'; // 'candlestick' | 'line'
export const DEFAULT_SPEED = 1; // playback speed multiplier

// API Configuration
export const BASE_URL = import.meta.env.VITE_BASE_URL || '';
export const SESSIONS_PATH = import.meta.env.VITE_SESSIONS_PATH || '/sessions';
