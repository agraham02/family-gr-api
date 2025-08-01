// src/games/spades.ts
import { Room } from "../../models/Room";
import {
    GameModule,
    GameState,
    GameAction,
    GameSettings,
} from "../../services/GameManager";
import { v4 as uuidv4 } from "uuid";
import { Bid, Card, Suit } from "./types";
import {
    buildDeck,
    currentPlayerId,
    dealCardsToPlayers,
    nextPlayerIndex,
    shuffleDeck,
} from "./helpers/card";
import { omitFields } from "../../utils/omitFields";
import { canPlayCard, resolveTrick } from "./helpers/player";
import { User } from "../../models/User";
import { calculateSpadesScores } from "./helpers/score";

const SPADES_NAME = "spades";
const SPADES_DISPLAY_NAME = "Spades";
export const spadesTeamRequirements = {
    numTeams: 2,
    playersPerTeam: 2,
};
const SPADES_TOTAL_PLAYERS =
    spadesTeamRequirements.numTeams * spadesTeamRequirements.playersPerTeam;

const SPADES_METADATA = {
    type: SPADES_NAME,
    displayName: SPADES_DISPLAY_NAME,
    requiresTeams: true,
    minPlayers: SPADES_TOTAL_PLAYERS,
    maxPlayers: SPADES_TOTAL_PLAYERS,
    numTeams: spadesTeamRequirements.numTeams,
    playersPerTeam: spadesTeamRequirements.playersPerTeam,
};

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
    nil?: boolean;
}

export interface CardPlay {
    playerId: string;
    card: Card;
}

export interface Trick {
    leaderId: string;
    plays: CardPlay[];
    leadSuit: Suit | null; // suit of the first card played
    winnerId?: string;
}

type SpadesPhases =
    | "bidding"
    | "playing"
    | "trick-result"
    | "scoring"
    | "round-summary"
    | "finished";

export interface SpadesState extends GameState {
    teams: Record<number, Team>;
    playOrder: string[];
    currentTurnIndex: number;
    dealerIndex: number;

    hands: Record<string, Card[]>;
    handsCounts?: Record<string, number>;
    bids: Record<string, Bid>;

    spadesBroken: boolean;
    currentTrick: Trick | null;
    completedTricks: Trick[];
    phase: SpadesPhases;
    round: number;
    history: string[]; // Action history for debugging
    settings: SpadesSettings;
    winnerTeamId?: number;
    isTie?: boolean;

    lastTrickWinnerId?: string;
    lastTrickWinningCard?: Card;

    roundTrickCounts: Record<string, number>;
    roundTeamScores: Record<number, number>; // scores for each team for the round.
    roundScoreBreakdown: Record<number, any>; // detailed breakdown for each team (e.g., bags, nil, bonuses, penalties).
}

function init(
    room: Room,
    customSettings?: Partial<SpadesSettings>
): SpadesState {
    // Turn players into a object map for easier access
    const players: Record<string, User> = Object.fromEntries(
        room.users.map((user) => [user.id, user])
    );
    const teams: Record<number, Team> = Object.fromEntries(
        room.teams?.map((team, index) => [
            index,
            { players: team, score: 0 },
        ]) || []
    );

    const numTeams = Object.keys(teams).length;
    const playersPerTeam = teams[0]?.players.length || 0;
    const dealerIndex = Math.floor(Math.random() * (playersPerTeam * numTeams));
    const playOrder: string[] = [];
    for (let i = 0; i < playersPerTeam; i++) {
        for (let j = 0; j < numTeams; j++) {
            const playerId = teams[j].players[i];
            if (playerId) playOrder.push(playerId);
        }
    }

    const settings: SpadesSettings = { ...DEFAULT_SETTINGS, ...customSettings };
    const deck = buildDeck();
    const shuffledDeck = shuffleDeck(deck);

    return {
        id: uuidv4(),
        roomId: room.id,
        type: SPADES_NAME,

        players,
        leaderId: room.leaderId ?? playOrder[dealerIndex] ?? playOrder[0],
        teams, // To be filled with team data
        playOrder,
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

        roundTrickCounts: {},
        roundTeamScores: {},
        roundScoreBreakdown: {},
    };
}

