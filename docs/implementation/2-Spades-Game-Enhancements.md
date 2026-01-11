# 2. Spades Game Enhancements

## Overview

This document provides precise implementation details for enhancing the Spades game with proper bidding mechanics (Nil, Blind Nil, Blind Bids), improved UI/UX for trick play, end-of-round/game screens, and deck variants (Jokers, Deuce of Spades High).

---

## Current State Analysis

### Existing Bid System (`src/games/spades/index.ts`)

**Bid Interface** (`types.ts`):

```typescript
type BidType = "normal" | "nil";
interface Bid {
    amount: number;
    type: BidType;
}
```

**Current Limitations**:

1. `BidType` only supports "normal" and "nil" - no blind variants
2. Nil scoring exists in `score.ts` but UI doesn't support nil bidding properly
3. Blind nil setting exists (`blindNilEnabled`) but logic is incomplete
4. No blind bid (non-nil) support
5. No enforcement of "100+ points behind" requirement for blind bids

### Existing Scoring (`src/games/spades/helpers/score.ts`)

**Nil Scoring** (already implemented):

- Successful nil: +100 points
- Failed nil: -100 points
- Nil player's tricks don't count toward partner's bid

**Missing**:

- Blind nil scoring (+200/-200)
- Blind bid scoring (double points)
- Tracking which player has which bid type for UI display

### Existing Card Ranking (`src/games/spades/helpers/card.ts`)

**Current Ranking**:

```typescript
RANK_ORDER: [
    Two,
    Three,
    Four,
    Five,
    Six,
    Seven,
    Eight,
    Nine,
    Ten,
    Jack,
    Queen,
    King,
    Ace,
];
```

**cardBeats Function**:

- Compares within same suit by rank order
- Spades trump all other suits

**Missing**:

- Joker cards
- Deuce of Spades High variant
- Dynamic ranking based on settings

---

## Target Architecture

### 1. Extended Bid Types

#### File: `src/games/spades/types.ts`

**Updated BidType**:

```
"normal" | "nil" | "blind-nil" | "blind"
```

| Type        | Description                          | Requirement                          | Success        | Failure         |
| ----------- | ------------------------------------ | ------------------------------------ | -------------- | --------------- |
| `normal`    | Standard bid (1-13 tricks)           | None                                 | bid × 10       | -(bid × 10)     |
| `nil`       | Zero tricks, see cards first         | `allowNil` enabled                   | +100           | -100            |
| `blind-nil` | Zero tricks, bid before seeing cards | `blindNilEnabled` + team 100+ behind | +200           | -200            |
| `blind`     | 4-13 tricks, bid before seeing cards | `blindBidEnabled` + team 100+ behind | 2 × (bid × 10) | -2 × (bid × 10) |

**Updated Bid Interface**:

```typescript
interface Bid {
    amount: number;
    type: BidType;
    isBlind: boolean; // True for blind-nil and blind types
}
```

### 2. Extended Card Types (Jokers)

#### File: `src/games/spades/types.ts`

**Updated Rank Enum**:

```typescript
enum Rank {
    // Standard ranks
    Two = "2",
    Three = "3",
    // ... existing ...
    Ace = "A",
    // Joker ranks (only used when jokersEnabled)
    LittleJoker = "LJ",
    BigJoker = "BJ",
}
```

**Card Interface** (unchanged but now supports joker ranks):

```typescript
interface Card {
    rank: Rank;
    suit: Suit; // For jokers, suit is Suit.Spades (treated as trump)
}
```

### 3. Game State Extensions

#### File: `src/games/spades/index.ts`

**SpadesState Additions**:

| Property               | Type                      | Description                                 |
| ---------------------- | ------------------------- | ------------------------------------------- |
| `blindBidPhase`        | `boolean`                 | True during initial blind bid window        |
| `blindBidsOffered`     | `Record<string, boolean>` | Which players were offered blind bid option |
| `blindBidsDeclined`    | `Record<string, boolean>` | Which players declined blind bidding        |
| `teamEligibleForBlind` | `Record<number, boolean>` | Calculated: team is 100+ points behind      |
| `accumulatedBags`      | `Record<number, number>`  | Cumulative bags per team (for bag penalty)  |

