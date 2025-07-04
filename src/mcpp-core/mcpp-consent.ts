/**
 * Consent cache for managing user consent decisions
 */
export interface ConsentCacheEntry {
    decision: 'allow' | 'deny';
    timestamp: number;
    duration_minutes: number;
    requester_host_id: string;
    destination: string;
    data_usage: string;
}

export class ConsentCache {
    private cache = new Map<string, ConsentCacheEntry>();
    private pendingRequests = new Map<string, {
        resolve: (decision: 'allow' | 'deny') => void;
        reject: (reason: string) => void;
        timeout: NodeJS.Timeout;
    }>();

    /**
     * Store consent decision in cache
     */
    setConsent(
        cacheKey: string,
        decision: 'allow' | 'deny',
        durationMinutes: number,
        requesterHostId: string,
        destination: string,
        dataUsage: string
    ): void {
        this.cache.set(cacheKey, {
            decision,
            timestamp: Date.now(),
            duration_minutes: durationMinutes,
            requester_host_id: requesterHostId,
            destination,
            data_usage: dataUsage
        });

        // Clean up expired entries periodically
        this.cleanupExpiredEntries();
    }

    /**
     * Get cached consent decision
     */
    getConsent(cacheKey: string): 'allow' | 'deny' | null {
        const entry = this.cache.get(cacheKey);
        if (!entry) {
            return null;
        }

        // Check if entry has expired
        const expiryTime = entry.timestamp + (entry.duration_minutes * 60 * 1000);
        if (Date.now() > expiryTime) {
            this.cache.delete(cacheKey);
            return null;
        }

        return entry.decision;
    }

    /**
     * Check if consent exists in cache
     */
    hasConsent(cacheKey: string): boolean {
        return this.getConsent(cacheKey) !== null;
    }

    /**
     * Generate cache key for consent decision
     */
    generateCacheKey(
        requesterHostId: string,
        destination: string,
        dataUsage: string,
        toolName?: string
    ): string {
        const parts = [requesterHostId, destination, dataUsage];
        if (toolName) {
            parts.push(toolName);
        }
        return parts.join('::');
    }

    /**
     * Store pending consent request
     */
    storePendingRequest(
        requestId: string,
        timeoutSeconds: number
    ): Promise<'allow' | 'deny'> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject('timeout');
            }, timeoutSeconds * 1000);

            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                timeout
            });
        });
    }

    /**
     * Resolve pending consent request
     */
    resolveConsentRequest(requestId: string, decision: 'allow' | 'deny'): boolean {
        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
            return false;
        }

        clearTimeout(pending.timeout);
        this.pendingRequests.delete(requestId);
        pending.resolve(decision);
        return true;
    }

    /**
     * Get all pending request IDs
     */
    getPendingRequests(): string[] {
        return Array.from(this.pendingRequests.keys());
    }

    /**
     * Clean up expired cache entries
     */
    private cleanupExpiredEntries(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            const expiryTime = entry.timestamp + (entry.duration_minutes * 60 * 1000);
            if (now > expiryTime) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Clear all cache entries
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Get cache statistics
     */
    getStats(): {
        total_entries: number;
        expired_entries: number;
        pending_requests: number;
    } {
        this.cleanupExpiredEntries();
        return {
            total_entries: this.cache.size,
            expired_entries: 0, // Already cleaned up
            pending_requests: this.pendingRequests.size
        };
    }
}

// Global consent cache instance
export const consentCache = new ConsentCache();
