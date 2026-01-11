import { Room } from "../models/Room";
import { validateTeamsForGame } from "../utils/validateTeamsForGame";
import { User } from "../models/User";
import { v4 as uuidv4 } from "uuid";
import { emitRoomEvent } from "../webhooks/roomWebhooks";
import { emitGameEvent } from "../webhooks/gameWebhooks";
import { gameManager } from "./GameManager";
import { PartialGameSettings } from "../models/Settings";
import {
    notFound,
    forbidden,
    conflict,
    tooManyRequests,
    badRequest,
} from "../utils/httpErrors";
import { pauseTimer, resumeTimer as resumeTurnTimer } from "./GameTurnTimer";

const rooms: Map<string, Room> = new Map();
const roomCodeToId: Map<string, string> = new Map();
// Track socketId -> { roomId, userId }
const socketToUser: Map<string, { roomId: string; userId: string }> = new Map();
// Track userId -> socketId for deduplication (prevents duplicate joins from React Strict Mode/reconnects)
const userToSocket: Map<string, string> = new Map();
// Track scheduled deletions for empty rooms
const roomDeletionTimers: Map<string, NodeJS.Timeout> = new Map();
// Configurable TTL in seconds before deleting an empty room (default: 300 seconds = 5 minutes)
const ROOM_EMPTY_TTL_SECONDS: number = Number(
    process.env.ROOM_EMPTY_TTL_SECONDS ?? 300
);
// Track reconnection timeout timers for paused games
const reconnectTimeoutTimers: Map<string, NodeJS.Timeout> = new Map();
// Configurable timeout in minutes before aborting a paused game
const RECONNECT_TIMEOUT_MINUTES: number = Number(
    process.env.RECONNECT_TIMEOUT_MINUTES ?? 2
);

// ============================================================================
// Settings Validation
// ============================================================================

/**
 * Validate and normalize game settings against a game's settings definitions.
 * - Coerces types (strings to booleans/numbers)
 * - Clamps numeric values to min/max ranges
 * - Applies defaults for missing properties
 * - Ignores settings with unmet dependencies
 */
export function validateGameSettings(
    gameType: string,
    settings: Record<string, unknown>
): PartialGameSettings {
    const settingsData = gameManager.getSettingsForGame(gameType);
    if (!settingsData) {
        // Unknown game type - return settings as-is
        return settings as PartialGameSettings;
    }

    const { definitions } = settingsData;
    const validated: Record<string, unknown> = {};

    for (const def of definitions) {
        const rawValue = settings[def.key];
        let value: unknown;

        // Check dependency
        if (def.dependsOn) {
            const parentValue =
                settings[def.dependsOn.key] ?? validated[def.dependsOn.key];
            if (parentValue !== def.dependsOn.value) {
                // Dependency not met - use default
                validated[def.key] = def.default;
                continue;
            }
        }

        // If value not provided, use default
        if (rawValue === undefined || rawValue === null) {
            // For nullableNumber, null is a valid value
            if (def.type === "nullableNumber" && rawValue === null) {
                validated[def.key] = null;
            } else {
                validated[def.key] = def.default;
            }
            continue;
        }

        // Type coercion and validation
        switch (def.type) {
            case "boolean":
                if (typeof rawValue === "boolean") {
                    value = rawValue;
                } else if (rawValue === "true" || rawValue === 1) {
                    value = true;
                } else if (rawValue === "false" || rawValue === 0) {
                    value = false;
                } else {
                    value = def.default;
                }
                break;

            case "number":
            case "nullableNumber":
                if (rawValue === null && def.type === "nullableNumber") {
                    value = null;
                } else {
                    const num = Number(rawValue);
                    if (isNaN(num)) {
                        value = def.default;
                    } else {
                        // Clamp to min/max
                        let clamped = num;
                        if (def.min !== undefined)
                            clamped = Math.max(clamped, def.min);
                        if (def.max !== undefined)
                            clamped = Math.min(clamped, def.max);
                        // Round to step if specified
                        if (def.step !== undefined && def.step > 0) {
                            const baseValue = def.min ?? 0;
                            clamped =
                                Math.round((clamped - baseValue) / def.step) *
                                    def.step +
                                baseValue;
                        }
                        value = clamped;
                    }
                }
                break;

            case "select":
                // Validate against options
                const validOptions = def.options?.map((o) => o.value) ?? [];
                if (validOptions.includes(String(rawValue))) {
                    value = String(rawValue);
                } else {
                    value = def.default;
                }
                break;

            default:
                value = rawValue;
        }

        validated[def.key] = value;
    }

    return validated as PartialGameSettings;
}

// ============================================================================
// Private Room Join Requests
// ============================================================================

// Track join requests for private rooms
// Map: roomId -> Map<requesterId, { requesterName, requestedAt, attempts }>
const joinRequests: Map<
    string,
    Map<string, { requesterName: string; requestedAt: Date; attempts: number }>
> = new Map();

// Rate limiting for join requests
const JOIN_REQUEST_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const JOIN_REQUEST_MAX_ATTEMPTS = 3;

/**
 * Request to join a private room.
 * Returns success if request is valid and leader will be notified.
 * Throws error if rate limited or room is not private.
 */