**SpadesSettings Additions**:

| Property            | Type      | Default | Description                    |
| ------------------- | --------- | ------- | ------------------------------ |
| `jokersEnabled`     | `boolean` | `false` | Include Big/Little Joker       |
| `deuceOfSpadesHigh` | `boolean` | `false` | 2♠ ranks highest among spades |
| `blindBidEnabled`   | `boolean` | `false` | Allow blind bids (non-nil)     |

### 4. Bidding Flow Redesign

#### New Phase: `blind-bidding`

**Phase Sequence**:

```
"blind-bidding" → "bidding" → "playing" → "trick-result" → ... → "round-summary" → repeat
```

**Blind Bidding Phase Logic**:

1. At round start, check each team's eligibility (100+ points behind leader)
2. For eligible teams, offer blind bid option to each player before dealing cards
3. Player choices:
    - **Accept Blind Nil**: Commit to blind nil (if `blindNilEnabled`)
    - **Accept Blind Bid**: Commit to blind bid, specify amount 4-13 (if `blindBidEnabled`)
    - **Decline**: See cards and bid normally
4. Once all players on eligible teams have chosen, deal cards
5. Blind bidders submit their bid amount (if not already specified)
6. Regular bidding phase for players who declined blind

**Implementation Approach**:

For simplicity, combine into single bidding phase with UI state management:

1. Before showing cards to player, check if blind bid is available
2. Display blind bid modal with options
3. If player chooses blind bid, record choice and allow bid submission without seeing cards
4. If player declines, reveal cards and proceed to normal bid
5. Track `hasSeenCards: Record<string, boolean>` in state

#### Revised Bidding Reducer

**PLACE_BID Action Enhanced**:

Payload:

```typescript
{
    bid: Bid;  // { amount, type, isBlind }
    declineBlind?: boolean;  // True if player explicitly declined blind option
}
```

Validation Rules:

1. If `bid.type === "blind-nil"`:
    - Require `blindNilEnabled === true`
    - Require player's team is 100+ behind
    - Require `amount === 0`
2. If `bid.type === "blind"`:
    - Require `blindBidEnabled === true`
    - Require player's team is 100+ behind
    - Require `amount >= 4`
3. If `bid.type === "nil"`:
    - Require `allowNil === true`
    - Require `amount === 0`
4. Standard validation for normal bids

### 5. Scoring Updates

#### File: `src/games/spades/helpers/score.ts`

**Bid Scoring Matrix**:

| Bid Type          | Made                | Failed        |
| ----------------- | ------------------- | ------------- |
| Normal (N tricks) | N × 10 + bags       | -(N × 10)     |
| Nil               | +100                | -100          |
| Blind Nil         | +200                | -200          |
| Blind (N tricks)  | 2 × (N × 10) + bags | -2 × (N × 10) |

**Updated ScoreResult Interface**:

Add to `TeamScoreBreakdown`:

```typescript
blindBonus: number; // Extra points from successful blind bid
blindPenalty: number; // Extra penalty from failed blind bid
blindNilBonus: number; // +200 for successful blind nil
blindNilPenalty: number; // -200 for failed blind nil
```

**Accumulated Bags Tracking**:

Move bag penalty calculation to use `state.accumulatedBags`:

1. After each round, add new bags to accumulated total
2. Apply -100 penalty when accumulated bags >= 10
3. Reset accumulated bags to `(accumulated - 10)` after penalty

**Team Eligibility Calculation**:

Function: `calculateTeamEligibility(teams: Record<number, Team>): Record<number, boolean>`

Logic:

1. Find highest team score
2. For each team: `eligible = (highestScore - team.score) >= 100`

### 6. Deck Building with Jokers

#### File: `src/games/spades/helpers/card.ts`

**buildDeck Function Update**:

Parameters:

```typescript
function buildDeck(settings: SpadesSettings): Card[];
```

Logic:

1. If `jokersEnabled === false`: Return standard 52-card deck
2. If `jokersEnabled === true`:
    - Build 52-card deck
    - Remove 2♣ and 2♦ (keep 2♠ and 2♥)
    - Add Big Joker (rank: BigJoker, suit: Spades)
    - Add Little Joker (rank: LittleJoker, suit: Spades)
    - Result: 52 cards

**Card Ranking with Variants**:

Function: `getCardRankValue(card: Card, settings: SpadesSettings): number`

Base ranking (Spades):

```
Standard: 2, 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A
With Jokers: 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A, 2♠, LJ, BJ
With Deuce High (no jokers): 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A, 2♠
With Both: 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A, 2♠, LJ, BJ
```

**Updated cardBeats Function**:

Parameters:

```typescript
function cardBeats(
    a: Card,
    b: Card,
    led: Suit,
    settings: SpadesSettings
): boolean;
```

Logic:

1. Handle jokers first:
    - Big Joker beats everything
    - Little Joker beats everything except Big Joker
2. Handle Deuce of Spades High:
    - If `deuceOfSpadesHigh` and card is 2♠, treat as rank above Ace
3. Apply standard comparison logic

### 7. Trick Resolution Updates

#### File: `src/games/spades/helpers/player.ts`

**resolveTrick Function Update**:

Parameters:

```typescript
function resolveTrick(trick: Trick, settings: SpadesSettings): string;
```

Pass settings to enable correct ranking comparison.

### 8. Client Updates

#### Type Updates

**File: `src/types/games/spades/index.ts`**

Add:

- `BidType` with all four values
- `Rank` enum with joker values
- `SpadesSettings` with new properties
- `SpadesData` with new state properties

#### Bid Modal Redesign

**File: `src/components/games/spades/ui/PlaceBidModal.tsx`**

**New Structure**:

```
BlindBidDecisionModal (shown first if eligible)
├── Option: "Bid Blind" → opens BlindBidAmountModal
├── Option: "Bid Blind Nil" → submits immediately
└── Option: "See My Cards" → closes, reveals cards, opens standard modal

PlaceBidModal (standard)
├── Nil option (if allowNil && !alreadyBidBlind)
├── Normal bid slider (1-13)
└── Submit button
```

**BlindBidDecisionModal Component** (NEW):

Props:

- `isOpen: boolean`
- `canBlindNil: boolean` (team eligible + setting enabled)
- `canBlindBid: boolean` (team eligible + setting enabled)
- `onChooseBlindNil: () => void`
- `onChooseBlindBid: () => void`
- `onDecline: () => void`

Visual Design:

- Dark modal with dramatic styling (high stakes decision)
- Clear explanation of blind bid mechanics
- Team score difference shown ("Your team is 150 points behind")
- Point values displayed for each option

**BlindBidAmountModal Component** (NEW):

Props:

- `isOpen: boolean`
- `onSubmit: (amount: number) => void`
- `onCancel: () => void`

Constraints:

- Minimum bid: 4
- Maximum bid: 13
- Slider or number buttons

**PlaceBidModal Updates**:

Add Nil button:

- Only shown if `allowNil === true`
- Disabled if player already chose blind option
- Click submits `{ amount: 0, type: "nil", isBlind: false }`

#### Cards Display with Jokers

**File: `src/components/games/spades/ui/PlayingCard.tsx`** (or equivalent)

Updates:

- Handle `rank === "BJ"` and `rank === "LJ"`
- Display joker artwork/icon
- Jokers styled distinctly (larger, glowing border, etc.)

#### Round Summary Modal Enhancements

**File: `src/components/games/spades/ui/RoundSummaryModal.tsx`**

**Current Display**:

- Team scores
- Round score change
- Player bids and tricks won

**Enhanced Display**:

Add breakdown sections:

