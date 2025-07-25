/* ------------------------------------------------------------------------
   Card helpers – no game-state, no I/O
   --------------------------------------------------------------------- */

import { User } from "../../../models/User";
import { Card, Rank, Suit } from "../types";

/* ––––––––––––––––––––– CONSTANTS ––––––––––––––––––––– */
export const SUITS: Suit[] = [
    Suit.Spades,
    Suit.Hearts,
    Suit.Diamonds,
    Suit.Clubs,
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
    seats: User[]
): Record<string, Card[]> {
    if (seats.length !== 4) throw new Error("Spades needs 4 seats");

    const hands: Record<string, Card[]> = Object.fromEntries(
        seats.map((user) => [user.id, []])
    );

    deck.forEach((card, idx) => {
        const seat = seats[idx % 4];
        hands[seat.id].push(card);
    });

    return hands;
}

/* ––––––––––––––––  SMALL UTILITIES –––––––––––––––––– */

/** Clockwise successor */
export function nextPlayerIndex(order: string[], currentIndex: number): number {
    return (currentIndex + 1) % order.length;
}

export function nextPlayer(order: string[], id: string): string {
    const idx = order.indexOf(id);
    return order[nextPlayerIndex(order, idx)];
}

/** True if `a` beats `b` given the led suit (spades trump). */
export function cardBeats(a: Card, b: Card, led: Suit): boolean {
    if (a.suit === b.suit)
        return RANK_ORDER.indexOf(a.rank) > RANK_ORDER.indexOf(b.rank);
    if (a.suit === Suit.Spades && b.suit !== Suit.Spades) return true;
    if (b.suit === Suit.Spades && a.suit !== Suit.Spades) return false;
    return a.suit === led; // neither is spade, higher if matches led suit
}
