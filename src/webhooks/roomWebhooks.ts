import { Room } from "../models/Room";
import { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | null = null;

export function setSocketServer(server: SocketIOServer) {
    io = server;
}

export type RoomEventPayload<T = {}> = {
    event: string;
    roomState: Room;
    timestamp: string;
} & T;

export function emitRoomEvent<T = {}>(
    room: Room,
    event: string,
    customData?: T
): void {
    if (!io) return;
    const payload: RoomEventPayload = {
        event,
        roomState: room,
        timestamp: new Date().toISOString(),
        ...(customData || {}),
    };
    io.to(room.id).emit("room_event", payload);
}