```
Team 1 Round Score: +120
├── Bid Made (6 × 10):     +60
├── Overtricks (2 bags):    +2
├── Nil Bonus:              +0
├── Blind Bid Bonus:       +60  (doubled for blind)
├── Bag Penalty:            -0
└── Total:                +122

Accumulated Bags: 7/10
```

Visual improvements:

- Animated score counters
- Color-coded positive/negative changes
- Highlight blind bid achievements

#### Game Summary Modal (NEW)

**File: `src/components/games/spades/ui/GameSummaryModal.tsx`**

**Trigger**: `phase === "finished"`

**Display Sections**:

1. **Winner Announcement**
    - Winning team with celebration animation
    - Final scores comparison
    - "Team 1 Wins!" or "It's a Tie!"

2. **Game Statistics**

    ```
    Rounds Played: 8
    Final Scores: Team 1: 520 | Team 2: 385

    Team 1 Stats:
    ├── Total Tricks Won: 52
    ├── Nil Attempts: 2 (1 successful)
    ├── Blind Bids: 1 (successful)
    ├── Bags Accumulated: 12
    └── Bag Penalties: 1 (-100)

    MVP: PlayerName (32 tricks won, 2 successful nils)
    ```

3. **Round-by-Round Breakdown** (collapsible)
    - Table showing scores after each round
    - Notable events (nil success/fail, blind bid, bag penalty)

4. **Actions**
    - "Return to Lobby" button
    - "Play Again" button (starts new game with same settings)

### 9. Optimistic Updates

#### File: `src/lib/gameReducers.ts`

**Update `optimisticSpadesPlaceBid`**:

Handle all bid types:

1. Validate bid type against settings
2. Update `bids` map with full bid object
3. Calculate next turn index
4. Check if all bids placed to transition phase

No optimistic update for blind bid decision (handled via modal state, not game state).

### 10. Trick Play Visualization

#### Current Implementation Issues

1. Cards played don't animate smoothly to center
2. Trick winner not clearly highlighted
3. Winning card not emphasized during trick-result phase

#### Improvements

**SpadesGameTable.tsx Updates**:

1. **Card Play Animation**:
    - Cards animate from player position to center trick area
    - Use Framer Motion with spring physics
    - Stagger animation timing for sequential plays

2. **Trick Result Phase**:
    - Highlight winning card with glow effect
    - Show winner's name badge above winning card
    - Dim losing cards slightly
    - 3-second pause before next trick

3. **Turn Indicator**:
    - Pulse animation on current player's area
    - "Your Turn" badge for local player
    - Timer countdown if `turnTimeLimit` is set

4. **Spades Broken Indicator**:
    - Visual indicator when spades can now be led
    - Brief animation on first spade play

---

## Implementation Order

### Phase 1: Core Bid Types

1. Update `types.ts` with new BidType values
2. Update `Bid` interface with `isBlind` property
3. Update `handlePlaceBid` to validate new bid types
4. Update `calculateSpadesScores` for blind scoring

### Phase 2: Blind Bidding UI

1. Create `BlindBidDecisionModal` component
2. Create `BlindBidAmountModal` component
3. Update `PlaceBidModal` with Nil option
4. Update main Spades component for blind bid flow

### Phase 3: Jokers Variant

1. Update `Rank` enum with joker values
2. Update `buildDeck` for joker variant
3. Update `cardBeats` for joker ranking
4. Update `resolveTrick` to pass settings
5. Update client card display for jokers

### Phase 4: Deuce of Spades High

1. Update `getCardRankValue` function
2. Update `cardBeats` for deuce high ranking
3. Add setting toggle to GameSettingsCard

### Phase 5: Enhanced UI

1. Update RoundSummaryModal with detailed breakdown
2. Create GameSummaryModal for finished phase
3. Add trick play animations
4. Add turn indicators and timers

### Phase 6: Accumulated Bags

1. Add `accumulatedBags` to SpadesState
2. Update scoring to use accumulated bags
3. Display accumulated bags in UI

---

## File Change Summary

### API (family-gr-api)

