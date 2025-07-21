import { Room } from "../models/Room";
import { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | null = null;

export function setSocketServer(server: SocketIOServer) {
    io = server;
}

export interface RoomEventPayload extends Omit<Room, "users"> {
    event: string;
    users: Pick<Room["users"][number], "id" | "name">[];
    timestamp: string;
}

export function emitRoomEvent(room: Room, event: string): void {
    if (!io) return;
    const payload: RoomEventPayload = {
        event,
        id: room.id,
        code: room.code,
        name: room.name,
        users: room.users.map((u) => ({
            id: u.id,
            name: u.name,
        })),
        leaderId: room.leaderId,
        readyStates: room.readyStates,
        state: room.state,
        createdAt: room.createdAt,
        timestamp: new Date().toISOString(),
    };
    io.to(room.id).emit("room_event", payload);
}
