import type { McppTableData } from './mcpp-types.js';

/**
 * In-memory cache for storing sensitive tool data
 */
export class McppDataCache {
    private cache = new Map<string, any>();

    /**
     * Store data in cache with given tool call ID
     */
    set(toolCallId: string, data: any): void {
        this.cache.set(toolCallId, data);
    }

    /**
     * Retrieve data from cache by tool call ID
     */
    get(toolCallId: string): any {
        return this.cache.get(toolCallId);
    }

    /**
     * Check if data exists in cache
     */
    has(toolCallId: string): boolean {
        return this.cache.has(toolCallId);
    }

    /**
     * Remove data from cache
     */
    delete(toolCallId: string): boolean {
        return this.cache.delete(toolCallId);
    }

    /**
     * Get all available cache keys
     */
    getAvailableCaches(): string[] {
        return Array.from(this.cache.keys());
    }

    /**
     * Clear all cached data
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Get cache size
     */
    size(): number {
        return this.cache.size;
    }
}

// Global cache instance
export const dataCache = new Map<string, any>();
