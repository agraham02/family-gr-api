import { User } from "./User";

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
    settings?: Record<string, any>; // Additional settings for the room
}
