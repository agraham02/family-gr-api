import { Room } from "../models/Room";
import { Server as SocketIOServer } from "socket.io";
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
