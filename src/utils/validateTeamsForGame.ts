/**
 * Validates teams for a given game type.
 * Throws an error if teams are invalid for the game.
 * @param gameType The selected game type (e.g., 'spades')
 * @param teams Array of teams (each team is an array of userIds)
 * @param users Array of userIds in the room
 */

import { spadesTeamRequirements } from "../games/spades";

const TEAM_REQUIREMENTS: Record<
    string,
    { numTeams: number; playersPerTeam: number }
> = {
    spades: spadesTeamRequirements,
    // dominoes: { numTeams: 0, playersPerTeam: 0 }, // Example for future games
};

export function validateTeamsForGame(
    gameType: string,
    teams: string[][],
    users: string[]
): void {
    if (!Array.isArray(teams) || teams.length < 1) {
        throw new Error("Teams must be a non-empty array of arrays.");
    }
    // All users must be included, no duplicates
    const allTeamUserIds = teams.flat();
    if (
        allTeamUserIds.length !== users.length ||
        new Set(allTeamUserIds).size !== users.length ||
        !allTeamUserIds.every((id) => users.includes(id))
    ) {
        throw new Error(
            "Teams must include all users in the room, with no duplicates."
        );
    }

    const req = TEAM_REQUIREMENTS[gameType];
    if (req) {
        if (teams.length !== req.numTeams) {
            throw new Error(
                `${gameType} requires exactly ${req.numTeams} teams.`
            );
        }
        if (!teams.every((team) => team.length === req.playersPerTeam)) {
            throw new Error(
                `Each team in ${gameType} must have exactly ${req.playersPerTeam} players.`
            );
        }
    }
    // For games that don't require teams, optionally allow empty or single team
}
