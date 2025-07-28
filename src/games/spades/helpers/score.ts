import { SpadesState, Trick } from "../index";

interface ScoreResult {
    teamScores: Record<number, number>;
    bags: Record<number, number>;
    roundDetails: {
        tricksWon: Record<number, number>;
        bids: Record<number, number>;
        nilSuccess: Record<number, boolean>;
    };
    scoreBreakdown: Record<string, any>; // Detailed breakdown of scores
}

/**
 * Calculates scores for a completed Spades round.
 * @param state The SpadesState at end of round
 * @returns ScoreResult with team scores and bags
 */
export function calculateSpadesScores(state: SpadesState): ScoreResult {
    const { teams, completedTricks, bids, settings } = state;
    const tricksWon: Record<number, number> = {};
    const teamBags: Record<number, number> = {};
    const teamScores: Record<number, number> = {};
    const nilSuccess: Record<number, boolean> = {};
    const teamBids: Record<number, number> = {};

    // Count tricks per team
    Object.keys(teams).forEach((teamId) => {
        tricksWon[Number(teamId)] = 0;
        teamBags[Number(teamId)] = 0;
        teamScores[Number(teamId)] = teams[Number(teamId)].score;
        teamBids[Number(teamId)] = 0;
    });

    // Map player to team
    const playerTeam: Record<string, number> = {};
    Object.entries(teams).forEach(([teamId, team]) => {
        team.players.forEach((pid) => {
            playerTeam[pid] = Number(teamId);
        });
    });

    // Count tricks won per team
    completedTricks.forEach((trick: Trick) => {
        if (trick.winnerId) {
            const teamId = playerTeam[trick.winnerId];
            tricksWon[teamId]++;
        }
    });

    scoreNilBids(
        bids,
        completedTricks,
        playerTeam,
        teamScores,
        nilSuccess,
        teamBids
    );
    scoreRegularBids(
        teams,
        tricksWon,
        teamBids,
        teamScores,
        teamBags,
        settings
    );

    return {
        teamScores,
        bags: teamBags,
        roundDetails: {
            tricksWon,
            bids: teamBids,
            nilSuccess,
        },
        scoreBreakdown: {},
    };
}

function scoreNilBids(
    bids: Record<string, any>, // TODO: Define proper type for bids
    completedTricks: Trick[],
    playerTeam: Record<string, number>,
    teamScores: Record<number, number>,
    nilSuccess: Record<number, boolean>,
    teamBids: Record<number, number>
) {
    Object.entries(bids).forEach(([pid, bid]) => {
        const teamId = playerTeam[pid];
        if (bid.type === "nil") {
            // Nil bid: must win 0 tricks
            const playerTricks = completedTricks.filter(
                (trick) => trick.winnerId === pid
            ).length;
            nilSuccess[teamId] = nilSuccess[teamId] ?? true;
            if (playerTricks === 0) {
                // Successful nil
                teamScores[teamId] += 100;
            } else {
                // Failed nil
                teamScores[teamId] -= 100;
                nilSuccess[teamId] = false;
            }
        } else {
            teamBids[teamId] += bid.amount;
        }
    });
}

function scoreRegularBids(
    teams: Record<number, any>, // TODO: Define proper type for teams
    tricksWon: Record<number, number>,
    teamBids: Record<number, number>,
    teamScores: Record<number, number>,
    teamBags: Record<number, number>,
    settings: any // TODO: Define proper type for settings
) {
    Object.keys(teams).forEach((teamId) => {
        const numId = Number(teamId);
        const bid = teamBids[numId];
        const tricks = tricksWon[numId];
        if (bid > 0) {
            if (tricks >= bid) {
                // Made bid
                teamScores[numId] += bid * 10;
                const bags = tricks - bid;
                teamBags[numId] += bags;
                // Overbid: each extra trick over bid is +1 point
                if (bags > 0) {
                    teamScores[numId] += bags;
                }
                applyBagsPenalty(numId, teamScores, teamBags, settings);
            } else {
                // Failed bid
                teamScores[numId] -= bid * 10;
            }
        }
    });
}

function applyBagsPenalty(
    teamId: number,
    teamScores: Record<number, number>,
    teamBags: Record<number, number>,
    settings: any
) {
    if (teamBags[teamId] >= 10) {
        teamScores[teamId] += settings.bagsPenalty;
        teamBags[teamId] -= 10;
    }
}
