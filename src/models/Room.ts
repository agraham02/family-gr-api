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
}
