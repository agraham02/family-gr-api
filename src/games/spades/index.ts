// src/games/spades.ts
import { Room } from "../../models/Room";
import { GameModule, GameState, GameAction } from "../../services/GameManager";
import {
    SpadesSettings,
    DEFAULT_SPADES_SETTINGS,
    SPADES_SETTINGS_DEFINITIONS,
} from "../../models/Settings";
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
import {
    handlePlayerReconnect,
    handlePlayerDisconnect,
    checkAllPlayersConnected,
} from "../shared";

// Export auto-action helpers for TurnTimerService
export {
    getAutoBid,
    getAutoPlayCard,
    shouldTimerBeActive,
} from "./helpers/autoAction";

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
    description:
        "A trick-taking card game played in teams of two. Bid on how many tricks you'll win, then play to make your bid!",
    requiresTeams: true,
    minPlayers: SPADES_TOTAL_PLAYERS,
    maxPlayers: SPADES_TOTAL_PLAYERS,
    numTeams: spadesTeamRequirements.numTeams,
    playersPerTeam: spadesTeamRequirements.playersPerTeam,
    settingsDefinitions: SPADES_SETTINGS_DEFINITIONS,
    defaultSettings: DEFAULT_SPADES_SETTINGS,
};

// Re-export SpadesSettings for backwards compatibility
export type { SpadesSettings } from "../../models/Settings";

interface Team {
    players: string[];
    score: number;
    accumulatedBags: number;
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
    teamEligibleForBlind: Record<number, boolean>; // which teams are eligible for blind bids (100+ behind)

    /** ISO timestamp when the current turn started (for turn timer) */
    turnStartedAt?: string;
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
            { players: team, score: 0, accumulatedBags: 0 },
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

    const settings: SpadesSettings = {
        ...DEFAULT_SPADES_SETTINGS,
        ...customSettings,
    };
    const deck = buildDeck(settings.jokersEnabled);
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

        hands: dealCardsToPlayers(shuffledDeck, players, settings),
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
        // Initialize teamEligibleForBlind - on first round, all teams start at 0 so no one is eligible
        // This is recalculated at the start of each subsequent round
        teamEligibleForBlind: Object.fromEntries(
            Object.keys(teams).map((teamId) => [Number(teamId), false])
        ),

        // Initialize turn timer
        turnStartedAt: new Date().toISOString(),
    };
}

/**
 * Calculate which teams are eligible for blind bids (100+ points behind leader)
 */
