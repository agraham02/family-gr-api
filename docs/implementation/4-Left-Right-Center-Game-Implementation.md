# Left Right Center (LRC) Game Implementation

## Overview

This document specifies the implementation of Left Right Center (LRC), a simple dice game where players pass chips based on dice rolls until one player remains with chips. Unlike Spades and Dominoes, LRC is a pure luck game with no strategic decisions—making it ideal for casual family play and as a light gambling game.

---

## 1. Game Rules Summary

### Core Mechanics

- **Players**: 3+ (no maximum, but practical limit ~10 for fun)
- **Starting Chips**: Each player begins with 3 chips
- **Dice**: 3 special dice with faces: L, C, R, and 3 dots (or standard d6 mapped: 4=L, 5=C, 6=R, 1/2/3=dot)
- **Turn**: Roll dice equal to chips held (max 3 dice), pass chips per results
- **Win Condition**: Last player with chips wins and takes the center pot

### Dice Actions

| Die Face   | Action                                            |
| ---------- | ------------------------------------------------- |
| L (Left)   | Pass 1 chip to player on your left                |
| R (Right)  | Pass 1 chip to player on your right               |
| C (Center) | Pass 1 chip to the center pot (removed from play) |
| Dot (•)    | Keep chip (no action)                             |

### Key Rules

1. Roll 1 die per chip you have (maximum 3 dice)
2. If you have 0 chips, you skip your turn but remain in the game
3. Chips can be passed to you on others' turns
4. Game ends when exactly one player has chips remaining
5. Winner takes all chips in the center pot

---

## 2. LRC Settings

### New Settings Interface

**File**: `src/games/lrc/types.ts`

```typescript
export interface LRCSettings {
    /**
     * Starting chips per player.
     * Default: 3 (traditional)
     * Range: 1-10
     */
    startingChips: number;

    /**
     * Monetary value per chip in cents (for display purposes).
     * Default: 0 (no money mode)
     * Examples: 25 = $0.25/chip, 100 = $1.00/chip
     * Range: 0-10000 (max $100/chip)
     */
    chipValue: number;

    /**
     * Enable "Wild" variant where one die face steals from any player.
     * Default: false
     * When true: Rolling 3 wilds = instant win
     */
    wildMode: boolean;

    /**
     * Enable "Last Chip Challenge" variant.
     * When you're about to win, you must roll all dots to confirm.
     * Default: false
     */
    lastChipChallenge: boolean;
}
```

### Settings Metadata

```typescript
export const LRCSettingsMetadata: GameSettingsMetadata = {
    startingChips: {
        type: "number",
        label: "Starting Chips",
        description: "Number of chips each player starts with",
        default: 3,
        min: 1,
        max: 10,
    },
    chipValue: {
        type: "number",
        label: "Chip Value (cents)",
        description: "Optional monetary value per chip (0 = no money)",
        default: 0,
        min: 0,
        max: 10000,
    },
    wildMode: {
        type: "boolean",
        label: "Wild Mode",
        description:
            "Add Wild dice that steal from any player (3 Wilds = instant win)",
        default: false,
    },
    lastChipChallenge: {
        type: "boolean",
        label: "Last Chip Challenge",
        description:
            "Winner must roll all dots on their final turn to confirm victory",
        default: false,
    },
};
```

### Default Settings

```typescript
export const DEFAULT_LRC_SETTINGS: LRCSettings = {
    startingChips: 3,
    chipValue: 0,
    wildMode: false,
    lastChipChallenge: false,
};
```

---

## 3. Type Definitions

**File**: `src/games/lrc/types.ts`

### Die Face Enum

```typescript
export type DieFace = "L" | "C" | "R" | "DOT" | "WILD";

export interface DieRoll {
    face: DieFace;
    // For animation purposes on client
    finalValue: number; // 1-6 mapping
}
```

### Player State

```typescript
export interface LRCPlayer {
    odusId: string;
    odusName: string;
    chips: number;
    /** Tracks total chips won (for multi-round play) */
    totalWinnings: number;
    /** Whether player was eliminated (reached 0 chips and game ended) */
    isEliminated: boolean;
}
```

### Action Types

```typescript
export type LRCAction =
    | { type: "ROLL_DICE" }
    | { type: "CONFIRM_RESULTS" } // After viewing dice, confirm to pass chips
    | { type: "PLAY_AGAIN" }; // Start new round with same players
```

### Game Phase

