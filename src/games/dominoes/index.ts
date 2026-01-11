// src/games/dominoes/index.ts

import { Room } from "../../models/Room";
import { GameModule, GameState, GameAction } from "../../services/GameManager";
import {
    DominoesSettings,
    DEFAULT_DOMINOES_SETTINGS,
    DOMINOES_SETTINGS_DEFINITIONS,
} from "../../models/Settings";
import { v4 as uuidv4 } from "uuid";
import { Tile, DominoesPhase } from "./types";
import {
    buildDominoSet,
    dealTilesToPlayers,
    findPlayerWithHighestDouble,
    shuffleTiles,
} from "./helpers/tile";
import { omitFields } from "../../utils/omitFields";
import { User } from "../../models/User";
import {
    BoardState,
    canPlaceTile,
    hasLegalMove,
    initializeBoard,
    placeTileOnBoard,
} from "./helpers/board";
import { calculateRoundScores, checkWinCondition } from "./helpers/score";
import {
    handlePlayerReconnect,
    handlePlayerDisconnect,
    checkAllPlayersConnected,
} from "../shared";

const DOMINOES_NAME = "dominoes";
const DOMINOES_DISPLAY_NAME = "Dominoes";
const DOMINOES_TOTAL_PLAYERS = 4;

const DOMINOES_METADATA = {
    type: DOMINOES_NAME,
    displayName: DOMINOES_DISPLAY_NAME,
    description:
        "Classic Caribbean-style dominoes. Be the first to play all your tiles or have the lowest pip count when blocked!",
    requiresTeams: false, // Individual play
    minPlayers: DOMINOES_TOTAL_PLAYERS,
    maxPlayers: DOMINOES_TOTAL_PLAYERS,
    settingsDefinitions: DOMINOES_SETTINGS_DEFINITIONS,
    defaultSettings: DEFAULT_DOMINOES_SETTINGS,
};

// Re-export DominoesSettings for backwards compatibility
export type { DominoesSettings } from "../../models/Settings";

export interface DominoesState extends GameState {
    playOrder: string[];
    currentTurnIndex: number;
    startingPlayerIndex: number; // Player who started the current round

    hands: Record<string, Tile[]>;
    handsCounts?: Record<string, number>; // For public state
    board: BoardState;

    phase: DominoesPhase;
    round: number;
    consecutivePasses: number; // Track consecutive passes to detect blocked game

    playerScores: Record<string, number>; // Individual scores
    roundPipCounts?: Record<string, number>; // Pip counts at end of round
    roundWinner?: string | null; // Winner of the current round
    isRoundTie?: boolean; // True if round ended in a tie (blocked game, multiple lowest pip counts)

    gameWinner?: string; // Overall game winner
    history: string[]; // Action history for debugging
    settings: DominoesSettings;
}

function init(
    room: Room,
    customSettings?: Partial<DominoesSettings>
): DominoesState {
    // Turn players into an object map for easier access
    const players: Record<string, User> = Object.fromEntries(
        room.users.map((user) => [user.id, user])
    );

    const playOrder = room.users.map((user) => user.id);
    const settings: DominoesSettings = {
        ...DEFAULT_DOMINOES_SETTINGS,
        ...customSettings,
    };

    // Generate and shuffle dominoes
    const dominoSet = buildDominoSet();
    const shuffledDominoes = shuffleTiles(dominoSet);

    // Deal tiles to players
    const hands = dealTilesToPlayers(shuffledDominoes, players);

    // Determine starting player (player with highest double)
    // If no player has a double, start with first player
    const startingPlayerId = findPlayerWithHighestDouble(hands);
    const startingPlayerIndex = startingPlayerId
        ? playOrder.indexOf(startingPlayerId)
        : 0; // Standard rule: first player starts if no doubles exist

    // Initialize player scores
    const playerScores: Record<string, number> = {};
    playOrder.forEach((playerId) => {
        playerScores[playerId] = 0;
    });

    return {
        id: uuidv4(),
        roomId: room.id,
        type: DOMINOES_NAME,

        players,
        leaderId: room.leaderId ?? playOrder[0],
        playOrder,
        currentTurnIndex: startingPlayerIndex,
        startingPlayerIndex,

        hands,
        board: initializeBoard(),

        phase: "playing",
        round: 1,
        consecutivePasses: 0,

        playerScores,
        settings,
        history: [],
    };
}

function reducer(state: DominoesState, action: GameAction): DominoesState {
    logHistory(state, action);

    switch (action.type) {
        case "PLACE_TILE":
            return handlePlaceTile(
                state,
                action.userId,
                action.payload.tile,
                action.payload.side
            );
        case "PASS":
            return handlePass(state, action.userId);
        case "CONTINUE_AFTER_ROUND_SUMMARY":
            return startNextRound(state);
        default:
            return state;
    }
}

function getState(state: DominoesState): Partial<DominoesState> {
    const publicState = omitFields(state, ["hands"]);
    publicState.handsCounts = Object.fromEntries(
        state.playOrder.map((id) => [id, state.hands[id].length || 0])
    );
    return publicState;
}

