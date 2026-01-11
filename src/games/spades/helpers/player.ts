import { CardPlay, Trick } from "..";
import { Card, Suit } from "../types";
import { SpadesSettings } from "../../../models/Settings";
import { cardBeats } from "./card";

/*─────────────────────────  FOLLOW-SUIT RULE  ──────────────────────────*/
function mustFollowSuit(
    card: Card,
    playerHand: Card[],
    ledSuit: Suit | null
): boolean {
    if (!ledSuit) return true; // first card of trick – any suit allowed
    if (card.suit === ledSuit) return true; // followed
    // Has at least one of the led suit? then illegal to slough
    return !playerHand.some((c) => c.suit === ledSuit);
}

/*─────────────────────────  SPADE BREAK RULE  ──────────────────────────*/
function canLeadSuit(
    card: Card,
    spadesBroken: boolean,
    playerHand: Card[],
    ledSuit: Suit | null
): boolean {
    // non-leader always allowed; check only when trick empty
    if (ledSuit) return true;
    if (card.suit !== Suit.Spades) return true;
    if (spadesBroken) return true;
    // if the player ONLY has spades, permit leading them
    return playerHand.every((c) => c.suit === Suit.Spades);
}

/*─────────────────────────  TRICK WINNER  ──────────────────────────────*/

export function resolveTrick(trick: Trick, settings: SpadesSettings): string {
    const ledSuit = trick.leadSuit || trick.plays[0]?.card.suit;
    const winningPlay = trick.plays.reduce(
        (winner, play) => {
            if (!winner) return play; // first play is always the winner
            if (cardBeats(play.card, winner.card, ledSuit, settings))
                return play;
            return winner;
        },
        null as CardPlay | null
    );
    return winningPlay?.playerId || "";
}

export function canPlayCard(
    card: Card,
    playerHand: Card[],
    trick: Trick,
    spadesBroken: boolean
): boolean {
    if (trick.plays.length === 0) {
        // first play of the trick
        return canLeadSuit(card, spadesBroken, playerHand, trick.leadSuit);
    } else {
        // subsequent plays
        return mustFollowSuit(card, playerHand, trick.leadSuit);
    }
}
