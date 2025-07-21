import { Room } from "../models/Room";
import { User } from "../models/User";
import { v4 as uuidv4 } from "uuid";
import { emitRoomEvent } from "../webhooks/roomWebhooks";

const rooms: Map<string, Room> = new Map();
const roomCodeToId: Map<string, string> = new Map();

export function createRoom(
    roomName: string,
    userName: string
): { room: Room; user: User } {
    const user: User = {
        id: uuidv4(),
        name: userName,
    };

    const room: Room = {
        id: uuidv4(),
        code: uuidv4().slice(0, 6), // Generate a short code for the room
        name: roomName,
        users: [user],
        leaderId: user.id,
        readyStates: { [user.id]: false },
        state: "lobby",
        createdAt: new Date(),
    };

    rooms.set(room.id, room);
    roomCodeToId.set(room.code, room.id);
    emitRoomEvent(room, "room_created");
    return { room, user };
}

export function joinRoom(
    roomCode: string,
    userName: string
): { room: Room; user: User } {
    const roomId = roomCodeToId.get(roomCode);
    const room = roomId ? rooms.get(roomId) : undefined;
    if (!room) throw new Error("Room not found");
    if (room.state !== "lobby")
        throw new Error("Cannot join: game already started");
    if (room.users.find((u) => u.name === userName))
        throw new Error("User already in room");

    const user: User = {
        id: uuidv4(),
        name: userName,
    };

    room.users.push(user);
    room.readyStates[user.id] = false;
    emitRoomEvent(room, "user_joined");
    return { room, user };
}

export function getRoom(roomId: string): Room | undefined {
    return rooms.get(roomId);
}