```typescript
export type LRCPhase =
    | "waiting-for-roll" // Current player needs to roll
    | "showing-results" // Dice rolled, showing animation/results
    | "passing-chips" // Animating chip transfers
    | "round-over" // Winner determined
    | "finished"; // Game ended (player left or quit)
```

### Game State

```typescript
export interface LRCState {
    phase: LRCPhase;

    /** All players in seat order (used for left/right passing) */
    players: LRCPlayer[];

    /** Index into players array for current turn */
    currentPlayerIndex: number;

    /** Chips in the center pot */
    centerPot: number;

    /** Current roll results (null if not yet rolled) */
    currentRoll: DieRoll[] | null;

    /** Chip movements from current roll (for animation) */
    chipMovements: ChipMovement[] | null;

    /** Winner's odusId when phase is round-over */
    winnerId: string | null;

    /** Settings snapshot */
    settings: LRCSettings;

    /** Number of completed rounds (for tracking) */
    roundNumber: number;

    /** History of winners per round */
    roundWinners: string[];
}
```

### Chip Movement (for animations)

```typescript
export interface ChipMovement {
    fromPlayerId: string;
    toPlayerId: string | "center"; // 'center' for C rolls
    count: number;
}
```

---

## 4. Game Module Implementation

**File**: `src/games/lrc/index.ts`

### Module Structure

```typescript
import { GameModule } from "../../services/GameManager";
import {
    LRCState,
    LRCAction,
    LRCSettings,
    LRCPlayer,
    DieFace,
    DieRoll,
    ChipMovement,
    DEFAULT_LRC_SETTINGS,
} from "./types";
import {
    rollDice,
    determineTurnOrder,
    findNextPlayerWithChips,
} from "./helpers/dice";
import {
    calculateChipMovements,
    applyChipMovements,
    checkWinCondition,
} from "./helpers/chips";

export const LRCGame: GameModule<LRCState, LRCAction, LRCSettings> = {
    metadata: {
        name: "lrc",
        displayName: "Left Right Center",
        minPlayers: 3,
        maxPlayers: 10,
        settingsMetadata: LRCSettingsMetadata,
        defaultSettings: DEFAULT_LRC_SETTINGS,
        description:
            "A simple dice game where players pass chips left, right, or to the center.",
        estimatedDuration: "10-20 minutes",
        category: "dice",
    },

    init(players, settings) {
        /* ... */
    },
    reducer(state, action, playerId) {
        /* ... */
    },
    getState(state) {
        /* ... */
    },
    getPlayerState(state, odusId) {
        /* ... */
    },
    checkMinimumPlayers(state) {
        /* ... */
    },
};
```

### init() Function

```typescript
init(players: Array<{ odusId: string; odusName: string }>, settings: LRCSettings): LRCState {
  // Determine random turn order (or keep seat order)
  const orderedPlayers = determineTurnOrder(players);

  const lrcPlayers: LRCPlayer[] = orderedPlayers.map(p => ({
    odusId: p.odusId,
    odusName: p.odusName,
    chips: settings.startingChips,
    totalWinnings: 0,
    isEliminated: false,
  }));

  return {
    phase: 'waiting-for-roll',
    players: lrcPlayers,
    currentPlayerIndex: 0,
    centerPot: 0,
    currentRoll: null,
    chipMovements: null,
    winnerId: null,
    settings,
    roundNumber: 1,
    roundWinners: [],
  };
}
```

### reducer() Function - ROLL_DICE Action

```typescript
case 'ROLL_DICE': {
  // Validate it's the current player's turn
  const currentPlayer = state.players[state.currentPlayerIndex];
  if (playerId !== currentPlayer.odusId) {
    return { error: 'Not your turn' };
  }

  // Validate player has chips (should skip if 0)
  if (currentPlayer.chips === 0) {
    return { error: 'You have no chips - turn should have been skipped' };
  }

  // Validate phase
  if (state.phase !== 'waiting-for-roll') {
    return { error: 'Cannot roll now' };
  }

  // Roll dice (1 die per chip, max 3)
  const diceCount = Math.min(currentPlayer.chips, 3);
  const roll = rollDice(diceCount, state.settings.wildMode);

  // Calculate chip movements
  const movements = calculateChipMovements(
    state.players,
    state.currentPlayerIndex,
    roll
  );

  return {
    newState: {
      ...state,
      phase: 'showing-results',
      currentRoll: roll,
      chipMovements: movements,
    }
  };
}
```

