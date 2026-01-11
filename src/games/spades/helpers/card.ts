/* ------------------------------------------------------------------------
   Card helpers – no game-state, no I/O
   --------------------------------------------------------------------- */

import { SpadesState } from "..";
import { User } from "../../../models/User";
import { SpadesSettings } from "../../../models/Settings";
import { GamePlayers } from "../../../services/GameManager";
import { shuffle } from "../../shared";
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
export function buildDeck(jokersEnabled: boolean = false): Card[] {
    if (!jokersEnabled) {
        // Standard 52-card deck
        return SUITS.flatMap((suit) =>
            RANK_ORDER.map((rank) => ({ suit, rank }))
        );
    }

    // With jokers: Remove 2♣ and 2♦, add Big Joker and Little Joker
    const standardRanks = RANK_ORDER.filter((rank) => rank !== Rank.Two);
    const cards: Card[] = [];

    for (const suit of SUITS) {
        if (suit === Suit.Clubs || suit === Suit.Diamonds) {
            // Skip Two for Clubs and Diamonds
            for (const rank of standardRanks) {
                cards.push({ suit, rank });
            }
        } else {
            // Include all ranks for Hearts and Spades
            for (const rank of RANK_ORDER) {
                cards.push({ suit, rank });
            }
        }
    }

    // Add jokers (treated as spades for suit purposes)
    cards.push({ rank: Rank.LittleJoker, suit: Suit.Spades });
    cards.push({ rank: Rank.BigJoker, suit: Suit.Spades });

    return cards;
}

/**
 * Shuffle a deck of cards using shared Fisher-Yates implementation.
 */
export function shuffleDeck(
    deck: Card[],
    rng: () => number = Math.random
): Card[] {
    return shuffle(deck, rng);
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

/**
 * Get numerical rank value for a card, with settings affecting hierarchy:
 * - Jokers (if enabled): Big Joker (highest) > Little Joker
 * - Deuce of Spades High (if enabled): 2♠ ranks above Ace but below jokers
 * - Standard: Ace (highest) > King > Queen > ... > 3 > 2 (lowest)
 */
function getCardRankValue(card: Card, settings: SpadesSettings): number {
    const { jokersEnabled, deuceOfSpadesHigh } = settings;

    // Big Joker is always highest if jokers enabled
    if (jokersEnabled && card.rank === Rank.BigJoker) return 1000;

    // Little Joker is second highest if jokers enabled
    if (jokersEnabled && card.rank === Rank.LittleJoker) return 999;

    // Deuce of Spades gets special treatment if deuceOfSpadesHigh enabled
    if (
        deuceOfSpadesHigh &&
        card.rank === Rank.Two &&
        card.suit === Suit.Spades
    ) {
        return 998; // Above Ace, below jokers
    }

    // Standard rank order
    return RANK_ORDER.indexOf(card.rank);
}

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

/**
 * True if `a` beats `b` given the led suit (spades trump).
 * Jokers (if enabled) always beat everything.
 * Deuce of Spades (if deuceOfSpadesHigh) ranks above Ace but below jokers.
 */
export function cardBeats(
    a: Card,
    b: Card,
    led: Suit,
    settings: SpadesSettings
): boolean {
    const { jokersEnabled } = settings;

    // Jokers always beat non-jokers
    if (jokersEnabled) {
        const aIsJoker =
            a.rank === Rank.BigJoker || a.rank === Rank.LittleJoker;
        const bIsJoker =
            b.rank === Rank.BigJoker || b.rank === Rank.LittleJoker;

        if (aIsJoker && !bIsJoker) return true;
        if (bIsJoker && !aIsJoker) return false;

        // Both are jokers: compare rank values
        if (aIsJoker && bIsJoker) {
            return (
                getCardRankValue(a, settings) > getCardRankValue(b, settings)
            );
        }
    }

    // Both same suit: compare rank values
    if (a.suit === b.suit) {
        return getCardRankValue(a, settings) > getCardRankValue(b, settings);
    }

    // Spades trump non-spades
    if (a.suit === Suit.Spades && b.suit !== Suit.Spades) return true;
    if (b.suit === Suit.Spades && a.suit !== Suit.Spades) return false;

    // Neither is spade, higher if matches led suit
    return a.suit === led;
}