export function requestToJoinRoom(
    roomCode: string,
    requesterId: string,
    requesterName: string
): { roomId: string; leaderId: string } {
    // Normalize room code to uppercase for lookup
    const normalizedCode = roomCode.toUpperCase();
    const roomId = roomCodeToId.get(normalizedCode);
    if (!roomId)
        throw notFound(
            "Room not found. Please check the room code and try again."
        );

    const room = rooms.get(roomId);
    if (!room)
        throw notFound(
            "Room not found. Please check the room code and try again."
        );

    // Only allow requests for private rooms
    if (!room.settings?.isPrivate) {
        throw conflict("Room is not private. You can join directly.");
    }

    // Check if user is already in the room
    if (room.users.find((u) => u.id === requesterId)) {
        throw conflict("You are already in this room.");
    }

    // Check if user has been kicked
    if (room.kickedUserIds?.includes(requesterId)) {
        throw forbidden(
            "You have been kicked from this room and cannot request to join."
        );
    }

    // Check rate limiting
    if (!joinRequests.has(roomId)) {
        joinRequests.set(roomId, new Map());
    }
    const roomRequests = joinRequests.get(roomId)!;
    const existingRequest = roomRequests.get(requesterId);

    if (existingRequest) {
        const timeSinceRequest =
            Date.now() - existingRequest.requestedAt.getTime();

        // Check cooldown
        if (timeSinceRequest < JOIN_REQUEST_COOLDOWN_MS) {
            const remainingSeconds = Math.ceil(
                (JOIN_REQUEST_COOLDOWN_MS - timeSinceRequest) / 1000
            );
            throw tooManyRequests(
                `Please wait ${Math.ceil(remainingSeconds / 60)} minute(s) before requesting again.`
            );
        }

        // Check max attempts
        if (existingRequest.attempts >= JOIN_REQUEST_MAX_ATTEMPTS) {
            throw tooManyRequests(
                "You have exceeded the maximum number of join requests for this room."
            );
        }
    }

    // Store/update the request
    roomRequests.set(requesterId, {
        requesterName,
        requestedAt: new Date(),
        attempts: (existingRequest?.attempts ?? 0) + 1,
    });

    return { roomId: room.id, leaderId: room.leaderId };
}

/**
 * Accept a join request for a private room.
 * Only the room leader can accept requests.
 */
export function acceptJoinRequest(
    roomId: string,
    leaderId: string,
    requesterId: string,
    requesterName: string
): { room: Room; user: User } {
    const room = rooms.get(roomId);
    if (!room) throw notFound("Room not found.");

    if (room.leaderId !== leaderId) {
        throw forbidden("Only the room leader can accept join requests.");
    }

    // Clear the request
    const roomRequests = joinRequests.get(roomId);
    if (roomRequests) {
        roomRequests.delete(requesterId);
    }

    // Join the user with bypassed private check
    return joinRoom(room.code, requesterName, requesterId, true);
}

/**
 * Reject a join request for a private room.
 * Only the room leader can reject requests.
 */
export function rejectJoinRequest(
    roomId: string,
    leaderId: string,
    _requesterId: string
): void {
    const room = rooms.get(roomId);
    if (!room) throw notFound("Room not found.");

    if (room.leaderId !== leaderId) {
        throw forbidden("Only the room leader can reject join requests.");
    }

    // Keep the request in the map (with its attempt count) but mark as rejected
    // This preserves rate limiting while allowing the cooldown to reset
}

/**
 * Get room ID from room code (used for join requests)
 */
export function getRoomIdByCode(roomCode: string): string | undefined {
    // Normalize room code to uppercase for lookup
    return roomCodeToId.get(roomCode.toUpperCase());
}

/**
 * Helper function to check if a room has an active game in progress.
 */
function isActiveGame(room: Room): boolean {
    return room.state === "in-game" && room.gameId !== null;
}

/**
 * Remove a user from team assignments when they leave the room.
 * Returns true if teams were modified.
 */
function removeUserFromTeams(room: Room, userId: string): boolean {
    if (!room.teams || room.teams.length === 0) return false;

    let modified = false;
    for (let t = 0; t < room.teams.length; t++) {
        const idx = room.teams[t].indexOf(userId);
        if (idx !== -1) {
            // Replace with empty string to preserve slot structure
            room.teams[t][idx] = "";
            modified = true;
        }
    }

    if (modified) {
        emitRoomEvent<{ teams: string[][] }>(room, "teams_set", {
            teams: room.teams,
        });
    }

    return modified;
}

function scheduleRoomDeletionIfEmpty(roomId: string): void {
    // Avoid double-scheduling
    if (roomDeletionTimers.has(roomId)) return;
    const ms = ROOM_EMPTY_TTL_SECONDS * 1000;
    const timeout = setTimeout(() => {
        const room = rooms.get(roomId);
        // Only delete if it is still empty
        if (room && room.users.length === 0) {
            if (process.env.NODE_ENV !== "dev") {
                rooms.delete(roomId);
                roomCodeToId.forEach((id, code) => {
                    if (id === roomId) roomCodeToId.delete(code);
                });
            }
        }
        roomDeletionTimers.delete(roomId);
    }, ms);
    roomDeletionTimers.set(roomId, timeout);
    console.log("Timer started");
}

function cancelScheduledRoomDeletion(roomId: string): void {
    const timeout = roomDeletionTimers.get(roomId);
    if (timeout) {
        clearTimeout(timeout);
        roomDeletionTimers.delete(roomId);
        console.log("Timeout canceled");
    }
}

/**
 * Start a reconnection timeout timer for a paused game.
 * If no players reconnect within the timeout, the game is aborted.
 */
function scheduleReconnectTimeout(roomId: string): void {
    // Avoid double-scheduling
    if (reconnectTimeoutTimers.has(roomId)) return;
    const ms = RECONNECT_TIMEOUT_MINUTES * 60 * 1000;
    const timeout = setTimeout(() => {
        abortGameDueToTimeout(roomId);
    }, ms);
    reconnectTimeoutTimers.set(roomId, timeout);
    console.log(
        `Reconnect timeout started for room ${roomId} (${RECONNECT_TIMEOUT_MINUTES} minutes)`
    );
}

/**
 * Cancel a pending reconnection timeout timer.
 */
