import { useEffect, useRef, useCallback, useState } from 'react';

export function useWebSocket(url, options = {}) {
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const mountedRef = useRef(true);
  const [isConnected, setIsConnected] = useState(false);
  const { onMessage, onOpen, onClose, onError, autoReconnect = false } = options;

  const send = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
      return true;
    }
    console.warn('WebSocket is not connected. Cannot send message.');
    return false;
  }, []);

  const close = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      // Remove event listeners before closing
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;

      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (!url) {
      setIsConnected(false);
      return;
    }

    // Don't reconnect if we already have an open connection to the same URL
    if (wsRef.current && wsRef.current.url === url && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    // Close existing connection if URL changed
    if (wsRef.current) {
      close();
    }

    console.log('Connecting to WebSocket:', url);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = (event) => {
      if (!mountedRef.current) return;
      console.log('✅ WebSocket connected successfully');
      setIsConnected(true);
      onOpen?.(event);
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(event.data);
        onMessage?.(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    ws.onerror = (event) => {
      if (!mountedRef.current) return;
      console.error('❌ WebSocket error');
      console.error('Failed to connect to:', url);
      console.error('Make sure your FastAPI backend is running on http://localhost:8000');
      setIsConnected(false);
      onError?.(event);
    };

    ws.onclose = (event) => {
      if (!mountedRef.current) return;
      console.log('WebSocket closed. Code:', event.code, 'Reason:', event.reason || 'No reason provided');
      setIsConnected(false);
      wsRef.current = null;
      onClose?.(event);

      // Auto-reconnect logic if needed (disabled by default)
      if (autoReconnect && !event.wasClean && mountedRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('Attempting to reconnect...');
        }, 3000);
      }
    };

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [url]); // Only reconnect when URL changes

  return { send, close, isConnected };
}