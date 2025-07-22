// src/services/GameManager.ts
import { Room } from "../models/Room";

export interface GameModule {
    init(room: Room, customSettings?: GameSettings): GameState;
    reducer(state: GameState, action: GameAction): GameState;
    getState(state: GameState): any;
}

export interface GameState {
    id: string;
    roomId: string;
    type: string;
    settings: GameSettings;
    history?: string[]; // Optional history for game actions
    // ...other game-specific state
}

export interface GameSettings {
    winTarget: number;
    // ...other common settings
}

export interface GameAction {
    type: string;
    payload?: any;
    userId?: string;
}

class GameManager {
    private games: Map<string, GameState> = new Map();
    private modules: Map<string, GameModule> = new Map();

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
}

export const gameManager = new GameManager();