### reducer() Function - CONFIRM_RESULTS Action

```typescript
case 'CONFIRM_RESULTS': {
  // Any player can confirm (or auto-confirm after timeout)
  if (state.phase !== 'showing-results') {
    return { error: 'No results to confirm' };
  }

  // Check for Wild instant win (3 wilds)
  if (state.settings.wildMode && state.currentRoll) {
    const wildCount = state.currentRoll.filter(d => d.face === 'WILD').length;
    if (wildCount === 3) {
      const currentPlayer = state.players[state.currentPlayerIndex];
      return {
        newState: {
          ...state,
          phase: 'round-over',
          winnerId: currentPlayer.odusId,
          currentRoll: null,
          chipMovements: null,
        }
      };
    }
  }

  // Apply chip movements
  let updatedPlayers = applyChipMovements(state.players, state.chipMovements!);
  let updatedPot = state.centerPot +
    state.chipMovements!.filter(m => m.toPlayerId === 'center').reduce((sum, m) => sum + m.count, 0);

  // Check win condition
  const winner = checkWinCondition(updatedPlayers);

  if (winner) {
    // Handle Last Chip Challenge variant
    if (state.settings.lastChipChallenge) {
      // TODO: Implement challenge phase
    }

    // Award center pot to winner
    updatedPlayers = updatedPlayers.map(p =>
      p.odusId === winner.odusId
        ? { ...p, chips: p.chips + updatedPot, totalWinnings: p.totalWinnings + updatedPot }
        : p
    );

    return {
      newState: {
        ...state,
        phase: 'round-over',
        players: updatedPlayers,
        centerPot: 0,
        winnerId: winner.odusId,
        currentRoll: null,
        chipMovements: null,
        roundWinners: [...state.roundWinners, winner.odusId],
      }
    };
  }

  // Find next player with chips (or who might receive chips)
  const nextIndex = findNextPlayerWithChips(updatedPlayers, state.currentPlayerIndex);

  return {
    newState: {
      ...state,
      phase: 'waiting-for-roll',
      players: updatedPlayers,
      centerPot: updatedPot,
      currentPlayerIndex: nextIndex,
      currentRoll: null,
      chipMovements: null,
    }
  };
}
```

### getPlayerState() Function

LRC is a fully public game - no hidden information:

```typescript
getPlayerState(state: LRCState, odusId: string): LRCState {
  // All information is public in LRC
  return state;
}
```

### checkMinimumPlayers() Function

```typescript
checkMinimumPlayers(state: LRCState): boolean {
  // LRC needs at least 3 players to function
  const activePlayers = state.players.filter(p => !p.isEliminated);
  return activePlayers.length >= 3;
}
```

---

## 5. Helper Functions

### Dice Helpers

**File**: `src/games/lrc/helpers/dice.ts`

```typescript
/**
 * Roll specified number of LRC dice.
 * Standard dice: 1,2,3 = DOT, 4 = L, 5 = C, 6 = R
 * Wild mode: 1 = WILD, 2,3 = DOT, 4 = L, 5 = C, 6 = R
 */
export function rollDice(count: number, wildMode: boolean): DieRoll[] {
    const rolls: DieRoll[] = [];

    for (let i = 0; i < count; i++) {
        const value = Math.floor(Math.random() * 6) + 1;
        let face: DieFace;

        if (wildMode && value === 1) {
            face = "WILD";
        } else if (value <= 3) {
            face = "DOT";
        } else if (value === 4) {
            face = "L";
        } else if (value === 5) {
            face = "C";
        } else {
            face = "R";
        }

        rolls.push({ face, finalValue: value });
    }

    return rolls;
}

/**
 * Shuffle players for random turn order (optional - can use seat order).
 */
export function determineTurnOrder<T>(players: T[]): T[] {
    // Simple shuffle using Fisher-Yates
    const shuffled = [...players];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Find the next player who should roll.
 * Players with 0 chips are skipped but remain in game.
 * Returns index that wraps around the player array.
 */
export function findNextPlayerWithChips(
    players: LRCPlayer[],
    currentIndex: number
): number {
    const count = players.length;
    let nextIndex = (currentIndex + 1) % count;
    let checked = 0;

    // Find next player with chips, or wrap all the way around
    while (players[nextIndex].chips === 0 && checked < count) {
        nextIndex = (nextIndex + 1) % count;
        checked++;
    }

    // If all players have 0 chips except winner, game should have ended
    // This shouldn't happen, but return next index anyway
    return nextIndex;
}
```