| File                                 | Action | Changes                                            |
| ------------------------------------ | ------ | -------------------------------------------------- |
| `src/games/spades/types.ts`          | MODIFY | Add BidType values, Rank enum for jokers           |
| `src/games/spades/index.ts`          | MODIFY | Add state properties, update init/reducer          |
| `src/games/spades/helpers/card.ts`   | MODIFY | Update buildDeck, cardBeats, add ranking functions |
| `src/games/spades/helpers/player.ts` | MODIFY | Update resolveTrick signature                      |
| `src/games/spades/helpers/score.ts`  | MODIFY | Add blind scoring, accumulated bags                |

### Client (family-gr-client)

| File                                                       | Action | Changes                                       |
| ---------------------------------------------------------- | ------ | --------------------------------------------- |
| `src/types/games/spades/index.ts`                          | MODIFY | Add types for new bid types, settings, jokers |
| `src/components/games/spades/index.tsx`                    | MODIFY | Add blind bid flow, game summary              |
| `src/components/games/spades/ui/PlaceBidModal.tsx`         | MODIFY | Add nil button, styling updates               |
| `src/components/games/spades/ui/BlindBidDecisionModal.tsx` | CREATE | Blind bid choice modal                        |
| `src/components/games/spades/ui/BlindBidAmountModal.tsx`   | CREATE | Blind bid amount selector                     |
| `src/components/games/spades/ui/GameSummaryModal.tsx`      | CREATE | End of game summary                           |
| `src/components/games/spades/ui/RoundSummaryModal.tsx`     | MODIFY | Enhanced breakdown display                    |
| `src/components/games/spades/ui/SpadesGameTable.tsx`       | MODIFY | Animations, turn indicators                   |
| `src/components/games/spades/ui/PlayingCard.tsx`           | MODIFY | Joker display support                         |
| `src/lib/gameReducers.ts`                                  | MODIFY | Update optimistic bid handler                 |

---

## Edge Cases

### Blind Bidding

1. **Both partners want blind bid**
    - Allow both to bid blind independently
    - Each gets their own blind bonus/penalty

2. **Player refreshes during blind decision**
    - Store `blindBidOffered` and `hasSeenCards` in state
    - On rejoin, restore to correct phase

3. **Team becomes eligible mid-game**
    - Recalculate eligibility at start of each round
    - Only newly eligible teams get blind option

4. **Both teams eligible**
    - Each team can independently choose blind bids
    - Order: Non-dealer team bids first (standard Spades)

### Jokers

1. **Leading with joker**
    - Jokers count as spades for follow-suit purposes
    - Leading joker = leading spades (requires spades broken or all spades)

2. **Following with joker**
    - When spades led, joker is valid follow
    - When other suit led, playing joker = trumping

3. **Sorting hand with jokers**
    - Jokers sorted at top of spades suit
    - Order: Big Joker, Little Joker, then rest of spades

### Deuce of Spades High

1. **Ranking clarification**
    - Without jokers: 2♠ > A♠ > K♠ > ... > 3♠
    - With jokers: BJ > LJ > 2♠ > A♠ > K♠ > ... > 3♠

2. **Display in hand**
    - 2♠ sorted after Ace when high
    - Visual indicator that 2♠ is special (crown icon, etc.)

### Nil Bids

1. **Nil tricks counting**
    - Tricks won by nil bidder do NOT count toward partner's bid
    - Tricks won by nil bidder DO count as bags for team

2. **Both partners bid nil**
    - Each scored independently
    - Partner's bid is 0, so no "making bid" points from tricks

3. **Nil + Blind in same team**
    - Partner bids blind 6, other bids nil
    - Nil player must take 0 tricks
    - Blind bidder must take 6 tricks
    - Each scored by their own rules

### Scoring Precision

1. **Tie at or above win target**
    - Both teams hit 500+ with same score
    - Current: Mark as tie
    - Proper: Play additional rounds until tie broken

2. **Negative scores**
    - Allow negative team scores
    - No floor at 0

3. **Round limit interaction**
    - If round limit reached, highest score wins
    - Ties possible (no overtime for round limit)
