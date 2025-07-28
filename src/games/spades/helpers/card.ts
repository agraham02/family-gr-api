/* ------------------------------------------------------------------------
   Card helpers – no game-state, no I/O
   --------------------------------------------------------------------- */

import { SpadesState } from "..";
import { User } from "../../../models/User";
import { GamePlayers } from "../../../services/GameManager";
import { Card, Rank, Suit } from "../types";

/* ––––––––––––––––––––– CONSTANTS ––––––––––––––––––––– */
export const SUITS: Suit[] = [
    Suit.Spades,
    Suit.Hearts,
    Suit.Clubs,
    Suit.Diamonds,
];
export const RANK_ORDER: Rank[] = [
    Rank.Two,
    Rank.Three,
    Rank.Four,
    Rank.Five,
    Rank.Six,
    Rank.Seven,
    Rank.Eight,
    Rank.Nine,
    Rank.Ten,
    Rank.Jack,
    Rank.Queen,
    Rank.King,
    Rank.Ace,
];

/* ––––––––––––––––– DECK BUILDERS –––––––––––––––––––– */
export function buildDeck(): Card[] {
    return SUITS.flatMap((suit) => RANK_ORDER.map((rank) => ({ suit, rank })));
}

/**
 * Fisher–Yates shuffle (unbiased, O(n)).
 * Keep randomness *only* here so the rest of the engine is replayable.
 */
export function shuffleDeck(
    deck: Card[],
    rng: () => number = Math.random
): Card[] {
    const copy = [...deck];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/**
 * Deal 52 cards round-robin across the 4 seats.
 * Pre-condition: `seats.length === 4`.
 */
export function dealCardsToPlayers(
    deck: Card[],
    seats: GamePlayers
): Record<string, Card[]> {
    const seatIds = Object.keys(seats);
    if (seatIds.length !== 4) throw new Error("Spades needs 4 players");

    const hands: Record<string, Card[]> = seatIds.reduce(
        (acc, id) => {
            acc[id] = [];
            return acc;
        },
        {} as Record<string, Card[]>
    );

    deck.forEach((card, idx) => {
        const seatId = seatIds[idx % 4];
        hands[seatId].push(card);
    });

    // Sort each hand for consistent ordering
    for (const seatId of seatIds) {
        hands[seatId] = sortHand(hands[seatId]);
    }

    return hands;
}

function sortHand(hand: Card[]): Card[] {
    return hand.slice().sort((a, b) => {
        const suitComparison = SUITS.indexOf(b.suit) - SUITS.indexOf(a.suit);
        if (suitComparison !== 0) return suitComparison;
        return RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
    });
}

/* ––––––––––––––––  SMALL UTILITIES –––––––––––––––––– */

/** Clockwise successor */
export function nextPlayerIndex(state: SpadesState): number {
    return (state.currentTurnIndex + 1) % state.playOrder.length;
}

export function nextPlayerId(state: SpadesState, id: string): string {
    return state.playOrder[nextPlayerIndex(state)];
}

export function currentPlayerId(state: SpadesState): string {
    return state.playOrder[state.currentTurnIndex];
}

/** True if `a` beats `b` given the led suit (spades trump). */
export function cardBeats(a: Card, b: Card, led: Suit): boolean {
    if (a.suit === b.suit)
        return RANK_ORDER.indexOf(a.rank) > RANK_ORDER.indexOf(b.rank);
    if (a.suit === Suit.Spades && b.suit !== Suit.Spades) return true;
    if (b.suit === Suit.Spades && a.suit !== Suit.Spades) return false;
    return a.suit === led; // neither is spade, higher if matches led suit
}