### Chip Helpers

**File**: `src/games/lrc/helpers/chips.ts`

```typescript
/**
 * Calculate chip movements based on dice roll.
 * Uses player array order to determine left/right neighbors.
 */
export function calculateChipMovements(
    players: LRCPlayer[],
    rollerIndex: number,
    roll: DieRoll[]
): ChipMovement[] {
    const movements: ChipMovement[] = [];
    const roller = players[rollerIndex];
    const count = players.length;

    // Indices for neighbors (wrap around)
    const leftIndex = (rollerIndex - 1 + count) % count;
    const rightIndex = (rollerIndex + 1) % count;

    for (const die of roll) {
        switch (die.face) {
            case "L":
                movements.push({
                    fromPlayerId: roller.odusId,
                    toPlayerId: players[leftIndex].odusId,
                    count: 1,
                });
                break;
            case "R":
                movements.push({
                    fromPlayerId: roller.odusId,
                    toPlayerId: players[rightIndex].odusId,
                    count: 1,
                });
                break;
            case "C":
                movements.push({
                    fromPlayerId: roller.odusId,
                    toPlayerId: "center",
                    count: 1,
                });
                break;
            case "WILD":
                // Wild movement is handled differently - roller chooses target
                // For now, auto-select player with most chips (excluding self)
                const targetIndex = findPlayerWithMostChips(
                    players,
                    rollerIndex
                );
                if (targetIndex !== -1) {
                    movements.push({
                        fromPlayerId: players[targetIndex].odusId,
                        toPlayerId: roller.odusId,
                        count: 1,
                    });
                }
                break;
            case "DOT":
                // No movement
                break;
        }
    }

    return movements;
}

/**
 * Apply chip movements to create updated player array.
 * Returns new array (immutable).
 */
export function applyChipMovements(
    players: LRCPlayer[],
    movements: ChipMovement[]
): LRCPlayer[] {
    // Create mutable copy with chip deltas
    const chipDeltas = new Map<string, number>();
    players.forEach((p) => chipDeltas.set(p.odusId, 0));

    for (const move of movements) {
        // Decrease from sender
        const currentFrom = chipDeltas.get(move.fromPlayerId) || 0;
        chipDeltas.set(move.fromPlayerId, currentFrom - move.count);

        // Increase to receiver (unless center)
        if (move.toPlayerId !== "center") {
            const currentTo = chipDeltas.get(move.toPlayerId) || 0;
            chipDeltas.set(move.toPlayerId, currentTo + move.count);
        }
    }

    // Apply deltas
    return players.map((p) => ({
        ...p,
        chips: p.chips + (chipDeltas.get(p.odusId) || 0),
    }));
}

/**
 * Check if exactly one player has chips remaining.
 * Returns winner or null if game continues.
 */
export function checkWinCondition(players: LRCPlayer[]): LRCPlayer | null {
    const playersWithChips = players.filter((p) => p.chips > 0);

    if (playersWithChips.length === 1) {
        return playersWithChips[0];
    }

    return null;
}

/**
 * Find player with most chips (for Wild dice targeting).
 * Excludes the roller from selection.
 */
function findPlayerWithMostChips(
    players: LRCPlayer[],
    excludeIndex: number
): number {
    let maxChips = 0;
    let maxIndex = -1;

    players.forEach((p, i) => {
        if (i !== excludeIndex && p.chips > maxChips) {
            maxChips = p.chips;
            maxIndex = i;
        }
    });

    return maxIndex;
}
```

---

## 6. Registration

### Register in GameManager

**File**: `src/services/GameManager.ts`

Add LRC to the game registry:

```typescript
import { LRCGame } from "../games/lrc";

// In the games map
const games = new Map<string, GameModule>([
    ["spades", SpadesGame],
    ["dominoes", DominoesGame],
    ["lrc", LRCGame],
]);
```

### Add to Room Model

**File**: `src/models/Room.ts`

Update the game type and settings:

```typescript
export type GameType = "spades" | "dominoes" | "lrc";

export type GameSettings = SpadesSettings | DominoesSettings | LRCSettings;
```

---

## 7. Client Implementation

### Type Definitions

**File**: `src/types/games/lrc/index.ts`

