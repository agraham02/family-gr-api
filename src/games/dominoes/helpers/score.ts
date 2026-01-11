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

export interface RoundScoreResult {
    scores: Record<string, number>;
    pipCounts: Record<string, number>;
    roundWinner: string | null;
    isTie: boolean;
}

/**
 * Calculate scores when a round ends
 * Winner gets the sum of all opponents' remaining tile pip counts
 * Returns updated scores for all players
 *
 * Caribbean (Jamaican) tie-breaking rules:
 * - If game is blocked and multiple players tie for lowest pip count,
 *   the round is a tie and no one scores
 */
export function calculateRoundScores(
    hands: Record<string, Tile[]>,
    currentScores: Record<string, number>,
    winnerId: string | null
): RoundScoreResult {
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
            isTie: false,
        };
    }

    // Game is blocked (no winner) - find player(s) with lowest pip count
    let lowestPipCount = Infinity;

    for (const pipCount of Object.values(pipCounts)) {
        if (pipCount < lowestPipCount) {
            lowestPipCount = pipCount;
        }
    }

    // Find all players with the lowest pip count
    const playersWithLowestPips = Object.entries(pipCounts)
        .filter(([, pips]) => pips === lowestPipCount)
        .map(([playerId]) => playerId);

    // Caribbean rule: If multiple players tie for lowest, round is a tie
    if (playersWithLowestPips.length > 1) {
        return {
            scores: newScores, // No score changes
            pipCounts,
            roundWinner: null,
            isTie: true,
        };
    }

    // Single winner with lowest pip count
    const blockWinnerId = playersWithLowestPips[0];
    const winnerPoints = Object.entries(pipCounts)
        .filter(([id]) => id !== blockWinnerId)
        .reduce((sum, [, pips]) => sum + (pips - lowestPipCount), 0);

    newScores[blockWinnerId] = (newScores[blockWinnerId] || 0) + winnerPoints;

    return {
        scores: newScores,
        pipCounts,
        roundWinner: blockWinnerId,
        isTie: false,
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
