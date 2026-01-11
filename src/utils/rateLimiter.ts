/**
 * Simple in-memory rate limiter for socket events
 *
 * Implements a sliding window rate limiting algorithm without external dependencies.
 * Each socket ID has a counter that tracks events within a time window.
 */

interface RateLimitEntry {
    count: number;
    windowStart: number;
}

interface RateLimiterOptions {
    windowMs?: number; // Time window in milliseconds (default: 1000ms = 1 second)
    maxRequests?: number; // Max requests per window (default: 10)
}

export class RateLimiter {
    private entries: Map<string, RateLimitEntry> = new Map();
    private windowMs: number;
    private maxRequests: number;
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(options: RateLimiterOptions = {}) {
        this.windowMs = options.windowMs ?? 1000;
        this.maxRequests = options.maxRequests ?? 10;

        // Clean up old entries periodically to prevent memory leaks
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, this.windowMs * 10);
    }

    /**
     * Check if a request should be allowed
     * @param key - Identifier (usually socket ID)
     * @returns true if request is allowed, false if rate limited
     */
    isAllowed(key: string): boolean {
        const now = Date.now();
        const entry = this.entries.get(key);

        if (!entry) {
            // First request from this key
            this.entries.set(key, { count: 1, windowStart: now });
            return true;
        }

        // Check if we're still in the same window
        if (now - entry.windowStart < this.windowMs) {
            // Same window - increment count
            entry.count++;
            return entry.count <= this.maxRequests;
        } else {
            // New window - reset
            entry.count = 1;
            entry.windowStart = now;
            return true;
        }
    }

    /**
     * Consume a request and return remaining requests
     * @param key - Identifier (usually socket ID)
     * @returns Object with allowed status and remaining requests
     */
    consume(key: string): { allowed: boolean; remaining: number } {
        const now = Date.now();
        const entry = this.entries.get(key);

        if (!entry) {
            this.entries.set(key, { count: 1, windowStart: now });
            return { allowed: true, remaining: this.maxRequests - 1 };
        }

        if (now - entry.windowStart < this.windowMs) {
            entry.count++;
            const remaining = Math.max(0, this.maxRequests - entry.count);
            return { allowed: entry.count <= this.maxRequests, remaining };
        } else {
            entry.count = 1;
            entry.windowStart = now;
            return { allowed: true, remaining: this.maxRequests - 1 };
        }
    }

    /**
     * Remove a key (e.g., when socket disconnects)
     */
    remove(key: string): void {
        this.entries.delete(key);
    }

    /**
     * Clean up expired entries
     */
    private cleanup(): void {
        const now = Date.now();
        for (const [key, entry] of this.entries) {
            if (now - entry.windowStart > this.windowMs * 2) {
                this.entries.delete(key);
            }
        }
    }

    /**
     * Stop the cleanup interval (call when shutting down)
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.entries.clear();
    }
}

// Default rate limiter instance for socket events
// 50 events per second is generous for normal gameplay including initial load bursts
export const socketRateLimiter = new RateLimiter({
    windowMs: 1000,
    maxRequests: 50,
});
