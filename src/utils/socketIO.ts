// src/utils/socketIO.ts
// Utility to store and access the Socket.IO server instance

import { Server } from "socket.io";

let ioInstance: Server | null = null;

/**
 * Set the Socket.IO server instance
 */
export function setIO(io: Server): void {
    ioInstance = io;
}

/**
 * Get the Socket.IO server instance
 * @throws Error if IO has not been initialized
 */
export function getIO(): Server {
    if (!ioInstance) {
        throw new Error("Socket.IO has not been initialized");
    }
    return ioInstance;
}

/**
 * Check if Socket.IO has been initialized
 */
export function hasIO(): boolean {
    return ioInstance !== null;
}
