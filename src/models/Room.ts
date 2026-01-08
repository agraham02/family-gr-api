import { User } from "./User";

export interface RoomSettings {
    maxPlayers?: number; // Maximum number of players allowed in the room (null = unlimited)
    pauseTimeoutSeconds?: number; // Timeout in seconds before aborting a paused game (default: 60)
}

export interface GameSettings {
    // Dominoes settings
    winTarget?: number;
    drawFromBoneyard?: boolean;
    // Spades settings
    allowNil?: boolean;
    blindNilEnabled?: boolean;
    bagsPenalty?: number;
}

export interface Room {
    id: string;
    code: string;
    name: string;
    users: User[];
    leaderId: string;
    readyStates: Record<string, boolean>;
    state: "lobby" | "in-game" | "ended";
    gameId: string | null;
    selectedGameType: string;
    createdAt: Date;
    teams?: string[][]; // Array of teams, each team is an array of userIds
    settings?: RoomSettings; // Room-level settings
    gameSettings?: GameSettings; // Game-specific settings (persisted across games)
    isPaused?: boolean; // Track if game is paused due to disconnections
    pausedAt?: Date; // Timestamp when game was paused (for timeout countdown)
    spectators?: string[]; // Array of user IDs who are spectating
    kickedUserIds?: string[]; // Array of user IDs who have been kicked (cannot rejoin)
}