function calculateTeamEligibility(
    teams: Record<number, Team>
): Record<number, boolean> {
    const teamScores = Object.entries(teams).map(([teamId, team]) => ({
        teamId: Number(teamId),
        score: team.score,
    }));

    const maxScore = Math.max(...teamScores.map((t) => t.score), 0);

    const eligibility: Record<number, boolean> = {};
    teamScores.forEach(({ teamId, score }) => {
        eligibility[teamId] = maxScore - score >= 100;
    });

    return eligibility;
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
                turnStartedAt: new Date().toISOString(),
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
            const deck = buildDeck(state.settings.jokersEnabled);
            const shuffledDeck = shuffleDeck(deck);
            const newHandsForNextRound = dealCardsToPlayers(
                shuffledDeck,
                state.players,
                state.settings
            );
            // Calculate team eligibility for blind bids (100+ points behind)
            const teamEligibleForBlind = calculateTeamEligibility(state.teams);

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
                teamEligibleForBlind,
                turnStartedAt: new Date().toISOString(),
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
    checkMinimumPlayers,
    handlePlayerReconnect,
    handlePlayerDisconnect,
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
        throw new Error("You're not in this game.");
    }
    // Check if player is connected
    if (state.players[playerId]?.isConnected === false) {
        throw new Error("You've been disconnected. Please refresh to rejoin.");
    }
    // Validate bid (must be a number between 0 and 13, as there are only 13 tricks possible)
    if (typeof bid.amount !== "number" || bid.amount < 0 || bid.amount > 13) {
        throw new Error("Bid must be between 0 and 13 tricks.");
    }

    // Find player's team
    const playerTeam = Object.entries(state.teams).find(([_, team]) =>
        team.players.includes(playerId)
    );
    const playerTeamId = playerTeam ? Number(playerTeam[0]) : undefined;

    if (playerTeamId === undefined) {
        throw new Error("You're not on a team.");
    }

    // Validate bid type
    if (bid.type === "nil") {
        // Nil bids must have amount of 0
        if (bid.amount !== 0) {
            throw new Error("Nil bid must have amount of 0.");
        }
        // Nil must be enabled in settings
        if (!state.settings.allowNil) {
            throw new Error("Nil bids are not allowed in this game.");
        }
        // Nil cannot be blind (that's blind-nil)
        if (bid.isBlind) {
            throw new Error("Use blind-nil bid type for blind nil bids.");
        }
    } else if (bid.type === "blind-nil") {
        // Blind nil bids must have amount of 0
        if (bid.amount !== 0) {
            throw new Error("Blind nil bid must have amount of 0.");
        }
        // Blind nil must be enabled in settings
        if (!state.settings.blindNilEnabled) {
            throw new Error("Blind nil bids are not allowed in this game.");
        }
        // Blind nil requires allowNil as well
        if (!state.settings.allowNil) {
            throw new Error("Blind nil requires nil to be enabled.");
        }
        // Team must be eligible (100+ behind)
        if (!state.teamEligibleForBlind[playerTeamId]) {
            throw new Error(
                "Your team is not eligible for blind nil bids (must be 100+ points behind)."
            );
        }
        // Must be marked as blind
        if (!bid.isBlind) {
            throw new Error("Blind nil bid must be marked as blind.");
        }
    } else if (bid.type === "blind") {
        // Blind bids must have minimum amount of 4
        if (bid.amount < 4) {
            throw new Error("Blind bids must be at least 4 tricks.");
        }
        // Blind bids must be enabled in settings
        if (!state.settings.blindBidEnabled) {
            throw new Error("Blind bids are not allowed in this game.");
        }
        // Team must be eligible (100+ behind)
        if (!state.teamEligibleForBlind[playerTeamId]) {
            throw new Error(
                "Your team is not eligible for blind bids (must be 100+ points behind)."
            );
        }
        // Must be marked as blind
        if (!bid.isBlind) {
            throw new Error("Blind bid must be marked as blind.");
        }
    } else if (bid.type === "normal") {
        // Normal bids must have amount > 0 (zero bids must use nil type)
        if (bid.amount === 0) {
            throw new Error(
                "Normal bids must be at least 1 trick. Use Nil bid for zero tricks."
            );
        }
        // Normal bids should not be marked as blind
        if (bid.isBlind) {
            throw new Error("Normal bids cannot be marked as blind.");
        }
    } else {
        throw new Error(`Invalid bid type: ${bid.type}`);
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
        // Reset turn timer for next player
        turnStartedAt: new Date().toISOString(),
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

    // 3. Check if player is connected
    if (state.players[playerId]?.isConnected === false) {
        throw new Error("Player is disconnected and cannot play a card.");
    }

    // 4. Validate card is in hand
    const playerHand = state.hands[playerId] || [];
    const cardIdx = playerHand.findIndex(
        (c) => c.suit === card.suit && c.rank === card.rank
    );
    if (cardIdx === -1) {
        throw new Error("Card not in player's hand.");
    }

    // 5. Validate play is legal (follow suit, spades broken, etc.)
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

    // 6. Remove card from hand
    const newHand = [...playerHand];
    newHand.splice(cardIdx, 1);
    const newHands = { ...state.hands, [playerId]: newHand };

    // 7. Add play to trick
    const isFirstPlay = trick.plays.length === 0;
    const leadSuit = isFirstPlay ? card.suit : trick.leadSuit;
    const newTrick: Trick = {
        ...trick,
        plays: [...trick.plays, { playerId, card }],
        leadSuit: leadSuit || null,
    };

    // 8. Update spadesBroken if a spade is played (and not the first trick)
    const spadesBroken =
        state.spadesBroken ||
        (card.suit === "Spades" &&
            !(
                isFirstPlay &&
                card.suit === "Spades" &&
                trick.leadSuit === null
            ));

    // 9. If trick is complete, resolve winner and show result
    const newCurrentTrick: Trick | null = newTrick;
    let newCompletedTricks = state.completedTricks;
    let newCurrentTurnIndex = nextPlayerIndex(state);
    const newPhase: SpadesPhases = state.phase;
    let lastTrickWinnerId: string | undefined = undefined;
    let lastTrickWinningCard: Card | undefined = undefined;
    if (newTrick.plays.length === state.playOrder.length) {
        // Trick complete
        const winnerId = resolveTrick(newTrick, state.settings);
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

        // Calculate tricks won per player (for live display during round)
        const roundTrickCounts: Record<string, number> = {};
        state.playOrder.forEach((playerId) => {
            roundTrickCounts[playerId] = 0;
        });
        newCompletedTricks.forEach((trick) => {
            if (trick.winnerId) {
                roundTrickCounts[trick.winnerId] += 1;
            }
        });

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

            // Calculate team scores for the round
            const roundTeamScores: Record<number, number> = {};
            Object.keys(teamScores).forEach((teamId) => {
                const numericTeamId = Number(teamId);
                roundTeamScores[numericTeamId] =
                    scoreBreakdown[numericTeamId]?.roundScore ??
                    teamScores[numericTeamId];
            });

            // Check for win condition - has any team reached winTarget?
            const winTarget = state.settings.winTarget;
            const teamsAtOrAboveTarget = Object.entries(teamScores)
                .filter(([, score]) => score >= winTarget)
                .map(([teamId, score]) => ({ teamId: Number(teamId), score }));

            let finalPhase: SpadesPhases = "round-summary";
            let winnerTeamId: number | undefined = undefined;
            let isTie: boolean | undefined = undefined;

            if (teamsAtOrAboveTarget.length > 0) {
                // At least one team has reached the win target
                if (teamsAtOrAboveTarget.length === 1) {
                    // Clear winner
                    finalPhase = "finished";
                    winnerTeamId = teamsAtOrAboveTarget[0].teamId;
                } else {
                    // Multiple teams at or above target - check for tie
                    const maxScore = Math.max(
                        ...teamsAtOrAboveTarget.map((t) => t.score)
                    );
                    const teamsWithMaxScore = teamsAtOrAboveTarget.filter(
                        (t) => t.score === maxScore
                    );

                    if (teamsWithMaxScore.length === 1) {
                        // Higher score wins
                        finalPhase = "finished";
                        winnerTeamId = teamsWithMaxScore[0].teamId;
                    } else {
                        // Exact tie - both teams have same score at or above target
                        finalPhase = "finished";
                        isTie = true;
                    }
                }
            }

            // Set round summary phase and expose breakdowns
            // Note: turnStartedAt is NOT set here - timer starts after CONTINUE_AFTER_ROUND_SUMMARY
            return {
                ...state,
                hands: newHands,
                currentTrick: null,
                completedTricks: newCompletedTricks,
                spadesBroken,
                currentTurnIndex: newCurrentTurnIndex,
                phase: finalPhase,
                teams: {
                    ...state.teams,
                    ...Object.keys(teamScores).reduce(
                        (acc, teamId) => {
                            const numericTeamId = Number(teamId);
                            const currentBags =
                                state.teams[numericTeamId].accumulatedBags;
                            const newBags =
                                scoreResult.bags[numericTeamId] || 0;
                            let updatedAccumulatedBags = currentBags + newBags;

                            // If bag penalty was applied (10+ bags), reset to remainder
                            if (updatedAccumulatedBags >= 10) {
                                updatedAccumulatedBags =
                                    updatedAccumulatedBags % 10;
                            }

                            acc[numericTeamId] = {
                                ...state.teams[numericTeamId],
                                score: teamScores[numericTeamId],
                                accumulatedBags: updatedAccumulatedBags,
                            };
                            return acc;
                        },
                        {} as Record<number, Team>
                    ),
                },
                winnerTeamId,
                isTie,
                lastTrickWinnerId: undefined,
                lastTrickWinningCard: undefined,
                roundTrickCounts,
                roundTeamScores,
                roundScoreBreakdown: scoreBreakdown,
            };
        }
        // Show trick result before advancing
        // Note: turnStartedAt is NOT set here - timer starts after CONTINUE_AFTER_TRICK_RESULT
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
            roundTrickCounts, // Include live trick counts for display
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
        // Reset turn timer for next player
        turnStartedAt: new Date().toISOString(),
    };
}

function logHistory(state: SpadesState, action: GameAction): void {
    // Log the current game state (for debugging or auditing)
    // Use structured logging here if needed, e.g. logger.info({ state, action });
    state.history.push(
        `Action: ${action.type}, Player: ${action.userId}, Payload: ${JSON.stringify(action.payload)}`
    );
}

/**
 * Check if the game has minimum players connected to continue.
 * For Spades, all 4 players must be connected to play.
 */
function checkMinimumPlayers(state: SpadesState): boolean {
    return checkAllPlayersConnected(state, SPADES_TOTAL_PLAYERS);
}
