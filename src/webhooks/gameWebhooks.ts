import { Room } from "../models/Room";
import { Socket, Server as SocketIOServer } from "socket.io";
import { gameManager, GameState } from "../services/GameManager";

let io: SocketIOServer | null = null;

export function setGameSocketServer(server: SocketIOServer) {
    io = server;
}

export type GameEventPayload<T = {}> = {
    event: string;
    gameState: GameState | null;
    timestamp: string;
} & T;

export type PlayerGameEvent<_T = {}> = {
    event: string;
    playerState: any | null; // TODO: add type safety for player state
    timestamp: string;
};

export function emitGameEvent<T = {}>(
    room: Room,
    event: string,
    customData?: T
): void {
    if (!io) return;
    const gameState = gameManager.getGameState(room.gameId) ?? null;
    const payload: GameEventPayload = {
        event,
        gameState,
        timestamp: new Date().toISOString(),
        ...(customData || {}),
    };
    console.log(`Emitting game event: ${event} for room ${room.id}`);
    io.to(room.id).emit("game_event", payload);
}

export function emitPlayerGameEvent<T = {}>(
    socket: Socket,
    room: Room,
    event: string,
    userId: string,
    customData?: T
): void {
    const playerState = gameManager.getPlayerState(room.gameId, userId) ?? null;
    const payload: PlayerGameEvent = {
        event,
        playerState,
        timestamp: new Date().toISOString(),
        ...(customData || {}),
    };
    socket.emit("game_event", payload);
}
