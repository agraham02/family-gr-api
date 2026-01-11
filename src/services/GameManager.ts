// src/services/GameManager.ts
import { Room } from "../models/Room";
import { User } from "../models/User";
import {
    SettingDefinition,
    BaseGameSettings,
    PartialGameSettings,
} from "../models/Settings";

export interface GameModule {
    init(room: Room, customSettings?: PartialGameSettings): GameState;
    reducer(state: GameState, action: GameAction): GameState;
    getState(state: GameState): any;
    getPlayerState(state: GameState, userId: string): any;
    checkMinimumPlayers?(state: GameState): boolean; // Optional: Check if enough players are connected
    handlePlayerReconnect?(state: GameState, userId: string): GameState; // Optional: Handle player reconnection
    handlePlayerDisconnect?(state: GameState, userId: string): GameState; // Optional: Handle player disconnection
    metadata: {
        type: string;
        displayName: string;
        description?: string;
        requiresTeams: boolean;
        minPlayers: number;
        maxPlayers: number;
        numTeams?: number;
        playersPerTeam?: number;
        settingsDefinitions?: SettingDefinition[];
        defaultSettings?: BaseGameSettings;
    };
}

export type GamePlayers = Record<string, User>;

export interface GameState {
    id: string;
    roomId: string;
    type: string;
    settings: BaseGameSettings;
    players: GamePlayers;
    history?: string[]; // Optional history for game actions
    leaderId: string;
    // ...other game-specific state
}

// Re-export for backwards compatibility
export type GameSettings = PartialGameSettings;

export interface GameAction {
    type: string;
    payload?: any;
    userId: string;
}

class GameManager {
    private games: Map<string, GameState> = new Map();
    private modules: Map<string, GameModule> = new Map();

    public getAllModules(): Map<string, GameModule> {
        return this.modules;
    }

    public getGameModule(type: string): GameModule | undefined {
        return this.modules.get(type);
    }

    /**
     * Get settings definitions and defaults for a game type.
     * Used by the API to expose settings schema to clients.
     */
    public getSettingsForGame(
        type: string
    ):
        | { definitions: SettingDefinition[]; defaults: BaseGameSettings }
        | undefined {
        const module = this.modules.get(type);
        if (!module) return undefined;

        return {
            definitions: module.metadata.settingsDefinitions || [],
            defaults: module.metadata.defaultSettings || {
                winTarget: 100,
                roundLimit: null,
                turnTimeLimit: null,
            },
        };
    }

    registerGameModule(type: string, module: GameModule): void {
        this.modules.set(type, module);
    }

    createGame(
        type: string,
        room: Room,
        customSettings?: GameSettings
    ): string {
        const module = this.modules.get(type);
        if (!module)
            throw new Error(`Game module for type '${type}' not found`);

        const gameState = module.init(room, customSettings);
        this.games.set(gameState.id, gameState);
        return gameState.id;
    }

    getGame(gameId: string | null): GameState | undefined {
        if (!gameId) return undefined;
        return this.games.get(gameId);
    }

    getGameState(gameId: string | null): GameState {
        const gameState = this.getGame(gameId);
        if (!gameState) throw new Error(`Game with ID '${gameId}' not found`);
        const module = this.modules.get(gameState.type);
        if (!module)
            throw new Error(
                `Game module for type '${gameState.type}' not found`
            );

        return module.getState(gameState);
    }

    getPlayerState(gameId: string | null, userId: string): any {
        const gameState = this.getGame(gameId);
        if (!gameState) throw new Error(`Game with ID '${gameId}' not found`);
        const module = this.modules.get(gameState.type);
        if (!module)
            throw new Error(
                `Game module for type '${gameState.type}' not found`
            );

        return module.getPlayerState(gameState, userId);
    }

    dispatch(gameId: string | null, action: GameAction): GameState {
        if (!gameId) throw new Error("Game ID is required");

        const gameState = this.games.get(gameId);
        if (!gameState) throw new Error(`Game with ID '${gameId}' not found`);
        const module = this.modules.get(gameState.type);
        if (!module)
            throw new Error(
                `Game module for type '${gameState.type}' not found`
            );
        const newState = module.reducer(gameState, action);
        this.games.set(gameId, newState);
        return newState;
    }

