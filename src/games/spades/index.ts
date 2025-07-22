// src/games/spades.ts
import { Room } from "../../models/Room";
import {
    GameModule,
    GameState,
    GameAction,
    GameSettings,
} from "../../services/GameManager";
import { v4 as uuidv4 } from "uuid";
import { Bid, Card } from "./types";
import { buildDeck, dealCardsToPlayers, shuffleDeck } from "./helpers/card";
import { omitFields } from "../../utils/omitFields";

const SPADES_NAME = "spades";

interface InitSeed {
    gameId: string; // unique game identifier
    roster: string[]; // clockwise seat order, length 4
    dealerIndex: number; // seat who shuffled & offered cut
    // settings?: Partial<SpadesSettings>;
    rng?: () => number; // injectable for deterministic tests
}

export interface SpadesSettings extends GameSettings {
    allowNil: boolean;
    bagsPenalty: number;
}

const DEFAULT_SETTINGS: SpadesSettings = {
    allowNil: true,
    bagsPenalty: -100,
    winTarget: 500,
};

interface Team {
    players: string[];
    score: number;
}

export interface CardPlay {
    playerId: string;
    card: Card;
}

export interface Trick {
    leaderId: string;
    plays: CardPlay[];
    winnerId?: string;
}

export interface SpadesState extends GameState {
    players: string[];
    teams: Record<number, Team>;
    playOrder: number[];
    currentTurnIndex: number;
    dealerIndex: number;

    hands: Record<string, Card[]>;
    bids: Record<string, Bid>;

    spadesBroken: boolean;
    currentTrick: Trick | null;
    completedTricks: Trick[];
    phase: "bidding" | "playing" | "scoring" | "ended";
    round: number;
    history: string[]; // Action history for debugging
    settings: SpadesSettings;
    // Add more spades-specific state as needed
}

function init(
    room: Room,
    customSettings?: Partial<SpadesSettings>
): SpadesState {
    const players = room.users.map((u) => u.id);
    const settings: SpadesSettings = { ...DEFAULT_SETTINGS, ...customSettings };
    const deck = buildDeck();
    const shuffledDeck = shuffleDeck(deck);
    const dealerIndex = Math.floor(Math.random() * players.length);

    return {
        id: uuidv4(),
        roomId: room.id,
        type: SPADES_NAME,

        players,
        teams: {},
        playOrder: [],
        dealerIndex,
        currentTurnIndex: dealerIndex,

        hands: dealCardsToPlayers(shuffledDeck, players),
        bids: {},

        spadesBroken: false,
        currentTrick: null,
        completedTricks: [],
        phase: "bidding",
        round: 1,
        settings,
        history: [],
    };
}

function reducer(state: SpadesState, action: GameAction): SpadesState {
    logHistory(state, action);
    switch (action.type) {
        case "DEAL_CARDS":
            // Example: deal cards logic
            return { ...state, hands: action.payload.hands, phase: "bidding" };
        case "PLACE_BID":
            // Example: handle bidding
            return handlePlaceBid(
                state,
                action.payload.playerId,
                action.payload.bid
            );
        case "PLAY_CARD":
            // Example: handle playing a card
            return { ...state };
        case "SCORE_ROUND":
            // Example: handle scoring
            return { ...state, phase: "scoring" };
        default:
            return state;
    }
}

function getState(state: SpadesState): Partial<SpadesState> {
    return omitFields(state, ["hands"]);
}

export const spadesModule: GameModule = {
    init,
    reducer,
    getState,
};

/**
 * Handles placing a bid for a player.
 * @param state Current SpadesState
 * @param playerId The player placing the bid
 * @param bid The bid object (type Bid)
 * @returns Updated SpadesState
 */
function handlePlaceBid(
    state: SpadesState,
    playerId: string,
    bid: Bid
): SpadesState {
    // Validate phase
    if (state.phase !== "bidding") {
        throw new Error("Bids can only be placed during the bidding phase.");
    }
    if (state.players[state.currentTurnIndex] !== playerId) {
        throw new Error("Not your turn to place a bid.");
    }
    // Validate player
    if (!state.players.includes(playerId)) {
        throw new Error("Invalid player ID for this game.");
    }
    // Validate bid (basic: must be a number, >= 0)
    if (typeof bid.amount !== "number" || bid.amount < 0) {
        throw new Error("Bid amount must be a non-negative number.");
    }
    // Prevent duplicate bids
    if (state.bids[playerId]) {
        throw new Error("Player has already placed a bid.");
    }

    // Record bid
    const newBids = { ...state.bids, [playerId]: bid };
    // Check if all players have bid
    const allBid = state.players.every((pid) => newBids[pid]);
    // If all bids placed, advance phase
    return {
        ...state,
        bids: newBids,
        currentTurnIndex: (state.currentTurnIndex + 1) % state.players.length,
        phase: allBid ? "playing" : state.phase,
    };
}

function logHistory(state: SpadesState, action: GameAction): void {
    // Log the current game state (for debugging or auditing)
    console.log("Game State:", JSON.stringify(state, null, 2));
    console.log("Action:", JSON.stringify(action, null, 2));
    state.history.push(
        `Action: ${action.type}, Player: ${action.userId}, Payload: ${JSON.stringify(action.payload)}`
    );
}