function cancelReconnectTimeout(roomId: string): void {
    const timeout = reconnectTimeoutTimers.get(roomId);
    if (timeout) {
        clearTimeout(timeout);
        reconnectTimeoutTimers.delete(roomId);
        console.log(`Reconnect timeout canceled for room ${roomId}`);
    }
}

/**
 * Abort a game due to reconnection timeout expiry.
 * Sets room state to ended and notifies all clients.
 */
function abortGameDueToTimeout(roomId: string): void {
    console.log(
        `⏰ Reconnect timeout expired for room ${roomId} - aborting game`
    );
    const room = rooms.get(roomId);
    if (!room) {
        reconnectTimeoutTimers.delete(roomId);
        return;
    }

    // Clean up game state
    if (room.gameId) {
        gameManager.removeGame(room.gameId);
    }

    room.state = "lobby";
    room.gameId = null;
    room.isPaused = false;
    room.pausedAt = undefined;

    // Reset ready states for all users
    room.users.forEach((user) => {
        room.readyStates[user.id] = false;
    });

    emitRoomEvent<{ reason: string }>(room, "game_aborted", {
        reason: "reconnect_timeout",
    });

    reconnectTimeoutTimers.delete(roomId);

    // Check if all users are disconnected - if so, schedule room deletion
    const connectedUsers = room.users.filter((u) => u.isConnected !== false);
    if (connectedUsers.length === 0) {
        // Remove disconnected users since game is over
        room.users = [];
        scheduleRoomDeletionIfEmpty(roomId);
        console.log(
            `Game aborted and room scheduled for deletion (all users disconnected) for room ${roomId}`
        );
    } else {
        console.log(`Game aborted due to reconnect timeout for room ${roomId}`);
    }
}

/**
 * Generates a unique 6-character alphanumeric room code.
 */
async function generateUniqueRoomCode(): Promise<string> {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code: string;
    // make sure js waits for code generation to be finished
    return await new Promise((resolve) => {
        do {
            code = Array.from({ length: 6 }, () =>
                chars.charAt(Math.floor(Math.random() * chars.length))
            ).join("");
        } while (roomCodeToId.has(code));
        resolve(code);
    });
}

/**
 * Register a socket connection to a user and room after REST join.
 * Handles rejoin logic if user is already in the room (both lobby and in-game).
 * Returns { alreadyConnected: true } if user already has an active socket connection.
 * Throws an error if user has been kicked from the room.
 */
export function registerSocketUser(
    socketId: string,
    roomId: string,
    userId: string
): { alreadyConnected: boolean; oldSocketId?: string } {
    // Check if the room exists first
    const room = rooms.get(roomId);
    if (!room) {
        throw notFound("Room not found.");
    }

    // Check if user has been kicked from this room
    if (room.kickedUserIds?.includes(userId)) {
        throw forbidden(
            "You have been kicked from this room and cannot rejoin."
        );
    }

    // Check for duplicate connection (same user already connected with different socket)
    const existingSocketId = userToSocket.get(userId);
    if (existingSocketId && existingSocketId !== socketId) {
        const existingMapping = socketToUser.get(existingSocketId);
        if (existingMapping && existingMapping.roomId === roomId) {
            // User already has an active socket in this room - this is a duplicate
            console.log(
                `Duplicate join detected for user ${userId} in room ${roomId}. ` +
                    `Existing socket: ${existingSocketId}, New socket: ${socketId}. ` +
                    `Disconnecting old socket.`
            );
            return { alreadyConnected: true, oldSocketId: existingSocketId };
        }
    }

    // Register the new socket connection
    socketToUser.set(socketId, { roomId, userId });
    userToSocket.set(userId, socketId);

    const user = room.users.find((u) => u.id === userId);
    if (!user) {
        // User is not in this room - they need to join via REST API first
        // Clean up the socket mappings we just set
        socketToUser.delete(socketId);
        userToSocket.delete(userId);
        throw forbidden(
            "You are not a member of this room. Please join the room first."
        );
    }

    console.log(
        `📡 registerSocketUser: user ${user.name} (${userId}), isConnected: ${user.isConnected}, room state: ${room.state}, isPaused: ${room.isPaused}`
    );

    // Handle rejoin for both lobby and in-game states
    if (user.isConnected === false) {
        // User is rejoining
        console.log(
            `🔄 User ${user.name} (${userId}) is rejoining - was disconnected, now marking connected`
        );
        user.isConnected = true;

        if (isActiveGame(room)) {
            // In-game rejoin
            console.log(
                `🎮 User ${user.name} rejoining active game. Room paused: ${room.isPaused}`
            );
            gameManager.handlePlayerReconnect(room.gameId, userId);

            // Emit event about user reconnection
            emitRoomEvent<{ userName?: string; userId: string }>(
                room,
                "user_reconnected",
                { userName: user.name, userId }
            );
        } else {
            // Lobby rejoin - user must have refreshed the page and is joining again

            // Emit reconnection event
            emitRoomEvent<{ userName?: string; userId: string }>(
                room,
                "user_reconnected",
                { userName: user.name, userId }
            );

            console.log(`User ${user.name} reconnected to lobby`);
        }
    }

    // ALWAYS check if game can be resumed when user registers socket during active game
    // This handles the case where user was marked connected by lobby's join_room before game page loaded
    if (isActiveGame(room) && room.isPaused) {
        // Only reconnect if user is actually a player in the game (not a new/replacement user)
        const isGamePlayer = gameManager.isPlayerInGame(room.gameId, userId);
        const isSpectator = room.spectators?.includes(userId) ?? false;

        if (isGamePlayer && !isSpectator) {
            // Ensure the game state's player is marked as connected
            gameManager.handlePlayerReconnect(room.gameId, userId);

            const hasMinPlayers = gameManager.checkMinimumPlayers(room.gameId);
            console.log(
                `🎮 Checking resume: hasMinPlayers=${hasMinPlayers}, isPaused=${room.isPaused}`
            );
            if (hasMinPlayers) {
                console.log(`✅ Resuming game - all players connected`);
                room.isPaused = false;
                room.pausedAt = undefined;
                room.timeoutAt = undefined;
                cancelReconnectTimeout(room.id);

                // Resume turn timer when game resumes
                if (room.gameId) {
                    resumeTurnTimer(room.gameId, room);
                }

                emitRoomEvent<{ userName?: string }>(room, "game_resumed", {
                    userName: user.name,
                });
            }
        } else {
            console.log(
                `📡 User ${user.name} is not a game player (isGamePlayer=${isGamePlayer}, isSpectator=${isSpectator}) - skipping reconnect`
            );
        }
    }

    return { alreadyConnected: false };
}

