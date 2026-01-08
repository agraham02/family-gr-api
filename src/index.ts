// Entry point for the Express server
import dotenv from "dotenv";
import app from "./config/app";
import { createServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { emitRoomEvent, setSocketServer } from "./webhooks/roomWebhooks";
import {
    closeRoom,
    getRoom,
    handleUserDisconnect,
    kickUser,
    leaveGame,
    abortGame,
    promoteLeader,
    randomizeTeams,
    registerSocketUser,
    selectGame,
    setTeams,
    startGame,
    toggleReadyState,
    updateRoomSettings,
    updateGameSettings,
    addSpectator,
    moveToSpectators,
    claimPlayerSlot,
    getAvailableSlots,
} from "./services/RoomService";
import { GameAction, gameManager } from "./services/GameManager";
import { spadesModule } from "./games/spades";
import { dominoesModule } from "./games/dominoes";
import {
    emitGameEvent,
    emitPlayerGameEvent,
    setGameSocketServer,
} from "./webhooks/gameWebhooks";
import { socketRateLimiter } from "./utils/rateLimiter";

const IS_DEBUG_LOGGING = process.env.NODE_ENV === "development";

dotenv.config({ debug: IS_DEBUG_LOGGING });

const DEFAULT_PORT = 3000;
const PORT = process.env.PORT || DEFAULT_PORT;

gameManager.registerGameModule("spades", spadesModule);
gameManager.registerGameModule("dominoes", dominoesModule);

function handleSocketError(socket: Socket, err: any) {
    console.error(err);
    socket.emit("error", {
        error: err.message || "Internal Server Error",
    });
}

function startServer() {
    const httpServer = createServer(app);

    const io = new SocketIOServer(httpServer, {
        cors: {
            origin: "*",
        },
    });

    setSocketServer(io);
    setGameSocketServer(io);

    io.on("connection", (socket) => {
        // Client should join a room by roomId after connecting
        console.log(`New client connected: ${socket.id}`);

        // Rate limiting middleware for all socket events
        socket.use(([event, ...args], next) => {
            // Skip rate limiting for disconnect-related events
            if (event === "disconnect" || event === "disconnecting") {
                return next();
            }

            const { allowed, remaining } = socketRateLimiter.consume(socket.id);
            if (!allowed) {
                console.warn(
                    `Rate limit exceeded for socket ${socket.id} on event ${event}`
                );
                socket.emit("error", {
                    error: "Rate limit exceeded. Please slow down.",
                });
                return; // Don't call next() - drop the event
            }
            next();
        });

        // Clean up rate limiter entry when socket disconnects
        socket.on("disconnect", () => {
            socketRateLimiter.remove(socket.id);
        });

        socket.on("join_room", ({ roomId, userId }) => {
            try {
                if (!roomId || !userId) {
                    throw new Error(
                        `join_room missing roomId or userId for socket ${socket.id}`
                    );
                }
                const { alreadyConnected } = registerSocketUser(
                    socket.id,
                    roomId,
                    userId
                );

                // If user already has an active connection, acknowledge but don't re-sync
                if (alreadyConnected) {
                    socket.emit("already_joined", { roomId, userId });
                    return;
                }

                socket.join(roomId);
                const room = getRoom(roomId);
                if (!room) {
                    throw new Error("Room not found");
                }
                emitRoomEvent(room, "sync");
            } catch (err) {
                handleSocketError(socket, err);
            }
        });

        socket.on("get_game_state", ({ roomId, userId }) => {
            try {
                if (!roomId || !userId) {
                    throw new Error(
                        `get_game_state missing roomId or userId for socket ${socket.id}`
                    );
                }

                const room = getRoom(roomId);
                if (!room) {
                    throw new Error("Room not found");
                }
                emitGameEvent(room, "sync");
            } catch (err) {
                handleSocketError(socket, err);
            }
        });

        socket.on("get_player_state", ({ roomId, userId }) => {
            try {
                const room = getRoom(roomId);
                if (!room) {
                    throw new Error("Room not found");
                }

                emitPlayerGameEvent(socket, room, "player_sync", userId);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });

        socket.on("toggle_ready", ({ roomId, userId }) => {
            try {
                toggleReadyState(roomId, userId);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });
        socket.on("promote_leader", ({ roomId, userId, newLeaderId }) => {
            try {
                promoteLeader(roomId, userId, newLeaderId);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });

        socket.on("select_game", ({ roomId, userId, gameType }) => {
            try {
                selectGame(roomId, userId, gameType);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });

        socket.on("kick_user", ({ roomId, userId, targetUserId }) => {
            try {
                const { kickedSocketId } = kickUser(
                    roomId,
                    userId,
                    targetUserId
                );

                // Force disconnect the kicked user's socket
                if (kickedSocketId) {
                    const kickedSocket = io.sockets.sockets.get(kickedSocketId);
                    if (kickedSocket) {
                        console.log(
                            `Force disconnecting kicked user socket: ${kickedSocketId}`
                        );
                        kickedSocket.disconnect(true);
                    }
                }
            } catch (err) {
                handleSocketError(socket, err);
            }
        });

        socket.on("set_teams", ({ roomId, userId, teams }) => {
            try {
                setTeams(roomId, userId, teams);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });

        socket.on("randomize_teams", ({ roomId, userId }) => {
            try {
                const teams = randomizeTeams(roomId, userId);
                setTeams(roomId, userId, teams);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });

        socket.on("update_room_settings", ({ roomId, userId, settings }) => {
            try {
                updateRoomSettings(roomId, userId, settings);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });

        socket.on(
            "update_game_settings",
            ({ roomId, userId, gameSettings }) => {
                try {
                    updateGameSettings(roomId, userId, gameSettings);
                } catch (err) {
                    handleSocketError(socket, err);
                }
            }
        );

        socket.on(
            "start_game",
            ({ roomId, userId, gameType, gameSettings }) => {
                try {
                    startGame(roomId, userId, gameType, gameSettings);
                } catch (err) {
                    handleSocketError(socket, err);
                }
            }
        );

        socket.on(
            "game_action",
            ({ roomId, action }: { roomId: string; action: GameAction }) => {
                const actionId = (action as any).actionId;
                try {
                    const room = getRoom(roomId);
                    if (!room) {
                        throw new Error("Room not found");
                    }
                    if (room.isPaused) {
                        throw new Error(
                            "Game is paused. Waiting for players to rejoin."
                        );
                    }
                    const gameId = room.gameId ?? null;
                    gameManager.dispatch(gameId, action);
                    emitGameEvent(room, "sync");
                    emitPlayerGameEvent(
                        socket,
                        room,
                        "player_sync",
                        action.userId
                    );

                    // Send acknowledgement back to the client
                    if (actionId) {
                        socket.emit("action_ack", {
                            actionId,
                            success: true,
                        });
                    }
                } catch (err) {
                    // Send error acknowledgement
                    if (actionId) {
                        socket.emit("action_ack", {
                            actionId,
                            success: false,
                            error:
                                err instanceof Error
                                    ? err.message
                                    : "Action failed",
                        });
                    }
                    handleSocketError(socket, err);
                }
            }
        );

        socket.on("close_room", ({ roomId, userId }) => {
            try {
                closeRoom(roomId, userId);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });

        socket.on("leave_game", ({ roomId, userId }) => {
            try {
                leaveGame(roomId, userId);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });

        socket.on("abort_game", ({ roomId, userId }) => {
            try {
                abortGame(roomId, userId);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });

        // Spectator system handlers
        socket.on(
            "spectate_game",
            ({
                roomCode,
                userId,
                userName,
            }: {
                roomCode: string;
                userId: string;
                userName: string;
            }) => {
                try {
                    const result = addSpectator(roomCode, userName, userId);
                    const { room, user } = result;

                    // Register socket and join room
                    const { alreadyConnected } = registerSocketUser(
                        socket.id,
                        room.id,
                        user.id
                    );

                    if (!alreadyConnected) {
                        socket.join(room.id);
                    }

                    // Send initial game state (neutral view for spectators)
                    if (room.gameId) {
                        const gameState = gameManager.getGameState(room.gameId);
                        socket.emit("spectator_state", {
                            gameState,
                            room,
                            isSpectator: true,
                        });
                    }
                } catch (err) {
                    handleSocketError(socket, err);
                }
            }
        );

        socket.on(
            "return_to_lobby",
            ({ roomId, userId }: { roomId: string; userId: string }) => {
                try {
                    moveToSpectators(roomId, userId);
                } catch (err) {
                    handleSocketError(socket, err);
                }
            }
        );

        socket.on(
            "claim_player_slot",
            ({
                roomId,
                userId,
                targetSlotUserId,
            }: {
                roomId: string;
                userId: string;
                targetSlotUserId: string;
            }) => {
                try {
                    const result = claimPlayerSlot(
                        roomId,
                        userId,
                        targetSlotUserId
                    );
                    if (!result.success) {
                        socket.emit("error", { error: result.error });
                    }
                } catch (err) {
                    handleSocketError(socket, err);
                }
            }
        );

        socket.on("get_available_slots", ({ roomId }: { roomId: string }) => {
            try {
                const slots = getAvailableSlots(roomId);
                socket.emit("available_slots", { slots });
            } catch (err) {
                handleSocketError(socket, err);
            }
        });

        socket.on("disconnect", () => {
            try {
                console.log(`Client disconnected: ${socket.id}`);
                // Use structured logging middleware instead of console.log
                // app.locals.logger?.info(`Client disconnected: ${socket.id}`);
                handleUserDisconnect(socket.id);
            } catch (err) {
                handleSocketError(socket, err);
            }
        });
    });

    httpServer.listen(PORT, () => {
        // eslint-disable-next-line no-console
        console.log(`Server and Socket.io running on port ${PORT}`);
    });
}

startServer();
