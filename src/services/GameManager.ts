// src/services/GameManager.ts
import { Room } from "../models/Room";
import { User } from "../models/User";

export interface GameModule {
    init(room: Room, customSettings?: GameSettings): GameState;
    reducer(state: GameState, action: GameAction): GameState;
    getState(state: GameState): any;
    getPlayerState(state: GameState, userId: string): any;
    checkMinimumPlayers?(state: GameState): boolean; // Optional: Check if enough players are connected
    handlePlayerReconnect?(state: GameState, userId: string): GameState; // Optional: Handle player reconnection
    handlePlayerDisconnect?(state: GameState, userId: string): GameState; // Optional: Handle player disconnection
    metadata: {
        type: string;
        displayName: string;
        requiresTeams: boolean;
        minPlayers: number;
        maxPlayers: number;
        numTeams?: number;
        playersPerTeam?: number;
    };
}

export type GamePlayers = Record<string, User>;

export interface GameState {
    id: string;
    roomId: string;
    type: string;
    settings: GameSettings;
    players: GamePlayers;
    history?: string[]; // Optional history for game actions
    leaderId: string;
    // ...other game-specific state
}

export interface GameSettings {
    winTarget: number;
    // ...other common settings
}

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
        // Note: isConnected is true by default, only false when explicitly disconnected
        const connectedPlayers = Object.values(gameState.players).filter(
            (player) => player.isConnected !== false
        );
        return connectedPlayers.length >= module.metadata.minPlayers;
    }
}

export const gameManager = new GameManager();