function reducer(state: SpadesState, action: GameAction): SpadesState {
    logHistory(state, action);
    switch (action.type) {
        case "PLACE_BID":
            return handlePlaceBid(state, action.userId, action.payload.bid);
        case "PLAY_CARD":
            return handlePlayCard(state, action.userId, action.payload.card);
        case "CONTINUE_AFTER_TRICK_RESULT": {
            // Only process if phase is 'trick-result'
            if (state.phase !== "trick-result") return state;
            // Advance to next trick
            // Find last trick winner
            const lastTrick =
                state.completedTricks[state.completedTricks.length - 1];
            const winnerId = lastTrick?.winnerId;
            // Set currentTurnIndex to winner
            const newCurrentTurnIndex = winnerId
                ? state.playOrder.findIndex((pid) => pid === winnerId)
                : state.currentTurnIndex;
            return {
                ...state,
                phase: "playing",
                currentTurnIndex: newCurrentTurnIndex,
                currentTrick: null, // reset here
                lastTrickWinnerId: undefined,
                lastTrickWinningCard: undefined,
            };
        }
        case "SCORE_ROUND":
            // Example: handle scoring
            return { ...state, phase: "scoring" };
        case "CONTINUE_AFTER_ROUND_SUMMARY": {
            // Only process if phase is 'round-summary'
            if (state.phase !== "round-summary") return state;
            // Advance to next round
            // Advance dealer index
            const nextDealerIndex =
                (state.dealerIndex + 1) % state.playOrder.length;
            // Shuffle and deal new hands
            const deck = buildDeck();
            const shuffledDeck = shuffleDeck(deck);
            const newHandsForNextRound = dealCardsToPlayers(
                shuffledDeck,
                state.players
            );
            // Reset bids, tricks, spadesBroken, etc.
            return {
                ...state,
                hands: newHandsForNextRound,
                bids: {},
                currentTrick: null,
                completedTricks: [],
                spadesBroken: false,
                currentTurnIndex: nextDealerIndex,
                dealerIndex: nextDealerIndex,
                phase: "bidding",
                round: state.round + 1,
                winnerTeamId: undefined,
                isTie: undefined,
                lastTrickWinnerId: undefined,
                lastTrickWinningCard: undefined,
                roundTrickCounts: {},
                roundTeamScores: {},
                roundScoreBreakdown: {},
            };
        }
        default:
            return state;
    }
}

function getState(state: SpadesState): Partial<SpadesState> {
    const publicState = omitFields(state, ["hands"]);
    publicState.handsCounts = Object.fromEntries(
        state.playOrder.map((id) => [id, state.hands[id].length || 0])
    );
    return publicState;
}

function getPlayerState(
    state: SpadesState,
    playerId: string
): Partial<SpadesState> & { hand?: Card[]; localOrdering?: string[] } {
    const idx = state.playOrder.indexOf(playerId);
    const localOrdering = [
        ...state.playOrder.slice(idx),
        ...state.playOrder.slice(0, idx),
    ];

    return {
        hand: state.hands[playerId] || [],
        localOrdering,
    };
}