    removeGame(gameId: string): void {
        this.games.delete(gameId);
    }

    handlePlayerDisconnect(gameId: string | null, userId: string): void {
        if (!gameId) return;
        const gameState = this.games.get(gameId);
        if (!gameState) return;
        const module = this.modules.get(gameState.type);
        if (!module) return;

        // Update player connection status
        if (gameState.players[userId]) {
            gameState.players[userId].isConnected = false;
        }

        // Call module-specific disconnect handler if available
        if (module.handlePlayerDisconnect) {
            const newState = module.handlePlayerDisconnect(gameState, userId);
            this.games.set(gameId, newState);
        }
    }

    handlePlayerReconnect(gameId: string | null, userId: string): void {
        if (!gameId) return;
        const gameState = this.games.get(gameId);
        if (!gameState) return;
        const module = this.modules.get(gameState.type);
        if (!module) return;

        // Update player connection status
        if (gameState.players[userId]) {
            gameState.players[userId].isConnected = true;
        }

        // Call module-specific reconnect handler if available
        if (module.handlePlayerReconnect) {
            const newState = module.handlePlayerReconnect(gameState, userId);
            this.games.set(gameId, newState);
        }
    }

    /**
     * Remove a player from the game entirely (used when player voluntarily leaves).
     * This prevents them from auto-reconnecting when they return to the lobby.
     */
    removePlayerFromGame(gameId: string | null, userId: string): void {
        if (!gameId) return;
        const gameState = this.games.get(gameId);
        if (!gameState) return;

        // Remove the player from the game state
        if (gameState.players[userId]) {
            delete gameState.players[userId];
            console.log(`🗑️ Removed player ${userId} from game ${gameId}`);
        }
    }

    /**
     * Check if a user is a player in the game (not removed).
     */
    isPlayerInGame(gameId: string | null, userId: string): boolean {
        if (!gameId) return false;
        const gameState = this.games.get(gameId);
        if (!gameState) return false;
        return !!gameState.players[userId];
    }

    checkMinimumPlayers(gameId: string | null): boolean {
        if (!gameId) return false;
        const gameState = this.games.get(gameId);
        if (!gameState) return false;
        const module = this.modules.get(gameState.type);
        if (!module) return false;

        // If module has custom check, use it
        if (module.checkMinimumPlayers) {
            return module.checkMinimumPlayers(gameState);
        }

        // Default: check if enough players are connected
        // Connection status logic:
        //   - isConnected === true: explicitly connected (set when game starts or player reconnects)
        //   - isConnected === false: explicitly disconnected (set when socket disconnects)
        // TODO
        //   - isConnected === undefined: treated as connected for backwards compatibility
        // We check `!== false` to treat both `true` and `undefined` as connected
        const connectedPlayers = Object.values(gameState.players).filter(
            (player) => player.isConnected !== false
        );
        return connectedPlayers.length >= module.metadata.minPlayers;
    }

    /**
     * Transfer a player slot from a disconnected player to a new player.
     * The new player inherits the old player's game state (hand, score, etc.).
     */
    transferPlayerSlot(
        gameId: string | null,
        oldUserId: string,
        newUserId: string,
        newUserName: string
    ): boolean {
        if (!gameId) return false;
        const gameState = this.games.get(gameId);
        if (!gameState) return false;

        // Check if old user exists and is disconnected
        const oldPlayer = gameState.players[oldUserId];
        if (!oldPlayer) return false;
        if (oldPlayer.isConnected !== false) return false;

        // Create new player entry with old player's data but new identity
        const newPlayer: User = {
            id: newUserId,
            name: newUserName,
            isConnected: true,
        };

        // Remove old player and add new one
        delete gameState.players[oldUserId];
        gameState.players[newUserId] = newPlayer;

        // Update the game in storage
        this.games.set(gameId, gameState);
        return true;
    }
}

export const gameManager = new GameManager();