function getPlayerState(
    state: DominoesState,
    playerId: string
): Partial<DominoesState> & { hand?: Tile[]; localOrdering?: string[] } {
    // Create a local ordering array starting from the current player's perspective
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

export const dominoesModule: GameModule = {
    init,
    reducer,
    getState,
    getPlayerState,
    checkMinimumPlayers,
    handlePlayerReconnect,
    handlePlayerDisconnect,
    metadata: DOMINOES_METADATA,
};

/**
 * Handle placing a tile on the board
 */
function handlePlaceTile(
    state: DominoesState,
    playerId: string,
    tile: Tile,
    side: "left" | "right"
): DominoesState {
    // Validate phase
    if (state.phase !== "playing") {
        throw new Error("Tiles can only be placed during the playing phase.");
    }

    // Validate turn
    if (currentPlayerId(state) !== playerId) {
        throw new Error("Not your turn to place a tile.");
    }

    // Check if player is connected
    if (state.players[playerId]?.isConnected === false) {
        throw new Error("Player is disconnected and cannot place a tile.");
    }

    // Validate tile is in hand
    const playerHand = state.hands[playerId] || [];
    const tileIdx = playerHand.findIndex((t) => t.id === tile.id);
    if (tileIdx === -1) {
        throw new Error("Tile not in player's hand.");
    }

    // Validate the move is legal
    if (!canPlaceTile(tile, state.board, side)) {
        throw new Error("Tile cannot be placed on that side of the board.");
    }

    // Remove tile from hand
    const newHand = [...playerHand];
    newHand.splice(tileIdx, 1);
    const newHands = { ...state.hands, [playerId]: newHand };

    // Place tile on board
    const newBoard = placeTileOnBoard(tile, state.board, side);

    // Reset consecutive passes since a tile was played
    const consecutivePasses = 0;

    // Check if player won the round (hand is empty)
    if (newHand.length === 0) {
        return endRound(
            {
                ...state,
                hands: newHands,
                board: newBoard,
                consecutivePasses,
            },
            playerId
        );
    }

    // Move to next player
    const nextTurnIndex = (state.currentTurnIndex + 1) % state.playOrder.length;

    return {
        ...state,
        hands: newHands,
        board: newBoard,
        currentTurnIndex: nextTurnIndex,
        consecutivePasses,
    };
}

/**
 * Handle a player passing their turn
 */
function handlePass(state: DominoesState, playerId: string): DominoesState {
    // Validate phase
    if (state.phase !== "playing") {
        throw new Error("Can only pass during the playing phase.");
    }

    // Validate turn
    if (currentPlayerId(state) !== playerId) {
        throw new Error("Not your turn to pass.");
    }

    // Check if player is connected
    if (state.players[playerId]?.isConnected === false) {
        throw new Error("Player is disconnected and cannot pass.");
    }

    // Verify player actually cannot play (has no legal moves)
    const playerHand = state.hands[playerId] || [];
    if (hasLegalMove(playerHand, state.board)) {
        throw new Error("Cannot pass when you have a legal move.");
    }

    // Increment consecutive passes
    const consecutivePasses = state.consecutivePasses + 1;

    // If all 4 players have passed consecutively, the game is blocked
    if (consecutivePasses >= 4) {
        return endRound(
            {
                ...state,
                consecutivePasses,
            },
            null // No clear winner, will determine based on lowest pip count
        );
    }

    // Move to next player
    const nextTurnIndex = (state.currentTurnIndex + 1) % state.playOrder.length;

    return {
        ...state,
        currentTurnIndex: nextTurnIndex,
        consecutivePasses,
    };
}

/**
 * End the current round and calculate scores
 */
function endRound(
    state: DominoesState,
    winnerId: string | null
): DominoesState {
    const { scores, pipCounts, roundWinner, isTie } = calculateRoundScores(
        state.hands,
        state.playerScores,
        winnerId
    );

    // Check if anyone has reached the win target
    const gameWinner =
        checkWinCondition(scores, state.settings.winTarget) ?? undefined;

    return {
        ...state,
        playerScores: scores,
        roundPipCounts: pipCounts,
        roundWinner,
        isRoundTie: isTie,
        gameWinner,
        phase: gameWinner ? "finished" : "round-summary",
    };
}

/**
 * Start the next round
 */
function startNextRound(state: DominoesState): DominoesState {
    if (state.phase !== "round-summary") {
        throw new Error("Can only start next round from round-summary phase.");
    }

    // Generate new tiles
    const dominoSet = buildDominoSet();
    const shuffledDominoes = shuffleTiles(dominoSet);
    const newHands = dealTilesToPlayers(shuffledDominoes, state.players);

    // Determine new starting player (player with highest double)
    const startingPlayerId = findPlayerWithHighestDouble(newHands);
    const startingPlayerIndex = startingPlayerId
        ? state.playOrder.indexOf(startingPlayerId)
        : (state.startingPlayerIndex + 1) % state.playOrder.length;

    return {
        ...state,
        hands: newHands,
        board: initializeBoard(),
        currentTurnIndex: startingPlayerIndex,
        startingPlayerIndex,
        phase: "playing",
        round: state.round + 1,
        consecutivePasses: 0,
        roundPipCounts: undefined,
        roundWinner: undefined,
        isRoundTie: undefined,
    };
}

function currentPlayerId(state: DominoesState): string {
    return state.playOrder[state.currentTurnIndex];
}

function logHistory(state: DominoesState, action: GameAction): void {
    state.history.push(
        `Action: ${action.type}, Player: ${action.userId}, Payload: ${JSON.stringify(action.payload)}`
    );
}

/**
 * Check if the game has minimum players connected to continue.
 * For Dominoes, all 4 players must be connected to play.
 */
function checkMinimumPlayers(state: DominoesState): boolean {
    return checkAllPlayersConnected(state, DOMINOES_TOTAL_PLAYERS);
}