```typescript
export interface LRCData {
    phase:
        | "waiting-for-roll"
        | "showing-results"
        | "passing-chips"
        | "round-over"
        | "finished";
    players: LRCPlayerData[];
    currentPlayerId: string;
    centerPot: number;
    currentRoll: DieRollData[] | null;
    chipMovements: ChipMovementData[] | null;
    winnerId: string | null;
    settings: LRCSettingsData;
    roundNumber: number;
}

export interface LRCPlayerData {
    odusId: string;
    odusName: string;
    chips: number;
    isMe: boolean;
    isCurrent: boolean;
}

export interface DieRollData {
    face: "L" | "C" | "R" | "DOT" | "WILD";
    finalValue: number;
}

export interface ChipMovementData {
    fromPlayerId: string;
    toPlayerId: string | "center";
    count: number;
}

export interface LRCSettingsData {
    startingChips: number;
    chipValue: number;
    wildMode: boolean;
    lastChipChallenge: boolean;
}
```

### Main Component Structure

**File**: `src/components/games/lrc/index.tsx`

```
lrc/
├── index.tsx           # Main game container
├── DiceArea.tsx        # Dice display and roll button
├── PlayerCircle.tsx    # Circular player arrangement
├── PlayerChips.tsx     # Individual player chip display
├── CenterPot.tsx       # Center pot chip pile
├── ChipAnimation.tsx   # Animated chip movement
├── RoundOverModal.tsx  # Winner announcement
└── WinningsDisplay.tsx # Monetary value display (optional)
```

### Key UI Components

#### DiceArea Component

Displays the three dice with roll animation:

- Show "Roll" button when it's player's turn
- Animate dice rolling (tumbling animation)
- Reveal final faces with distinct L/R/C/DOT/WILD icons
- Display result summary text ("Pass 1 left, 1 to center, keep 1")

#### PlayerCircle Component

Arrange players in a circle for clear left/right visualization:

- Current player highlighted
- Chip count displayed next to each player
- Arrows or indicators showing L/R direction
- Visual distinction for players with 0 chips (grayed out but not eliminated)

#### ChipAnimation Component

Animate chip movements between players:

- Use Framer Motion for smooth transitions
- Show chip flying from source to destination
- Stack animations for multiple chips
- Special animation for center pot additions

#### CenterPot Component

Display accumulated center pot:

- Show chip pile with count
- If `chipValue > 0`, display monetary value
- Visual emphasis (glow, size) as pot grows

#### RoundOverModal Component

Announce winner and show summary:

- Winner name with celebration animation
- Total chips/money won
- "Play Again" and "Return to Lobby" buttons
- Round history if multiple rounds played

### Monetary Value Display

When `chipValue > 0`, show money:

- Format as currency (e.g., "$0.75" for 75 cents, 3 chips at 25¢ each)
- Show "You're up $2.00" or "You're down $1.50" relative to starting
- Calculate winnings: `(currentChips - startingChips) * chipValue / 100`

---

## 8. Socket Events

### Client → Server Events

```typescript
// Roll the dice (current player only)
socket.emit("game-action", {
    type: "ROLL_DICE",
});

// Confirm dice results (anyone, or auto after timeout)
socket.emit("game-action", {
    type: "CONFIRM_RESULTS",
});

// Play another round
socket.emit("game-action", {
    type: "PLAY_AGAIN",
});
```

### Server → Client Events

Standard `room:update` and `game:update` events with LRC state.

### Auto-Confirm Timeout

Implement server-side timeout for confirming results:

- After showing dice results for 3 seconds, auto-confirm
- This keeps the game moving smoothly
- Player can manually confirm earlier by clicking "Continue"

---

## 9. Game Flow State Machine

