/**
 * Validates teams for a given game type.
 * Throws an error if teams are invalid for the game.
 * @param gameType The selected game type (e.g., 'spades')
 * @param teams Array of teams (each team is an array of userIds)
 * @param users Array of userIds in the room
 * @param requireComplete If true, requires all slots filled (for starting game). Default false.
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
    users: string[],
    requireComplete: boolean = false
): void {
    if (!Array.isArray(teams) || teams.length < 1) {
        throw new Error("Teams must be a non-empty array of arrays.");
    }

    // Get all assigned user IDs (filter out empty strings)
    const allTeamUserIds = teams.flat().filter((id) => id !== "");
    const uniqueAssigned = new Set(allTeamUserIds);

    // Check for duplicates
    if (allTeamUserIds.length !== uniqueAssigned.size) {
        throw new Error("A player cannot be assigned to multiple teams.");
    }

    // Check that assigned users are actually in the room
    for (const id of allTeamUserIds) {
        if (!users.includes(id)) {
            throw new Error("Cannot assign a player who is not in the room.");
        }
    }

    const req = TEAM_REQUIREMENTS[gameType];
    if (req) {
        // Always check team count
        if (teams.length !== req.numTeams) {
            throw new Error(
                `${gameType} requires exactly ${req.numTeams} teams.`
            );
        }

        // Only check full team slots when requireComplete is true (for starting game)
        if (requireComplete) {
            if (
                !teams.every(
                    (team) => team.filter(Boolean).length === req.playersPerTeam
                )
            ) {
                throw new Error(
                    `Each team in ${gameType} must have exactly ${req.playersPerTeam} players to start the game.`
                );
            }

            // Also verify all users are assigned when complete
            if (allTeamUserIds.length !== users.length) {
                throw new Error(
                    "All players must be assigned to a team to start the game."
                );
            }
        }
    }
    // For games that don't require teams, optionally allow empty or single team
}
