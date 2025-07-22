import { Room } from "../models/Room";
import { User } from "../models/User";
import { v4 as uuidv4 } from "uuid";
import { emitRoomEvent } from "../webhooks/roomWebhooks";

const rooms: Map<string, Room> = new Map();
const roomCodeToId: Map<string, string> = new Map();
// Track socketId -> { roomId, userId }
const socketToUser: Map<string, { roomId: string; userId: string }> = new Map();

/**
 * Register a socket connection to a user and room after REST join.
 */
export function registerSocketUser(
    socketId: string,
    roomId: string,
    userId: string
): void {
    socketToUser.set(socketId, { roomId, userId });
}

export function createRoom(
    roomName: string,
    userName: string,
    userId?: string
): { room: Room; user: User } {
    const user: User = {
        id: userId || uuidv4(),
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
    userName: string,
    userId?: string
): { room: Room; user: User } {
    const roomId = roomCodeToId.get(roomCode);
    const room = roomId ? rooms.get(roomId) : undefined;
    if (!room) throw new Error("Room not found");
    if (room.state !== "lobby")
        throw new Error("Cannot join: game already started");
    const existingUser = room.users.find((u) => u.id === userId);
    if (existingUser) {
        console.log(`User ${userName} already in room ${room.id}`);

        return { room, user: existingUser };
    }

    const user: User = {
        id: userId || uuidv4(),
        name: userName,
    };

    room.users.push(user);
    room.readyStates[user.id] = false;
    emitRoomEvent<{ userName: string }>(room, "user_joined", {
        userName: user.name,
    });
    return { room, user };
}

export function getRoom(roomId: string): Room | undefined {
    return rooms.get(roomId);
}

/**
 * Cleanup logic for when a socket disconnects.
 * Removes the user from their room, emits event, and deletes room if empty.
 */
export function handleUserDisconnect(socketId: string): void {
    const mapping = socketToUser.get(socketId);
    if (!mapping) return;
    const { roomId, userId } = mapping;
    const room = rooms.get(roomId);
    if (!room) {
        socketToUser.delete(socketId);
        return;
    }

    // Find username before removal
    const userLeaving = room.users.find((u) => u.id === userId);
    const userName = userLeaving ? userLeaving.name : undefined;
    // Remove user from room
    room.users = room.users.filter((u) => u.id !== userId);
    delete room.readyStates[userId];
    // If user was leader, assign new leader if possible
    if (room.leaderId === userId && room.users.length > 0) {
        room.leaderId = room.users[0].id;
    }
    // Emit event with username
    emitRoomEvent<{ userName?: string }>(room, "user_left", { userName });
    // If room is empty, delete it
    if (room.users.length === 0) {
        if (process.env.NODE_ENV !== "dev") {
            rooms.delete(roomId);
            roomCodeToId.forEach((id, code) => {
                if (id === roomId) roomCodeToId.delete(code);
            });
        }
    }
    socketToUser.delete(socketId);
}

export function setReadyState(
    roomId: string,
    userId: string,
    ready: boolean
): void {
    const room = getRoom(roomId);
    if (!room) throw new Error("Room not found");
    if (!room.users.find((u) => u.id === userId))
        throw new Error("User not in room");

    room.readyStates[userId] = ready;
    emitRoomEvent<{ userId: string; ready: boolean }>(
        room,
        "user_ready_state_changed",
        {
            userId,
            ready,
        }
    );
}

export function toggleReadyState(roomId: string, userId: string): void {
    const room = getRoom(roomId);
    if (!room) throw new Error("Room not found");
    if (!room.users.find((u) => u.id === userId))
        throw new Error("User not in room");

    room.readyStates[userId] = !room.readyStates[userId];
    emitRoomEvent<{ userId: string; ready: boolean }>(
        room,
        "user_ready_state_changed",
        {
            userId,
            ready: room.readyStates[userId],
        }
    );
}

export function promoteLeader(
    roomId: string,
    userId: string,
    newLeaderId: string
): void {
    const room = getRoom(roomId);
    if (!room) throw new Error("Room not found");
    if (room.leaderId !== userId)
        throw new Error("Only the current leader can promote a new leader");
    if (!room.users.find((u) => u.id === newLeaderId))
        throw new Error("New leader must be a participant in the room");

    room.leaderId = newLeaderId;
    emitRoomEvent<{ newLeaderId: string }>(room, "leader_promoted", {
        newLeaderId,
    });
}
export function kickUser(
    roomId: string,
    userId: string,
    targetUserId: string
): void {
    const room = getRoom(roomId);
    if (!room) throw new Error("Room not found");
    if (room.leaderId !== userId)
        throw new Error("Only the current leader can kick a user");
    if (!room.users.find((u) => u.id === targetUserId))
        throw new Error("User not found in room");

    room.users = room.users.filter((u) => u.id !== targetUserId);
    delete room.readyStates[targetUserId];
    emitRoomEvent<{ userId: string }>(room, "user_kicked", {
        userId: targetUserId,
    });
}

export function startGame(roomId: string, userId: string): void {
    const room = getRoom(roomId);
    if (!room) throw new Error("Room not found");
    if (room.leaderId !== userId)
        throw new Error("Only the current leader can start the game");

    room.state = "in-game";
    emitRoomEvent(room, "game_started");
}

export function closeRoom(roomId: string, userId: string): void {
    const room = getRoom(roomId);
    if (!room) throw new Error("Room not found");
    if (room.leaderId !== userId)
        throw new Error("Only the current leader can close the room");

    rooms.delete(roomId);
    emitRoomEvent(room, "room_closed");
}
