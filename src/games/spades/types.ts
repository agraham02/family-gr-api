export enum Suit {
    Hearts = "Hearts",
    Diamonds = "Diamonds",
    Clubs = "Clubs",
    Spades = "Spades",
}

export enum Rank {
    Ace = "A",
    Two = "2",
    Three = "3",
    Four = "4",
    Five = "5",
    Six = "6",
    Seven = "7",
    Eight = "8",
    Nine = "9",
    Ten = "10",
    Jack = "J",
    Queen = "Q",
    King = "K",
}

export interface Card {
    rank: Rank;
    suit: Suit;
}

export type SpadesPhase = "bidding" | "playing" | "scoring" | "finished";
export type BidType = "normal" | "nil" | "blind" | "blind-nil";

export interface Bid {
    amount: number;
    type: BidType;
    isBlind: boolean;
}

export interface PlaceBidAction {
    type: "PLACE_BID";
    playerId: string;
    bid: Bid;
}

export interface PlayCardAction {
    type: "PLAY_CARD";
    playerId: string;
    card: Card;
}