export async function createRoom(
    roomName: string,
    userName: string,
    userId?: string
): Promise<{ room: Room; user: User }> {
    const user: User = {
        id: userId || uuidv4(),
        name: userName,
        isConnected: true,
    };

    const room: Room = {
        id: uuidv4(),
        code: await generateUniqueRoomCode(), // Generate a unique short code for the room
        name: roomName,
        users: [user],
        leaderId: user.id,
        readyStates: { [user.id]: false },
        state: "lobby",
        selectedGameType: "spades",
        gameId: null,
        createdAt: new Date(),
        isPaused: false,
    };

    rooms.set(room.id, room);
    roomCodeToId.set(room.code, room.id);
    emitRoomEvent(room, "room_created");
    return { room, user };
}

export function joinRoom(
    roomCode: string,
    userName: string,
    userId?: string,
    bypassPrivateCheck?: boolean // Used when accepting a join request
): { room: Room; user: User } {
    // Normalize room code to uppercase for lookup
    const normalizedCode = roomCode.toUpperCase();
    const roomId = roomCodeToId.get(normalizedCode);
    const room = roomId ? rooms.get(roomId) : undefined;
    if (!room)
        throw notFound(
            "Room not found. Please check the room code and try again."
        );

    // Check if user has been kicked from this room
    if (userId && room.kickedUserIds?.includes(userId)) {
        throw forbidden(
            "You have been kicked from this room and cannot rejoin."
        );
    }

    // Check if room is private (unless bypassing for accepted requests)
    const existingUser = room.users.find((u) => u.id === userId);
    if (!existingUser && room.settings?.isPrivate && !bypassPrivateCheck) {
        throw forbidden(
            "This room is private. Please request to join.",
            "PRIVATE_ROOM"
        );
    }

    // If a deletion was scheduled (room had been empty), cancel it now
    cancelScheduledRoomDeletion(room.id);

    if (existingUser) {
        console.log(`User ${userName} already in room ${room.id}`);

        // DON'T mark as connected here - let registerSocketUser handle it
        // This ensures the resume logic triggers properly when socket connects
        if (existingUser.isConnected === false) {
            console.log(
                `User ${userName} will rejoin room ${room.id} on socket connection`
            );
        }

        // If game is active, log it (connection will be handled in registerSocketUser)
        if (isActiveGame(room)) {
            console.log(
                `User ${userName} rejoining active game in room ${room.id} (will reconnect on socket)`
            );
        }

        return { room, user: existingUser };
    }

    // Allow joining if room is in lobby or if game is paused (waiting for replacement players)
    if (
        room.state !== "lobby" &&
        !(room.state === "in-game" && room.isPaused)
    ) {
        throw conflict("Cannot join: game is already in progress.");
    }

    // Check max players limit
    const maxPlayers = room.settings?.maxPlayers;
    if (maxPlayers && room.users.length >= maxPlayers) {
        throw conflict(`Room is full (max ${maxPlayers} players).`);
    }

    const user: User = {
        id: userId || uuidv4(),
        name: userName,
        isConnected: true,
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
 * Get the socket ID for a user.
 * Returns undefined if user doesn't have an active socket.
 */
export function getSocketIdForUser(userId: string): string | undefined {
    return userToSocket.get(userId);
}

/**
 * Clean up socket mappings for a user (used when kicking).
 */
export function cleanupUserSocket(userId: string): void {
    const socketId = userToSocket.get(userId);
    if (socketId) {
        socketToUser.delete(socketId);
        userToSocket.delete(userId);
    }
}

/**
 * Cleanup logic for when a socket disconnects.
 * During an active game, marks the user as disconnected instead of removing them.
 * In lobby, removes the user completely.
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

    // Find username before any changes
    const userLeaving = room.users.find((u) => u.id === userId);
    const userName = userLeaving ? userLeaving.name : undefined;

    // If game is active, mark user as disconnected instead of removing
    if (isActiveGame(room)) {
        // Mark user as disconnected
        const user = room.users.find((u) => u.id === userId);
        if (!user) {
            // User not found in room, just clean up socket mapping
            socketToUser.delete(socketId);
            return;
        }

        user.isConnected = false;

        // Notify GameManager about disconnection
        gameManager.handlePlayerDisconnect(room.gameId, userId);

        // Check if game should be paused
        const hasMinPlayers = gameManager.checkMinimumPlayers(room.gameId);
        if (!hasMinPlayers && !room.isPaused) {
            room.isPaused = true;
            room.pausedAt = new Date();
            const timeoutAt = new Date(
                room.pausedAt.getTime() + RECONNECT_TIMEOUT_MINUTES * 60 * 1000
            );
            room.timeoutAt = timeoutAt;
            scheduleReconnectTimeout(room.id);

            // Pause turn timer when game is paused
            if (room.gameId) {
                pauseTimer(room.gameId);
            }

            emitRoomEvent<{
                userName?: string;
                reason: string;
                timeoutAt: string;
            }>(room, "game_paused", {
                userName,
                reason: "waiting_for_players",
                timeoutAt: timeoutAt.toISOString(),
            });
        }

        // Auto-promote leader if the disconnected user was the leader
        if (room.leaderId === userId) {
            const connectedUsers = room.users.filter(
                (u) => u.isConnected !== false
            );
            if (connectedUsers.length > 0) {
                const newLeader = connectedUsers[0];
                room.leaderId = newLeader.id;
                emitRoomEvent<{ newLeaderId: string; newLeaderName: string }>(
                    room,
                    "leader_promoted",
                    {
                        newLeaderId: newLeader.id,
                        newLeaderName: newLeader.name,
                    }
                );
            }
        }

        // Emit event about user disconnection
        emitRoomEvent<{ userName?: string; userId: string }>(
            room,
            "user_disconnected",
            { userName, userId }
        );
    } else {
        // In lobby or ended state - remove user immediately
        const user = room.users.find((u) => u.id === userId);
        if (user) {
            // Remove user from room
            room.users = room.users.filter((u) => u.id !== userId);
            delete room.readyStates[userId];

            // Remove from team assignments
            removeUserFromTeams(room, userId);

            // If user was leader, assign new leader if possible
            if (room.leaderId === userId && room.users.length > 0) {
                room.leaderId = room.users[0].id;
                emitRoomEvent<{ newLeaderId: string; newLeaderName: string }>(
                    room,
                    "leader_promoted",
                    {
                        newLeaderId: room.users[0].id,
                        newLeaderName: room.users[0].name,
                    }
                );
            }

            // Emit user left event
            emitRoomEvent<{ userName?: string }>(room, "user_left", {
                userName,
            });

            // If room is empty, schedule deletion after TTL (1 minute by default)
            if (room.users.length === 0) {
                scheduleRoomDeletionIfEmpty(roomId);
            }

            console.log(`User ${userName} removed from lobby`);
        }
    }

    socketToUser.delete(socketId);
    // Only remove userToSocket mapping if this was the active socket for this user
    if (userToSocket.get(userId) === socketId) {
        userToSocket.delete(userId);
    }
}

export function setReadyState(
    roomId: string,
    userId: string,
    ready: boolean
): void {
    const room = getRoom(roomId);
    if (!room) throw notFound("Room not found.");
    if (!room.users.find((u) => u.id === userId))
        throw forbidden("User not in room.");

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
    if (!room) throw notFound("Room not found.");
    if (!room.users.find((u) => u.id === userId))
        throw forbidden("User not in room.");

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
    if (!room) throw notFound("Room not found.");
    if (room.leaderId !== userId)
        throw forbidden("Only the current leader can promote a new leader.");
    if (!room.users.find((u) => u.id === newLeaderId))
        throw badRequest("New leader must be a participant in the room.");

    room.leaderId = newLeaderId;
    emitRoomEvent<{ newLeaderId: string }>(room, "leader_promoted", {
        newLeaderId,
    });
}

export function selectGame(
    roomId: string,
    userId: string,
    gameType: string = "spades"
) {
    const room = getRoom(roomId);
    if (!room) throw notFound("Room not found.");
    if (room.leaderId !== userId)
        throw forbidden("Only the current leader can select a game.");

    if (room.selectedGameType === gameType) {
        // If the same game is selected, clear the selection
        room.selectedGameType = "";
    } else {
        room.selectedGameType = gameType;
    }

    emitRoomEvent(room, "game_selected", { gameType });
}

/**
 * Update room settings (maxPlayers, pauseTimeoutSeconds, isPrivate).
 * Only the room leader can update settings.
 */
export function updateRoomSettings(
    roomId: string,
    userId: string,
    settings: {
        maxPlayers?: number;
        pauseTimeoutSeconds?: number;
        isPrivate?: boolean;
    }
): void {
    const room = getRoom(roomId);
    if (!room) throw notFound("Room not found.");
    if (room.leaderId !== userId)
        throw forbidden("Only the current leader can update room settings.");

    room.settings = {
        ...room.settings,
        ...settings,
    };

    emitRoomEvent(room, "room_settings_updated", { settings: room.settings });
}

/**
 * Update game settings (winTarget, allowNil, etc.).
 * Only the room leader can update settings.
 * Settings are validated against the game's settings definitions.
 * Settings are persisted to the room and used when starting games.
 */
export function updateGameSettings(
    roomId: string,
    userId: string,
    gameSettings: Record<string, unknown>
): void {
    const room = getRoom(roomId);
    if (!room) throw notFound("Room not found.");
    if (room.leaderId !== userId)
        throw forbidden("Only the current leader can update game settings.");

    // Validate settings if a game type is selected
    const validatedSettings = room.selectedGameType
        ? validateGameSettings(room.selectedGameType, gameSettings)
        : gameSettings;

    room.gameSettings = {
        ...room.gameSettings,
        ...validatedSettings,
    };

    emitRoomEvent(room, "game_settings_updated", {
        gameSettings: room.gameSettings,
    });
}

/**
 * Kick a user from the room.
 * Returns the kicked user's socket ID so it can be forcefully disconnected.
 */
export function kickUser(
    roomId: string,
    userId: string,
    targetUserId: string
): { kickedSocketId: string | undefined } {
    const room = getRoom(roomId);
    if (!room) throw notFound("Room not found.");
    if (room.leaderId !== userId)
        throw forbidden("Only the current leader can kick a user.");
    if (!room.users.find((u) => u.id === targetUserId))
        throw notFound("User not found in room.");

    const kickedUser = room.users.find((u) => u.id === targetUserId);
    const kickedUserName = kickedUser?.name;

    // Get the kicked user's socket ID before cleaning up
    const kickedSocketId = getSocketIdForUser(targetUserId);

    // Add to kicked users list to prevent rejoining
    if (!room.kickedUserIds) {
        room.kickedUserIds = [];
    }
    room.kickedUserIds.push(targetUserId);

    // Clean up socket mappings for the kicked user
    cleanupUserSocket(targetUserId);

    // If game is active, we need to handle game state
    if (isActiveGame(room)) {
        // Remove player from game state
        if (room.gameId) {
            gameManager.handlePlayerDisconnect(room.gameId, targetUserId);
        }

        // Remove user from room
        room.users = room.users.filter((u) => u.id !== targetUserId);
        delete room.readyStates[targetUserId];

        // Check if game can continue with remaining players
        const hasMinPlayers = gameManager.checkMinimumPlayers(room.gameId);

        if (!hasMinPlayers) {
            // Not enough players to continue - abort the game
            cancelReconnectTimeout(room.id);

            if (room.gameId) {
                gameManager.removeGame(room.gameId);
            }

            room.state = "ended";
            room.gameId = null;
            room.isPaused = false;
            room.pausedAt = undefined;
            room.timeoutAt = undefined;

            // Reset ready states for remaining users
            room.users.forEach((user) => {
                room.readyStates[user.id] = false;
            });

            emitRoomEvent<{ userId: string; userName?: string }>(
                room,
                "user_kicked",
                {
                    userId: targetUserId,
                    userName: kickedUserName,
                }
            );

            emitRoomEvent<{ reason: string }>(room, "game_aborted", {
                reason: "not_enough_players",
            });
        } else {
            // Game can continue
            emitRoomEvent<{ userId: string; userName?: string }>(
                room,
                "user_kicked",
                {
                    userId: targetUserId,
                    userName: kickedUserName,
                }
            );

            // If game was paused waiting for this player, it might be able to resume now
            // (though in most cases kicking a disconnected player won't help reach minimum)
            if (room.isPaused) {
                const canResume = gameManager.checkMinimumPlayers(room.gameId);
                if (canResume) {
                    room.isPaused = false;
                    room.pausedAt = undefined;
                    room.timeoutAt = undefined;
                    cancelReconnectTimeout(room.id);
                    emitRoomEvent(room, "game_resumed", {});
                }
            }

            // Emit game state update
            emitGameEvent(room, "sync");
        }
    } else {
        // Not in active game - original behavior
        room.users = room.users.filter((u) => u.id !== targetUserId);
        delete room.readyStates[targetUserId];

        // Remove from team assignments
        removeUserFromTeams(room, targetUserId);

        emitRoomEvent<{ userId: string; userName?: string }>(
            room,
            "user_kicked",
            {
                userId: targetUserId,
                userName: kickedUserName,
            }
        );
    }

    // If kicking resulted in an empty room, schedule deletion
    if (room.users.length === 0) {
        scheduleRoomDeletionIfEmpty(roomId);
    }

    return { kickedSocketId };
}

export function setTeams(
    roomId: string,
    userId: string,
    teams: string[][]
): void {
    const room = getRoom(roomId);
    if (!room) throw notFound("Room not found.");
    if (room.leaderId !== userId)
        throw forbidden("Only the current leader can set teams.");

    // Validate teams using per-game logic (partial assignments allowed)
    const allUserIds = room.users.map((u) => u.id);
    validateTeamsForGame(room.selectedGameType, teams, allUserIds, false);

    room.teams = teams;
    emitRoomEvent<{ teams: string[][] }>(room, "teams_set", { teams });
}

export function randomizeTeams(roomId: string, userId: string): string[][] {
    const room = getRoom(roomId);
    if (!room) throw notFound("Room not found.");
    if (room.leaderId !== userId)
        throw forbidden("Only the current leader can randomize teams.");

    // Only works for games with team requirements
    const module = gameManager.getGameModule(room.selectedGameType);
    if (!module) throw notFound("Game module not found.");

    const requirements = {
        numTeams: module.metadata.numTeams ?? 0,
        playersPerTeam: module.metadata.playersPerTeam ?? 0,
    };
    if (requirements.numTeams < 1) {
        throw badRequest("This game does not support teams.");
    }

    const userIds = room.users.map((u) => u.id);
    // Shuffle userIds
    for (let i = userIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [userIds[i], userIds[j]] = [userIds[j], userIds[i]];
    }
    // Distribute into teams round-robin
    const teams: string[][] = Array.from(
        { length: requirements.numTeams },
        () => []
    );
    userIds.forEach((id, idx) => {
        teams[idx % requirements.numTeams].push(id);
    });
    return teams;
}

export function startGame(
    roomId: string,
    userId: string,
    gameType: string = "spades",
    customSettings?: any
): void {
    const room = getRoom(roomId);
    if (!room) throw notFound("Room not found.");
    if (room.leaderId !== userId)
        throw forbidden("Only the current leader can start the game.");
    if (Object.values(room.readyStates).some((ready) => !ready))
        throw badRequest("Not all players are ready.");

    // Validate teams are complete for team-based games
    const module = gameManager.getGameModule(gameType);
    if (module && module.metadata.numTeams && module.metadata.numTeams > 0) {
        if (!room.teams || room.teams.length === 0) {
            throw badRequest(
                "Teams must be assigned before starting the game."
            );
        }
        const allUserIds = room.users.map((u) => u.id);
        validateTeamsForGame(gameType, room.teams, allUserIds, true);
    }

    // Mark all users as connected when starting the game
    room.users.forEach((user) => {
        user.isConnected = true;
    });

    // Create game instance
    const gameId = gameManager.createGame(gameType, room, customSettings);
    room.state = "in-game";
    room.gameId = gameId;
    room.isPaused = false;
    room.pausedAt = undefined;
    room.timeoutAt = undefined;

    // Optionally, emit initial game state
    const gameState = gameManager.getGame(gameId);
    emitRoomEvent(room, "game_started", { gameId, gameState, gameType });
}

export function closeRoom(roomId: string, userId: string): void {
    const room = getRoom(roomId);
    if (!room) throw notFound("Room not found.");
    if (room.leaderId !== userId)
        throw forbidden("Only the current leader can close the room.");

    // Clear any scheduled deletion before closing
    cancelScheduledRoomDeletion(roomId);

    // Clean up join requests to prevent memory leak
    joinRequests.delete(roomId);
    rooms.delete(roomId);
    emitRoomEvent(room, "room_closed");
}

/**
 * Handle a player voluntarily leaving a game.
 * The player returns to lobby, game pauses if below minimum players.
 * New players can join to fill the spot.
 */
export function leaveGame(roomId: string, userId: string): void {
    const room = rooms.get(roomId);
    if (!room) throw notFound("Room not found.");

    const user = room.users.find((u) => u.id === userId);
    if (!user) throw notFound("User not found in room.");

    const userName = user.name;

    if (isActiveGame(room)) {
        // Remove player from game entirely (not just disconnect)
        // This prevents auto-reconnection when they return to the lobby
        if (room.gameId) {
            gameManager.removePlayerFromGame(room.gameId, userId);
        }

        // Remove user from room completely (they're going back to lobby page,
        // but we remove them from participants so a new player can join)
        room.users = room.users.filter((u) => u.id !== userId);
        delete room.readyStates[userId];

        // Remove from team assignments
        removeUserFromTeams(room, userId);

        // Handle leader promotion if leaving user was leader
        if (room.leaderId === userId && room.users.length > 0) {
            const connectedUsers = room.users.filter(
                (u) => u.isConnected !== false
            );
            const newLeader =
                connectedUsers.length > 0 ? connectedUsers[0] : room.users[0];
            room.leaderId = newLeader.id;
            emitRoomEvent<{ newLeaderId: string; newLeaderName: string }>(
                room,
                "leader_promoted",
                {
                    newLeaderId: newLeader.id,
                    newLeaderName: newLeader.name,
                }
            );
        }

        // Emit user_left event with voluntary flag
        emitRoomEvent<{ userName?: string; voluntary: boolean }>(
            room,
            "user_left",
            { userName, voluntary: true }
        );

        // Emit game sync so remaining players see updated player states
        emitGameEvent(room, "sync");

        // Check if game should be paused (waiting for replacement player)
        const hasMinPlayers = gameManager.checkMinimumPlayers(room.gameId);
        if (!hasMinPlayers && !room.isPaused) {
            room.isPaused = true;
            room.pausedAt = new Date();
            const timeoutAt = new Date(
                room.pausedAt.getTime() + RECONNECT_TIMEOUT_MINUTES * 60 * 1000
            );
            room.timeoutAt = timeoutAt;
            scheduleReconnectTimeout(room.id);
            emitRoomEvent<{
                reason: string;
                timeoutAt: string;
            }>(room, "game_paused", {
                reason: "waiting_for_players",
                timeoutAt: timeoutAt.toISOString(),
            });
        }

        // If room is now empty, schedule deletion
        if (room.users.length === 0) {
            scheduleRoomDeletionIfEmpty(roomId);
        }

        console.log(`User ${userName} voluntarily left game in room ${roomId}`);
    } else {
        // Not in active game - just remove from lobby
        room.users = room.users.filter((u) => u.id !== userId);
        delete room.readyStates[userId];

        // Remove from team assignments
        removeUserFromTeams(room, userId);

        // Handle leader promotion
        if (room.leaderId === userId && room.users.length > 0) {
            room.leaderId = room.users[0].id;
            emitRoomEvent<{ newLeaderId: string; newLeaderName: string }>(
                room,
                "leader_promoted",
                {
                    newLeaderId: room.users[0].id,
                    newLeaderName: room.users[0].name,
                }
            );
        }

        emitRoomEvent<{ userName?: string; voluntary: boolean }>(
            room,
            "user_left",
            { userName, voluntary: true }
        );

        if (room.users.length === 0) {
            scheduleRoomDeletionIfEmpty(roomId);
        }
    }
}

/**
 * Abort the current game and return all players to lobby.
 * Only the leader can do this.
 */
export function abortGame(roomId: string, userId: string): void {
    const room = rooms.get(roomId);
    if (!room) throw notFound("Room not found.");
    if (room.leaderId !== userId)
        throw forbidden("Only the leader can abort the game.");
    if (!isActiveGame(room)) throw conflict("No active game to abort.");

    // Cancel any reconnect timeout
    cancelReconnectTimeout(room.id);

    // Clean up game state
    if (room.gameId) {
        gameManager.removeGame(room.gameId);
    }

    // Return to lobby state (not "ended")
    room.state = "lobby";
    room.gameId = null;
    room.isPaused = false;
    room.pausedAt = undefined;
    room.timeoutAt = undefined;

    // Reset ready states for all users
    room.users.forEach((user) => {
        room.readyStates[user.id] = false;
    });

    // Emit game_aborted with "leader_ended" reason
    emitRoomEvent<{ reason: string }>(room, "game_aborted", {
        reason: "leader_ended",
    });

    console.log(`Game aborted by leader in room ${roomId}`);
}

/**
 * Add a user as a spectator to a room with an active game.
 * Spectators can watch the game but cannot participate.
 */
export function addSpectator(
    roomCode: string,
    userName: string,
    userId?: string
): { room: Room; user: User; isSpectator: true } {
    // Normalize room code to uppercase for lookup
    const normalizedCode = roomCode.toUpperCase();
    const roomId = roomCodeToId.get(normalizedCode);
    const room = roomId ? rooms.get(roomId) : undefined;
    if (!room)
        throw notFound(
            "Room not found. Please check the room code and try again."
        );

    // Can only spectate if game is in progress
    if (!isActiveGame(room)) {
        throw conflict("No active game to spectate.");
    }

    // Check if already a spectator
    const existingSpectatorId = room.spectators?.find((id) => id === userId);
    if (existingSpectatorId) {
        const existingUser = room.users.find((u) => u.id === userId);
        if (existingUser) {
            return { room, user: existingUser, isSpectator: true };
        }
    }

    // Check if already a player in the game
    const existingPlayer = room.users.find((u) => u.id === userId);
    if (existingPlayer) {
        throw conflict("You are already a player in this game.");
    }

    const user: User = {
        id: userId || uuidv4(),
        name: userName,
        isConnected: true,
    };

    // Initialize spectators array if not exists
    if (!room.spectators) {
        room.spectators = [];
    }

    // Add to users list (for tracking) but mark as spectator
    room.users.push(user);
    room.spectators.push(user.id);

    emitRoomEvent<{ userName: string; isSpectator: boolean }>(
        room,
        "user_joined",
        { userName: user.name, isSpectator: true }
    );

    console.log(`User ${userName} joined as spectator in room ${roomId}`);
    return { room, user, isSpectator: true };
}

/**
 * Move a player from the game to spectator mode.
 * The game continues with their slot open for replacement.
 */
export function moveToSpectators(roomId: string, userId: string): void {
    const room = rooms.get(roomId);
    if (!room) throw notFound("Room not found.");
    if (!isActiveGame(room)) throw conflict("No active game.");

    const user = room.users.find((u) => u.id === userId);
    if (!user) throw notFound("User not found in room.");

    // Check if already a spectator
    if (room.spectators?.includes(userId)) {
        throw conflict("User is already a spectator.");
    }

    // Initialize spectators array if not exists
    if (!room.spectators) {
        room.spectators = [];
    }

    // Add to spectators
    room.spectators.push(userId);

    // Mark their game slot as disconnected (available for replacement)
    if (room.gameId) {
        gameManager.handlePlayerDisconnect(room.gameId, userId);
    }

    // Check if we need to pause the game (handled by handlePlayerDisconnect)
    // Just emit the event here
    emitRoomEvent<{ userId: string; userName: string }>(
        room,
        "player_moved_to_spectators",
        { userId, userName: user.name }
    );

    console.log(`User ${user.name} moved to spectators in room ${roomId}`);
}

/**
 * Allow a spectator (or new player) to claim an open player slot in an active game.
 * The new player inherits the disconnected player's state.
 */
export function claimPlayerSlot(
    roomId: string,
    claimingUserId: string,
    targetSlotUserId: string
): { success: boolean; error?: string } {
    const room = rooms.get(roomId);
    if (!room) return { success: false, error: "Room not found" };
    if (!isActiveGame(room)) return { success: false, error: "No active game" };

    const claimingUser = room.users.find((u) => u.id === claimingUserId);
    if (!claimingUser)
        return { success: false, error: "Claiming user not found" };

    // The claiming user must be a spectator
    if (!room.spectators?.includes(claimingUserId)) {
        return {
            success: false,
            error: "Only spectators can claim player slots",
        };
    }

    // The target slot must be disconnected
    const targetUser = room.users.find((u) => u.id === targetSlotUserId);
    if (!targetUser) return { success: false, error: "Target slot not found" };
    if (targetUser.isConnected) {
        return { success: false, error: "Target slot is still connected" };
    }

    // Transfer the slot in the game engine
    if (room.gameId) {
        const transferred = gameManager.transferPlayerSlot(
            room.gameId,
            targetSlotUserId,
            claimingUserId,
            claimingUser.name
        );
        if (!transferred) {
            return {
                success: false,
                error: "Failed to transfer slot in game engine",
            };
        }
    }

    // Remove claiming user from spectators
    room.spectators = room.spectators.filter((id) => id !== claimingUserId);

    // Remove old user and update their slot to the new user
    room.users = room.users.filter((u) => u.id !== targetSlotUserId);
    delete room.readyStates[targetSlotUserId];

    // Update teams if applicable
    if (room.teams) {
        room.teams = room.teams.map((team) =>
            team.map((id) => (id === targetSlotUserId ? claimingUserId : id))
        );
    }

    // Check if game can resume (all slots filled)
    const allPlayersConnected = room.users
        .filter((u) => !room.spectators?.includes(u.id))
        .every((u) => u.isConnected);

    if (allPlayersConnected && room.isPaused) {
        room.isPaused = false;
        room.pausedAt = undefined;
        room.timeoutAt = undefined;
        cancelReconnectTimeout(room.id);
        emitRoomEvent(room, "game_resumed");
    }

    emitRoomEvent<{
        claimingUserId: string;
        claimingUserName: string;
        targetSlotUserId: string;
    }>(room, "player_slot_claimed", {
        claimingUserId,
        claimingUserName: claimingUser.name,
        targetSlotUserId,
    });

    console.log(
        `User ${claimingUser.name} claimed slot of ${targetUser.name} in room ${roomId}`
    );
    return { success: true };
}

/**
 * Get available (disconnected) player slots that spectators can claim.
 */
export function getAvailableSlots(
    roomId: string
): { userId: string; userName: string; teamIndex?: number }[] {
    const room = rooms.get(roomId);
    if (!room) return [];
    if (!isActiveGame(room)) return [];

    // Find disconnected players who are not spectators
    const disconnectedPlayers = room.users.filter(
        (u) => u.isConnected === false && !room.spectators?.includes(u.id)
    );

    return disconnectedPlayers.map((u) => {
        let teamIndex: number | undefined;
        if (room.teams) {
            teamIndex = room.teams.findIndex((team) => team.includes(u.id));
        }
        return { userId: u.id, userName: u.name, teamIndex };
    });
}
