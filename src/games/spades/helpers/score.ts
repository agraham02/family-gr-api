import { SpadesState, Trick } from "../index";
import { Bid } from "../types";

interface TeamScoreBreakdown {
    previousScore: number;
    tricksWon: number;
    bid: number;
    basePoints: number; // bid * 10 (or negative if failed)
    bags: number; // overtricks this round
    bagPoints: number; // +1 per bag
    bagPenalty: number; // -100 if accumulated 10+ bags
    nilBonus: number; // +100 per successful nil
    nilPenalty: number; // -100 per failed nil
    blindBonus: number; // Extra points from successful blind bid (2x normal)
    blindPenalty: number; // Extra penalty from failed blind bid (2x normal)
    blindNilBonus: number; // +200 for successful blind nil
    blindNilPenalty: number; // -200 for failed blind nil
    roundScore: number; // total points gained/lost this round
    newScore: number; // final score after round
}

interface ScoreResult {
    teamScores: Record<number, number>;
    bags: Record<number, number>;
    roundDetails: {
        tricksWon: Record<number, number>;
        bids: Record<number, number>;
        nilSuccess: Record<number, boolean>;
    };
    scoreBreakdown: Record<number, TeamScoreBreakdown>;
}

/**
 * Calculates scores for a completed Spades round.
 * @param state The SpadesState at end of round
 * @returns ScoreResult with team scores, bags, and detailed breakdown
 */
export function calculateSpadesScores(state: SpadesState): ScoreResult {
    const { teams, completedTricks, bids, settings } = state;

    // Initialize per-team tracking
    const tricksWon: Record<number, number> = {};
    const teamBids: Record<number, number> = {};
    const nilSuccess: Record<number, boolean> = {};
    const scoreBreakdown: Record<number, TeamScoreBreakdown> = {};

    // Map player to team
    const playerTeam: Record<string, number> = {};
    Object.entries(teams).forEach(([teamId, team]) => {
        const numId = Number(teamId);
        playerTeam[team.players[0]] = numId;
        playerTeam[team.players[1]] = numId;

        tricksWon[numId] = 0;
        teamBids[numId] = 0;
        nilSuccess[numId] = true; // Assume success until proven otherwise

        // Initialize breakdown
        scoreBreakdown[numId] = {
            previousScore: team.score,
            tricksWon: 0,
            bid: 0,
            basePoints: 0,
            bags: 0,
            bagPoints: 0,
            bagPenalty: 0,
            nilBonus: 0,
            nilPenalty: 0,
            blindBonus: 0,
            blindPenalty: 0,
            blindNilBonus: 0,
            blindNilPenalty: 0,
            roundScore: 0,
            newScore: team.score,
        };
    });

    // Count tricks won per team
    completedTricks.forEach((trick: Trick) => {
        if (trick.winnerId) {
            const teamId = playerTeam[trick.winnerId];
            tricksWon[teamId]++;
        }
    });

    // Process nil and blind-nil bids first
    Object.entries(bids).forEach(([playerId, bid]: [string, Bid]) => {
        const teamId = playerTeam[playerId];
        const playerTricks = completedTricks.filter(
            (trick) => trick.winnerId === playerId
        ).length;

        if (bid.type === "nil") {
            if (playerTricks === 0) {
                // Successful nil: +100 points
                scoreBreakdown[teamId].nilBonus += 100;
            } else {
                // Failed nil: -100 points
                scoreBreakdown[teamId].nilPenalty += 100;
                nilSuccess[teamId] = false;
            }
        } else if (bid.type === "blind-nil") {
            if (playerTricks === 0) {
                // Successful blind nil: +200 points
                scoreBreakdown[teamId].blindNilBonus += 200;
            } else {
                // Failed blind nil: -200 points
                scoreBreakdown[teamId].blindNilPenalty += 200;
                nilSuccess[teamId] = false;
            }
        } else if (bid.type === "blind") {
            // Blind bids (non-nil) - add to team total (will be scored at 2x)
            teamBids[teamId] += bid.amount;
        } else {
            // Regular bid - add to team total
            teamBids[teamId] += bid.amount;
        }
    });

    // Update breakdown with bid totals and tricks
    Object.keys(teams).forEach((teamIdStr) => {
        const teamId = Number(teamIdStr);
        scoreBreakdown[teamId].bid = teamBids[teamId];
        scoreBreakdown[teamId].tricksWon = tricksWon[teamId];
    });

    // Score regular and blind bids
    const teamBags: Record<number, number> = {};
    Object.keys(teams).forEach((teamIdStr) => {
        const teamId = Number(teamIdStr);
        const bid = teamBids[teamId];
        const tricks = tricksWon[teamId];
        teamBags[teamId] = 0;

        // Check if any player on this team made a blind bid (non-nil)
        const hasBlindBid = teams[teamId].players.some(
            (pid) => bids[pid]?.type === "blind"
        );

        if (bid > 0) {
            if (tricks >= bid) {
                // Made bid
                const basePoints = bid * 10;
                scoreBreakdown[teamId].basePoints = basePoints;

                // If blind bid, add 2x bonus
                if (hasBlindBid) {
                    scoreBreakdown[teamId].blindBonus = basePoints; // Extra 1x for 2x total
                }

                const bags = tricks - bid;
                scoreBreakdown[teamId].bags = bags;
                scoreBreakdown[teamId].bagPoints = bags; // +1 per bag
                teamBags[teamId] = bags;
            } else {
                // Failed bid
                const basePoints = -(bid * 10);
                scoreBreakdown[teamId].basePoints = basePoints;

                // If blind bid, add 2x penalty
                if (hasBlindBid) {
                    scoreBreakdown[teamId].blindPenalty = -basePoints; // Extra 1x for 2x total
                }
            }
        }

        // Track cumulative bags and apply penalty
        const currentBags = teams[teamId].accumulatedBags + teamBags[teamId];
        if (currentBags >= 10) {
            scoreBreakdown[teamId].bagPenalty = Math.abs(settings.bagsPenalty);
            // Note: The actual bag reset will happen when we update team state
        }
    });

    // Calculate final scores
    const teamScores: Record<number, number> = {};
    Object.keys(teams).forEach((teamIdStr) => {
        const teamId = Number(teamIdStr);
        const breakdown = scoreBreakdown[teamId];

        breakdown.roundScore =
            breakdown.basePoints +
            breakdown.bagPoints +
            breakdown.nilBonus -
            breakdown.nilPenalty +
            breakdown.blindBonus -
            breakdown.blindPenalty +
            breakdown.blindNilBonus -
            breakdown.blindNilPenalty -
            breakdown.bagPenalty;

        breakdown.newScore = breakdown.previousScore + breakdown.roundScore;
        teamScores[teamId] = breakdown.newScore;
    });

    return {
        teamScores,
        bags: teamBags,
        roundDetails: {
            tricksWon,
            bids: teamBids,
            nilSuccess,
        },
        scoreBreakdown,
    };
}
