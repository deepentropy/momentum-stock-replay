/**
 * Simple typed event emitter for browser and Node.js environments
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class EventEmitter<T extends { [K in keyof T]: (...args: any[]) => void }> {
  private listeners: Map<keyof T, Set<T[keyof T]>> = new Map();

  /**
   * Subscribe to an event
   * @param event - Event name
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  on<K extends keyof T>(event: K, handler: T[K]): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as T[keyof T]);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Unsubscribe from an event
   * @param event - Event name
   * @param handler - Event handler function to remove
   */
  off<K extends keyof T>(event: K, handler: T[K]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler as T[keyof T]);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Emit an event to all subscribed handlers
   * @param event - Event name
   * @param args - Arguments to pass to handlers
   */
  emit<K extends keyof T>(event: K, ...args: Parameters<T[K]>): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          (handler as (...args: Parameters<T[K]>) => void)(...args);
        } catch (error) {
          // Log error but don't throw to allow other handlers to run
          console.error('EventEmitter handler error:', error);
        }
      });
    }
  }

  /**
   * Remove all event listeners
   */
  removeAllListeners(): void {
    this.listeners.clear();
  }

  /**
   * Check if there are listeners for an event
   * @param event - Event name
   * @returns True if there are listeners
   */
  hasListeners<K extends keyof T>(event: K): boolean {
    const handlers = this.listeners.get(event);
    return handlers !== undefined && handlers.size > 0;
  }
}
