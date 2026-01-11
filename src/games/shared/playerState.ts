// src/games/shared/playerState.ts

import { GameState } from "../../services/GameManager";

/**
 * Generic player reconnection handler.
 * Marks a player as connected in the game state.
 */
export function handlePlayerReconnect<T extends GameState>(
    state: T,
    userId: string
): T {
    if (state.players[userId]) {
        return {
            ...state,
            players: {
                ...state.players,
                [userId]: {
                    ...state.players[userId],
                    isConnected: true,
                },
            },
        };
    }
    return state;
}

/**
 * Generic player disconnection handler.
 * Marks a player as disconnected in the game state.
 */
export function handlePlayerDisconnect<T extends GameState>(
    state: T,
    userId: string
): T {
    if (state.players[userId]) {
        return {
            ...state,
            players: {
                ...state.players,
                [userId]: {
                    ...state.players[userId],
                    isConnected: false,
                },
            },
        };
    }
    return state;
}

/**
 * Check if all required players are connected.
 */
export function checkAllPlayersConnected<T extends GameState>(
    state: T,
    requiredPlayerCount: number
): boolean {
    const connectedPlayers = Object.values(state.players).filter(
        (player) => player.isConnected !== false
    );
    return connectedPlayers.length >= requiredPlayerCount;
}
