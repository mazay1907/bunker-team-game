/**
 * React hook for observing socket connection state.
 * Manages connect/disconnect lifecycle and surfaces connection state to components.
 */

import { useState, useEffect, useCallback } from 'react';
import { socket } from './socket.js';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface UseSocketResult {
  connectionState: ConnectionState;
  connect: () => void;
  disconnect: () => void;
  isConnected: boolean;
}

export function useSocket(): UseSocketResult {
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    socket.connected ? 'connected' : 'disconnected',
  );

  useEffect(() => {
    const onConnect = (): void => {
      setConnectionState('connected');
    };

    const onDisconnect = (): void => {
      setConnectionState('disconnected');
    };

    const onConnectError = (err: Error): void => {
      console.error('[socket] connect_error:', err.message);
      setConnectionState('error');
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
    };
  }, []);

  const connect = useCallback((): void => {
    if (!socket.connected) {
      setConnectionState('connecting');
      socket.connect();
    }
  }, []);

  const disconnect = useCallback((): void => {
    socket.disconnect();
  }, []);

  return {
    connectionState,
    connect,
    disconnect,
    isConnected: connectionState === 'connected',
  };
}
