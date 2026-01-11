// src/games/spades/helpers/autoAction.ts

/**
 * Auto-action helpers for Spades.
 * Used when a player times out and the server needs to play on their behalf.
 */

import { SpadesState, Trick } from "..";
import { Card, Bid } from "../types";
import { canPlayCard } from "./player";

/**
 * Get the auto-bid for a player who timed out during bidding.
 * Returns the lowest legal bid value.
 *
 * @param state - The current game state
 * @param playerId - The player who timed out
 * @returns The bid to place
 */
export function getAutoBid(state: SpadesState, _playerId: string): Bid {
    // If nil is allowed, bid 0 (nil)
    // Otherwise bid 1 (minimum non-nil bid)
    const nilAllowed = state.settings.allowNil;

    return {
        amount: nilAllowed ? 0 : 1,
        type: nilAllowed ? "nil" : "normal",
        isBlind: false,
    };
}

/**
 * Get the auto-play card for a player who timed out during playing.
 * Returns the first legal card from their hand.
 *
 * @param state - The current game state
 * @param playerId - The player who timed out
 * @returns The card to play, or null if no legal card (shouldn't happen)
 */
export function getAutoPlayCard(
    state: SpadesState,
    playerId: string
): Card | null {
    const hand = state.hands[playerId];
    if (!hand || hand.length === 0) {
        console.error(`No cards in hand for player ${playerId}`);
        return null;
    }

    const trick = state.currentTrick || createEmptyTrick(playerId);

    // Find the first legal card
    for (const card of hand) {
        if (canPlayCard(card, hand, trick, state.spadesBroken)) {
            return card;
        }
    }

    // Fallback: just play the first card (shouldn't happen if game logic is correct)
    console.warn(
        `No legal card found for player ${playerId}, playing first card`
    );
    return hand[0];
}

/**
 * Create an empty trick for the first player.
 */
function createEmptyTrick(leaderId: string): Trick {
    return {
        leaderId,
        plays: [],
        leadSuit: null,
    };
}

/**
 * Check if a player is the current turn player.
 */
export function isPlayerTurn(state: SpadesState, playerId: string): boolean {
    const currentPlayerId = state.playOrder[state.currentTurnIndex];
    return currentPlayerId === playerId;
}

/**
 * Check if the game is in a state where a turn timer should be running.
 * Timer should run during bidding and playing phases (not during animations).
 */
export function shouldTimerBeActive(state: SpadesState): boolean {
    return state.phase === "bidding" || state.phase === "playing";
}
