// src/services/TurnTimerService.ts

/**
 * TurnTimerService - Manages turn timers for games.
 *
 * Tracks active timers per game and triggers callbacks when timeouts occur.
 * Supports pause/resume for handling player disconnections.
 */

export interface TurnTimerState {
    gameId: string;
    playerId: string;
    timeoutSeconds: number;
    startedAt: number; // Unix timestamp ms
    pausedAt: number | null; // Unix timestamp ms when paused, null if running
    remainingWhenPaused: number | null; // Remaining ms when paused
    timer: NodeJS.Timeout | null;
    onTimeout: () => void;
}

class TurnTimerService {
    private activeTimers: Map<string, TurnTimerState> = new Map();

    /**
     * Grace period in milliseconds added to timeout to account for network latency.
     * The client timer will expire before the server timer, giving the player
     * a chance to submit their action before the server auto-acts.
     */
    private readonly GRACE_PERIOD_MS = 2000; // 2 seconds

    /**
     * Start a turn timer for a game.
     * If a timer already exists for this game, it will be cancelled first.
     *
     * @param gameId - The game ID
     * @param playerId - The player whose turn it is
     * @param timeoutSeconds - Seconds until timeout (from settings)
     * @param onTimeout - Callback to execute when timeout occurs
     */
    startTurn(
        gameId: string,
        playerId: string,
        timeoutSeconds: number,
        onTimeout: () => void
    ): void {
        // Cancel any existing timer for this game
        this.cancelTurn(gameId);

        if (timeoutSeconds <= 0) {
            // No timer configured
            return;
        }

        const timeoutMs = timeoutSeconds * 1000 + this.GRACE_PERIOD_MS;
        const now = Date.now();

        const timer = setTimeout(() => {
            console.log(
                `⏰ Turn timeout for game ${gameId}, player ${playerId}`
            );
            this.activeTimers.delete(gameId);
            onTimeout();
        }, timeoutMs);

        const state: TurnTimerState = {
            gameId,
            playerId,
            timeoutSeconds,
            startedAt: now,
            pausedAt: null,
            remainingWhenPaused: null,
            timer,
            onTimeout,
        };

        this.activeTimers.set(gameId, state);
        console.log(
            `⏱️ Started turn timer for game ${gameId}, player ${playerId}, ${timeoutSeconds}s (${timeoutMs}ms with grace)`
        );
    }

    /**
     * Cancel the turn timer for a game.
     * Called when a valid action is received before timeout.
     *
     * @param gameId - The game ID
     */
    cancelTurn(gameId: string): void {
        const state = this.activeTimers.get(gameId);
        if (state?.timer) {
            clearTimeout(state.timer);
            console.log(`⏹️ Cancelled turn timer for game ${gameId}`);
        }
        this.activeTimers.delete(gameId);
    }

    /**
     * Pause the turn timer for a game.
     * Called when a player disconnects mid-game.
     *
     * @param gameId - The game ID
     */
    pauseTurn(gameId: string): void {
        const state = this.activeTimers.get(gameId);
        if (!state || state.pausedAt !== null) {
            // No timer or already paused
            return;
        }

        const now = Date.now();
        const elapsed = now - state.startedAt;
        const totalTimeoutMs =
            state.timeoutSeconds * 1000 + this.GRACE_PERIOD_MS;
        const remaining = Math.max(0, totalTimeoutMs - elapsed);

        // Clear the active timer
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }

        state.pausedAt = now;
        state.remainingWhenPaused = remaining;

        console.log(
            `⏸️ Paused turn timer for game ${gameId}, ${remaining}ms remaining`
        );
    }

    /**
     * Resume the turn timer for a game.
     * Called when all players have reconnected.
     *
     * @param gameId - The game ID
     */
    resumeTurn(gameId: string): void {
        const state = this.activeTimers.get(gameId);
        if (!state || state.pausedAt === null) {
            // No timer or not paused
            return;
        }

        const remaining = state.remainingWhenPaused ?? 0;
        if (remaining <= 0) {
            // Timer would have already expired
            console.log(
                `⏰ Turn timer expired while paused for game ${gameId}`
            );
            this.activeTimers.delete(gameId);
            state.onTimeout();
            return;
        }

        // Restart with remaining time
        state.startedAt =
            Date.now() -
            (state.timeoutSeconds * 1000 + this.GRACE_PERIOD_MS - remaining);
        state.pausedAt = null;
        state.remainingWhenPaused = null;

        state.timer = setTimeout(() => {
            console.log(`⏰ Turn timeout for game ${gameId} (after resume)`);
            this.activeTimers.delete(gameId);
            state.onTimeout();
        }, remaining);

        console.log(
            `▶️ Resumed turn timer for game ${gameId}, ${remaining}ms remaining`
        );
    }

    /**
     * Check if a timer is active for a game.
     *
     * @param gameId - The game ID
     * @returns True if timer is active (not paused)
     */
    isTimerActive(gameId: string): boolean {
        const state = this.activeTimers.get(gameId);
        return !!state && state.pausedAt === null;
    }

    /**
     * Check if a timer is paused for a game.
     *
     * @param gameId - The game ID
     * @returns True if timer is paused
     */
    isTimerPaused(gameId: string): boolean {
        const state = this.activeTimers.get(gameId);
        return !!state && state.pausedAt !== null;
    }

    /**
     * Get the current player whose turn timer is running.
     *
     * @param gameId - The game ID
     * @returns Player ID or undefined if no timer
     */
    getCurrentTurnPlayer(gameId: string): string | undefined {
        return this.activeTimers.get(gameId)?.playerId;
    }

    /**
     * Clean up all timers for a game.
     * Called when a game ends or is aborted.
     *
     * @param gameId - The game ID
     */
    cleanupGame(gameId: string): void {
        this.cancelTurn(gameId);
    }
}

// Singleton instance
export const turnTimerService = new TurnTimerService();
