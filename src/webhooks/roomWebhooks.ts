import { Room } from "../models/Room";
import { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | null = null;

export function setSocketServer(server: SocketIOServer) {
    io = server;
}

export interface RoomEventPayload {
    event: string;
    roomState: Room;
    timestamp: string;
}

export function emitRoomEvent(room: Room, event: string): void {
    if (!io) return;
    const payload: RoomEventPayload = {
        event,
        roomState: room,
        timestamp: new Date().toISOString(),
    };
    io.to(room.id).emit("room_event", payload);
}
