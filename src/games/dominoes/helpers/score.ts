// src/games/dominoes/helpers/score.ts

import { Tile } from "../types";

/**
 * Calculate the pip count (sum of dots) on a tile
 */
export function getTilePipCount(tile: Tile): number {
    return tile.left + tile.right;
}

/**
 * Calculate total pip count for a hand of tiles
 */
export function getHandPipCount(hand: Tile[]): number {
    return hand.reduce((sum, tile) => sum + getTilePipCount(tile), 0);
}

/**
 * Calculate scores when a round ends
 * Winner gets the sum of all opponents' remaining tile pip counts
 * Returns updated scores for all players
 */
export function calculateRoundScores(
    hands: Record<string, Tile[]>,
    currentScores: Record<string, number>,
    winnerId: string | null
): {
    scores: Record<string, number>;
    pipCounts: Record<string, number>;
    roundWinner: string | null;
} {
    const pipCounts: Record<string, number> = {};
    const newScores: Record<string, number> = { ...currentScores };

    // Calculate pip count for each player's remaining tiles
    for (const [playerId, hand] of Object.entries(hands)) {
        pipCounts[playerId] = getHandPipCount(hand);
    }

    // If there's a clear winner (went out), they get all opponent pip counts
    if (winnerId && hands[winnerId].length === 0) {
        const winnerPoints = Object.entries(pipCounts)
            .filter(([id]) => id !== winnerId)
            .reduce((sum, [, pips]) => sum + pips, 0);

        newScores[winnerId] = (newScores[winnerId] || 0) + winnerPoints;

        return {
            scores: newScores,
            pipCounts,
            roundWinner: winnerId,
        };
    }

    // If game is blocked (no winner), player with lowest pip count wins
    // and gets the difference from all other players
    let lowestPipCount = Infinity;
    let blockWinnerId: string | null = null;

    for (const [playerId, pipCount] of Object.entries(pipCounts)) {
        if (pipCount < lowestPipCount) {
            lowestPipCount = pipCount;
            blockWinnerId = playerId;
        } else if (pipCount === lowestPipCount && blockWinnerId) {
            // In case of tie, first player in order wins (could be customized)
            // For now, keep the first player found with lowest count
        }
    }

    if (blockWinnerId) {
        const winnerPoints = Object.entries(pipCounts)
            .filter(([id]) => id !== blockWinnerId)
            .reduce((sum, [, pips]) => sum + (pips - lowestPipCount), 0);

        newScores[blockWinnerId] =
            (newScores[blockWinnerId] || 0) + winnerPoints;
    }

    return {
        scores: newScores,
        pipCounts,
        roundWinner: blockWinnerId,
    };
}

/**
 * Check if any player has reached the winning score
 */
export function checkWinCondition(
    scores: Record<string, number>,
    winTarget: number
): string | null {
    for (const [playerId, score] of Object.entries(scores)) {
        if (score >= winTarget) {
            return playerId;
        }
    }
    return null;
}