export const spadesModule: GameModule = {
    init,
    reducer,
    getState,
    getPlayerState,
    metadata: SPADES_METADATA,
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
    if (currentPlayerId(state) !== playerId) {
        throw new Error("Not your turn to place a bid.");
    }
    // Validate player
    if (!state.playOrder.some((pid) => pid === playerId)) {
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
    const allBid = state.playOrder.every((pid) => newBids[pid]);
    // If all bids placed, advance phase
    return {
        ...state,
        bids: newBids,
        currentTurnIndex: nextPlayerIndex(state),
        phase: allBid ? "playing" : state.phase,
    };
}

function handlePlayCard(
    state: SpadesState,
    playerId: string,
    card: Card
): SpadesState {
    // 1. Validate phase
    if (state.phase !== "playing") {
        throw new Error("Cards can only be played during the playing phase.");
    }

    // 2. Validate turn
    if (currentPlayerId(state) !== playerId) {
        throw new Error("Not your turn to play a card.");
    }

    // 3. Validate card is in hand
    const playerHand = state.hands[playerId] || [];
    const cardIdx = playerHand.findIndex(
        (c) => c.suit === card.suit && c.rank === card.rank
    );
    if (cardIdx === -1) {
        throw new Error("Card not in player's hand.");
    }

    // 4. Validate play is legal (follow suit, spades broken, etc.)
    const trick = state.currentTrick || {
        leaderId: playerId,
        plays: [],
        leadSuit: null,
    };
    if (!canPlayCard(card, playerHand, trick, state.spadesBroken)) {
        throw new Error(
            "Illegal card play (must follow suit or spades not broken)."
        );
    }

    // 5. Remove card from hand
    const newHand = [...playerHand];
    newHand.splice(cardIdx, 1);
    const newHands = { ...state.hands, [playerId]: newHand };

    // 6. Add play to trick
    const isFirstPlay = trick.plays.length === 0;
    const leadSuit = isFirstPlay ? card.suit : trick.leadSuit;
    const newTrick: Trick = {
        ...trick,
        plays: [...trick.plays, { playerId, card }],
        leadSuit: leadSuit || null,
    };

    // 7. Update spadesBroken if a spade is played (and not the first trick)
    const spadesBroken =
        state.spadesBroken ||
        (card.suit === "Spades" &&
            !(
                isFirstPlay &&
                card.suit === "Spades" &&
                trick.leadSuit === null
            ));

    // 8. If trick is complete, resolve winner and show result
    let newCurrentTrick: Trick | null = newTrick;
    let newCompletedTricks = state.completedTricks;
    let newCurrentTurnIndex = nextPlayerIndex(state);
    let newPhase: SpadesPhases = state.phase;
    let lastTrickWinnerId: string | undefined = undefined;
    let lastTrickWinningCard: Card | undefined = undefined;
    if (newTrick.plays.length === state.playOrder.length) {
        // Trick complete
        const winnerId = resolveTrick(newTrick);
        newCompletedTricks = [
            ...state.completedTricks,
            { ...newTrick, winnerId },
        ];
        // Do not reset currentTrick here; keep it visible during trick-result phase
        // Find the winning card
        const winningPlay = newTrick.plays.find((p) => p.playerId === winnerId);
        lastTrickWinnerId = winnerId;
        lastTrickWinningCard = winningPlay?.card;
        // Update current turn index to the winner of the trick
        newCurrentTurnIndex = state.playOrder.findIndex(
            (pid) => pid === winnerId
        );
        // If all tricks complete, advance phase
        const allHandsEmpty = Object.values(newHands).every(
            (h) => h.length === 0
        );
        if (allHandsEmpty) {
            // Calculate scores and update team scores
            const scoreResult = calculateSpadesScores({
                ...state,
                hands: newHands,
                completedTricks: newCompletedTricks,
            });
            const { teamScores } = scoreResult;
            // Use scoreResult.scoreBreakdown if available, else fallback to teamScores
            const scoreBreakdown = scoreResult.scoreBreakdown ?? {};
            // Calculate tricks won per player
            const roundTrickCounts: Record<string, number> = {};
            // Initialize all players to 0
            state.playOrder.forEach((playerId) => {
                roundTrickCounts[playerId] = 0;
            });
            newCompletedTricks.forEach((trick) => {
                if (trick.winnerId) {
                    roundTrickCounts[trick.winnerId] += 1;
                }
            });
            // Calculate team scores for the round
            const roundTeamScores: Record<number, number> = {};
            Object.keys(teamScores).forEach((teamId) => {
                roundTeamScores[Number(teamId)] =
                    scoreBreakdown[teamId]?.roundScore ??
                    teamScores[Number(teamId)];
            });
            // Set round summary phase and expose breakdowns
            return {
                ...state,
                hands: newHands,
                currentTrick: null,
                completedTricks: newCompletedTricks,
                spadesBroken,
                currentTurnIndex: newCurrentTurnIndex,
                phase: "round-summary",
                teams: {
                    ...state.teams,
                    ...Object.keys(teamScores).reduce(
                        (acc, teamId) => {
                            acc[Number(teamId)] = {
                                ...state.teams[Number(teamId)],
                                score: teamScores[Number(teamId)],
                            };
                            return acc;
                        },
                        {} as Record<number, Team>
                    ),
                },
                winnerTeamId: undefined,
                isTie: undefined,
                lastTrickWinnerId: undefined,
                lastTrickWinningCard: undefined,
                roundTrickCounts,
                roundTeamScores,
                roundScoreBreakdown: scoreBreakdown,
                // totalTeamScores field deprecated
            };
        }
        // Show trick result before advancing
        return {
            ...state,
            hands: newHands,
            currentTrick: newTrick, // keep visible during trick-result
            completedTricks: newCompletedTricks,
            spadesBroken,
            currentTurnIndex: newCurrentTurnIndex,
            phase: "trick-result",
            lastTrickWinnerId,
            lastTrickWinningCard,
        };
    }

    return {
        ...state,
        hands: newHands,
        currentTrick: newCurrentTrick,
        completedTricks: newCompletedTricks,
        spadesBroken,
        currentTurnIndex: newCurrentTurnIndex,
        phase: newPhase,
        lastTrickWinnerId: undefined,
        lastTrickWinningCard: undefined,
    };
}

function logHistory(state: SpadesState, action: GameAction): void {
    // Log the current game state (for debugging or auditing)
    // Use structured logging here if needed, e.g. logger.info({ state, action });
    state.history.push(
        `Action: ${action.type}, Player: ${action.userId}, Payload: ${JSON.stringify(action.payload)}`
    );
}