```
┌──────────────────────────────────────────────────────────────┐
│                         GAME FLOW                             │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   init() ──► waiting-for-roll                                │
│                    │                                         │
│                    │ ROLL_DICE (current player)              │
│                    ▼                                         │
│              showing-results                                 │
│                    │                                         │
│                    │ CONFIRM_RESULTS (or auto after 3s)      │
│                    ▼                                         │
│              [Check Win Condition]                           │
│                   /    \                                     │
│                  /      \                                    │
│            Winner      No Winner                             │
│               │           │                                  │
│               ▼           │                                  │
│          round-over       │                                  │
│             /   \         │                                  │
│            /     \        │                                  │
│     PLAY_AGAIN  Return    └──► waiting-for-roll              │
│         │       to Lobby        (next player's turn)         │
│         ▼                                                    │
│   (Reset state)                                              │
│         │                                                    │
│         └──────────────► waiting-for-roll                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 10. Edge Cases & Validation

### Player Has 0 Chips

- Player skips their roll turn but remains in the game
- `findNextPlayerWithChips()` handles skipping
- Player can still receive chips from others' L or R rolls
- Visual: Gray out player but don't show as "eliminated"

### All Players Reach 0 Chips

- Impossible scenario because chips only move between players or to center
- If somehow reached, check for game bug

### Player Disconnects

- Handle via existing reconnection logic
- If player's turn: Skip after timeout, continue game
- Chips remain with disconnected player (can receive chips from others)
- If player was winner: Still announce winner

### Wild Mode: Choosing Target

- **Simple approach**: Auto-select player with most chips
- **Advanced approach**: Let roller choose from dropdown (adds action type)
- Recommendation: Start with auto-select for simplicity

### Last Chip Challenge Variant

When enabled and a player would win:

1. Player enters `last-chip-challenge` phase
2. Player rolls dice equal to their chip count (max 3)
3. If ALL dice show DOT: Player wins
4. If ANY dice show L/R/C/WILD: Pass chips normally, game continues

---

## 11. Implementation Order

### Phase 1: Core Game (MVP)

1. Create type definitions in `src/games/lrc/types.ts`
2. Implement helper functions in `src/games/lrc/helpers/`
3. Implement game module in `src/games/lrc/index.ts`
4. Register in GameManager and Room model
5. Add to game registry on client

### Phase 2: Basic UI

1. Create `LRCData` and `LRCPlayerData` client types
2. Build PlayerCircle layout component
3. Build DiceArea with roll button
4. Build CenterPot display
5. Implement basic chip count display
6. Build RoundOverModal

### Phase 3: Animations

1. Add dice rolling animation (tumble effect)
2. Add chip movement animations (Framer Motion)
3. Add center pot visual effects
4. Add winner celebration animation

### Phase 4: Variants & Polish

1. Implement Wild mode dice face and targeting
2. Implement Last Chip Challenge variant
3. Add monetary value display
4. Add sound effects integration points

---

## 12. Testing Scenarios

### Scenario 1: Basic 3-Player Game

- 3 players, 3 chips each, 9 total chips
- Play until 1 winner
- Verify chip totals always equal 9 minus center pot

### Scenario 2: Player Runs Out of Chips

- Player loses all chips
- Verify player is skipped on subsequent turns
- Verify player can receive chips from L/R rolls
- Verify player resumes rolling when chips received

### Scenario 3: Quick Win

- Test case where winner determined in few rounds
- Verify center pot awarded to winner

### Scenario 4: Wild Mode

- Test wild die face stealing mechanism
- Test 3-wilds instant win condition

### Scenario 5: Reconnection

- Player disconnects mid-game
- Verify game continues
- Verify player can rejoin and resume

---

## 13. File Structure Summary

```
family-gr-api/
└── src/
    └── games/
        └── lrc/
            ├── index.ts          # GameModule implementation
            ├── types.ts          # All type definitions
            └── helpers/
                ├── dice.ts       # Dice rolling, turn order
                └── chips.ts      # Chip movements, win condition

family-gr-client/
└── src/
    ├── types/
    │   └── games/
    │       └── lrc/
    │           └── index.ts      # Client type definitions
    └── components/
        └── games/
            └── lrc/
                ├── index.tsx          # Main container
                ├── DiceArea.tsx       # Dice display/roll
                ├── PlayerCircle.tsx   # Player arrangement
                ├── PlayerChips.tsx    # Chip display
                ├── CenterPot.tsx      # Center pot
                ├── ChipAnimation.tsx  # Movement animations
                ├── RoundOverModal.tsx # Winner modal
                └── WinningsDisplay.tsx # Money display
```

---

## 14. Notes

### Why LRC is Unique

- **No strategy**: Pure luck game, no decisions to make
- **No hidden info**: All chips visible to everyone
- **Variable length**: Can end quickly or drag on
- **Scalable players**: Works with 3-10+ players

### Design Decisions

1. **Circular layout**: Essential for visualizing L/R direction
2. **Auto-confirm**: Keep pace moving (3s delay)
3. **Simple Wild targeting**: Auto-select richest player
4. **Money as optional**: Core game works without chip value

### Performance Considerations

- LRC state is simple and small
- Animations should be lightweight
- Consider throttling for many players (10+)
