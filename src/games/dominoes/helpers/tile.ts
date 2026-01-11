// src/games/dominoes/helpers/tile.ts

import { Tile } from "../types";
import { GamePlayers } from "../../../services/GameManager";
import { shuffle } from "../../shared";

/**
 * Generate a standard double-six domino set (28 tiles)
 * Tiles range from [0,0] to [6,6]
 */
export function buildDominoSet(): Tile[] {
    const tiles: Tile[] = [];
    let idCounter = 0;

    for (let left = 0; left <= 6; left++) {
        for (let right = left; right <= 6; right++) {
            tiles.push({
                left,
                right,
                id: `tile-${idCounter++}`,
            });
        }
    }

    return tiles;
}

/**
 * Shuffle tiles using shared Fisher-Yates implementation.
 */
export function shuffleTiles(
    tiles: Tile[],
    rng: () => number = Math.random
): Tile[] {
    return shuffle(tiles, rng);
}

/**
 * Deal tiles to players. For 4 players, each gets 7 tiles.
 * Pre-condition: players.length === 4
 */
export function dealTilesToPlayers(
    tiles: Tile[],
    players: GamePlayers
): Record<string, Tile[]> {
    const playerIds = Object.keys(players);
    if (playerIds.length !== 4) {
        throw new Error("Dominoes needs 4 players");
    }

    const hands: Record<string, Tile[]> = playerIds.reduce(
        (acc, id) => {
            acc[id] = [];
            return acc;
        },
        {} as Record<string, Tile[]>
    );

    // Deal 7 tiles to each player (28 tiles total, 7 each)
    if (tiles.length < 28) {
        throw new Error("Not enough tiles to deal to 4 players");
    }
    tiles.forEach((tile, idx) => {
        if (idx < 28) {
            const playerId = playerIds[idx % 4];
            hands[playerId].push(tile);
        }
    });

    // Sort each hand by left value, then right value
    for (const playerId of playerIds) {
        hands[playerId] = sortHand(hands[playerId]);
    }

    return hands;
}

/**
 * Sort tiles in a hand for consistent ordering
 */
function sortHand(hand: Tile[]): Tile[] {
    return hand.slice().sort((a, b) => {
        if (a.left !== b.left) {
            return a.left - b.left;
        }
        return a.right - b.right;
    });
}

/**
 * Check if a tile is a double (both sides have same value)
 */
export function isDouble(tile: Tile): boolean {
    return tile.left === tile.right;
}

/**
 * Get the highest double in a hand, or null if none
 */
export function getHighestDouble(hand: Tile[]): Tile | null {
    const doubles = hand.filter(isDouble);
    if (doubles.length === 0) return null;
    return doubles.reduce((highest, tile) =>
        tile.left > highest.left ? tile : highest
    );
}

/**
 * Find the player with the highest double in their hand
 * Returns the playerId or null if no player has a double
 */
export function findPlayerWithHighestDouble(
    hands: Record<string, Tile[]>
): string | null {
    let highestDouble: Tile | null = null;
    let playerWithHighest: string | null = null;

    for (const [playerId, hand] of Object.entries(hands)) {
        const playerHighest = getHighestDouble(hand);
        if (playerHighest) {
            if (!highestDouble || playerHighest.left > highestDouble.left) {
                highestDouble = playerHighest;
                playerWithHighest = playerId;
            }
        }
    }

    return playerWithHighest;
}
