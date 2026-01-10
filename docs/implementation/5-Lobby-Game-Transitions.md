# Lobby & Game Session Management Implementation

## Overview

This document specifies improvements to the lobby and game session management system, ensuring fluid transitions between lobby and game states, graceful handling of player disconnections/reconnections, and intuitive user flows for all scenarios.

---

## 1. Current State Analysis

### What's Already Implemented

**API (RoomService.ts)**:

- `registerSocketUser()` - handles socket connections, rejoin detection
- `isActiveGame()` - helper to check if room has an active game
- Pause/resume logic triggered by player disconnection/reconnection
- Reconnection timeout timers with configurable duration
- `game_aborted` event when timeout expires
- Basic spectator list (`room.spectators`)
- Socket-to-user and user-to-socket mappings

**Client**:

- `useRoomEvents` hook for centralized event handling
- `GameInProgressBanner` component showing active game status in lobby
- `GamePausedOverlay` for when game is paused
- `useGameDirectURLRecovery` hook for direct game URL access
- Session context with localStorage persistence
- Player name modal for new/recovered sessions

### Current Gaps

1. **No explicit "return to lobby" flow** - Players can't gracefully leave a game to lobby
2. **Spectator-to-player slot claiming** - Partially implemented but inconsistent
3. **No visual indication of game state in lobby** - Beyond the basic banner
4. **Inconsistent ready system** - Ready states don't reset properly in all scenarios
5. **No clear game-in-progress player list** - Lobby doesn't show who's in the game

---

## 2. Room State Model

### Enhanced Room States

The room should have clear, distinct states:

```typescript
export type RoomState =
    | "lobby" // Default: players gathering, configuring settings
    | "in-game" // Active game session
    | "post-game"; // Brief transition state after game ends (optional)
```

### Room Sub-States

Within `in-game`, add sub-state tracking:

```typescript
export interface Room {
    // ... existing fields ...

    state: RoomState;

    /** Game pause status - already exists */
    isPaused: boolean;

    /** List of user IDs currently in the active game (not spectators) */
    gamePlayerIds: string[];

    /** List of user IDs who started the game (for rejoin eligibility) */
    originalGamePlayerIds: string[];
}
```

---

## 3. Player Position Tracking

### User Position States

A user in the room can be in one of these positions:

```typescript
type UserPosition = "lobby-only" | "in-game" | "spectating";
```

**Position Logic**:

- `lobby-only`: User is in the room but not participating in the current game
- `in-game`: User is an active player in the current game
- `spectating`: User is watching the game as a spectator

### Computing Position

Add utility function to determine user position:

```typescript
function getUserPosition(room: Room, userId: string): UserPosition {
    if (!isActiveGame(room)) {
        return "lobby-only";
    }

    if (room.spectators?.includes(userId)) {
        return "spectating";
    }

    if (room.gamePlayerIds?.includes(userId)) {
        return "in-game";
    }

    return "lobby-only";
}
```

---

## 4. Lobby → Game Transitions

### 4.1 Starting a New Game

**Current Flow**:

1. Leader clicks "Start Game"
2. Server validates ready states and team assignments
3. Server initializes game state
4. Server emits `game_started` event
5. All clients navigate to `/game/[code]`

**Improvements**:

1. **Clear game player list on start**:

    ```typescript
    function startGame(roomId: string, userId: string) {
        const room = getRoom(roomId);

        // ... existing validation ...

        // Track who started the game
        room.gamePlayerIds = room.users.map((u) => u.id);
        room.originalGamePlayerIds = [...room.gamePlayerIds];

        // Clear spectators from previous game
        room.spectators = [];

        // Initialize game...
    }
    ```

2. **Reset ready states after game ends**:
    ```typescript
    function endGame(roomId: string) {
        const room = getRoom(roomId);

        room.state = "lobby";
        room.gameId = null;
        room.gamePlayerIds = [];
        // Keep originalGamePlayerIds for reference

        // Reset all ready states
        room.users.forEach((user) => {
            room.readyStates[user.id] = false;
        });

        emitRoomEvent(room, "game_ended");
    }
    ```

### 4.2 Joining an Active Game (Rejoin)

**Scenario**: Player was disconnected during a game, returns via lobby

**Current Flow**:

- Player lands in lobby, sees `GameInProgressBanner`
- Player clicks "Rejoin Game"
- Navigates to `/game/[code]`

**Improvements**:

1. **Explicit rejoin action** (not automatic):

    ```typescript
    // Client component
    function handleRejoinGame() {
        if (!isOriginalPlayer) {
            toast.error("You were not in this game");
            return;
        }

        // Call API to register intent to rejoin
        await rejoinGame(roomCode, userId);

        router.push(`/game/${roomCode}`);
    }
    ```

2. **Server validates rejoin eligibility**:
    ```typescript
    function rejoinGame(roomId: string, userId: string): boolean {
        const room = getRoom(roomId);

        if (!isActiveGame(room)) {
            throw new Error("No active game to rejoin");
        }

        // Check if user was an original player
        if (!room.originalGamePlayerIds?.includes(userId)) {
            throw new Error("You were not part of this game");
        }

        // User is eligible - socket registration will handle reconnection
        return true;
    }
    ```

---

## 5. Game → Lobby Transitions

### 5.1 Return to Lobby (Voluntary)

**Scenario**: Player wants to leave the game and go back to lobby

**API Action**:

```typescript
socket.emit("return_to_lobby", { roomId, userId });
```

**Server Handler**:

```typescript
function handleReturnToLobby(roomId: string, userId: string) {
    const room = getRoom(roomId);

    if (!isActiveGame(room)) {
        throw new Error("No active game");
    }

    const isPlayer = room.gamePlayerIds?.includes(userId);
    const isSpectator = room.spectators?.includes(userId);

    if (isSpectator) {
        // Spectators can just leave - no game impact
        room.spectators = room.spectators.filter((id) => id !== userId);
        emitRoomEvent(room, "spectator_left", { userId });
        return;
    }

    if (!isPlayer) {
        throw new Error("User is not in the game");
    }

    // Move player to spectators (they can still see the game)
    room.gamePlayerIds = room.gamePlayerIds.filter((id) => id !== userId);
    room.spectators = [...(room.spectators || []), userId];

    // Notify game module
    gameManager.handlePlayerLeave(room.gameId, userId);

    // Check if game should pause/abort
    const hasMinPlayers = gameManager.checkMinimumPlayers(room.gameId);
    if (!hasMinPlayers) {
        // Pause or abort depending on situation
        pauseOrAbortGame(room);
    }

    emitRoomEvent(room, "player_left_to_lobby", { userId });
    emitGameEvent(room, "player_left", { userId });
}
```

### 5.2 Game Ends Normally

**Scenario**: Game completes (winner determined)

**Server Flow**:

```typescript
function handleGameEnded(roomId: string) {
    const room = getRoom(roomId);

    // Game state already has winner info
    const gameState = gameManager.getState(room.gameId);

    // Transition room back to lobby
    room.state = "lobby";
    room.isPaused = false;
    room.pausedAt = undefined;
    room.timeoutAt = undefined;

    // Clear game but keep reference for summary
    const finishedGameId = room.gameId;
    room.gameId = null;
    room.gamePlayerIds = [];

    // Reset ready states
    room.users.forEach((user) => {
        room.readyStates[user.id] = false;
    });

    emitRoomEvent(room, "game_ended", {
        gameId: finishedGameId,
        reason: "completed",
        summary: gameState, // Include final state for summary display
    });

    // Cleanup game state after short delay (allow clients to capture summary)
    setTimeout(() => {
        gameManager.removeGame(finishedGameId);
    }, 5000);
}
```

**Client Handling**:

```typescript
// In useRoomEvents
case 'game_ended':
  // Store summary for display
  setGameSummary(payload.summary);

  // Show summary modal or redirect based on user preference
  if (autoReturnToLobby) {
    toast.success("Game Over!");
    router.push(`/lobby/${roomCode}`);
  } else {
    setShowSummaryModal(true);
  }
  break;
```

### 5.3 Game Aborted

**Scenarios**:

- Reconnection timeout expired
- Leader ended the game
- Not enough players

**Already Implemented**: The `abortGameDueToTimeout` function handles this well.

**Enhancement** - Add leader-initiated abort:

```typescript
function handleAbortGame(roomId: string, userId: string, reason?: string) {
    const room = getRoom(roomId);

    // Only leader can abort
    if (room.leaderId !== userId) {
        throw new Error("Only the leader can abort the game");
    }

    abortGame(room, reason || "leader_ended");
}
```

---

## 6. Disconnection & Reconnection

### 6.1 Enhanced Disconnection Handling

**Current Implementation** is solid. Improvements:

1. **Track disconnection reason**:

    ```typescript
    interface User {
        // ... existing fields ...
        disconnectedAt?: Date;
        disconnectReason?:
            | "network"
            | "browser_close"
            | "navigation"
            | "kicked";
    }
    ```

2. **Different handling based on context**:
    - **In lobby**: Mark disconnected, remove after short timeout (30s)
    - **In game**: Mark disconnected, pause game if min players not met
    - **As spectator**: Remove immediately (no game impact)

### 6.2 Reconnection Scenarios

#### Scenario A: Browser Refresh

**Detection**: Same `userId`, same `roomId`, short time gap

**Handling**:

1. User's localStorage has session data
2. REST join endpoint recognizes existing user
3. Socket registration triggers reconnect flow
4. Game resumes if it was paused

#### Scenario B: Network Loss

**Detection**: Socket disconnects, user not removed from room

**Handling**:

1. Mark user disconnected
2. If game active: Pause if min players not met
3. Wait for reconnection or timeout
4. On reconnect: Resume game automatically

#### Scenario C: Navigation to Lobby

**Detection**: User explicitly navigates to `/lobby/[code]`

**Handling**:

1. Lobby page joins room via REST (idempotent)
2. User sees `GameInProgressBanner` if game active
3. User must manually choose to rejoin game
4. They are NOT auto-placed back in the game

#### Scenario D: Direct Game URL

**Detection**: User navigates directly to `/game/[code]`

**Handling** (via `useGameDirectURLRecovery`):

1. Check if user has session data (localStorage)
2. If yes: Attempt rejoin
3. If no: Show name prompt, then attempt rejoin
4. If user wasn't in game: Redirect to lobby with message

---

## 7. Ready System

### Current State

- Ready states stored in `room.readyStates[userId]`
- Leader can start when all players ready
- Ready states not consistently reset

### Improvements

#### 7.1 Ready State Reset Points

Reset all ready states when:

- New player joins the room
- Player leaves the room
- Game settings change
- Game ends (return to lobby)
- Player is kicked

```typescript
function resetReadyStates(room: Room) {
    room.users.forEach((user) => {
        room.readyStates[user.id] = false;
    });
    emitRoomEvent(room, "ready_states_reset");
}
```

#### 7.2 Ready vs Rejoin

**Distinction**:

- **Ready**: Required to START a new game
- **Rejoin**: NOT required when returning to an active game

```typescript
// When starting a new game
function canStartGame(room: Room): boolean {
    // All users must be ready
    return room.users.every((u) => room.readyStates[u.id] === true);
}

// When rejoining an active game
function canRejoinGame(room: Room, userId: string): boolean {
    // Just need to be an original player
    return room.originalGamePlayerIds?.includes(userId) ?? false;
}
```

#### 7.3 Ready Toggle Socket Event

```typescript
socket.on("toggle_ready", ({ roomId, odusId }) => {
    const room = getRoom(roomId);

    if (isActiveGame(room)) {
        throw new Error("Cannot toggle ready during active game");
    }

    const currentReady = room.readyStates[odusId] ?? false;
    room.readyStates[odusId] = !currentReady;

    emitRoomEvent(room, "ready_changed", {
        odusId,
        isReady: room.readyStates[odusId],
    });
});
```

---

## 8. Lobby UI Improvements

### 8.1 Game In Progress Banner Enhancement

**Current**: Shows basic "Game in Progress" message

**Improved**:

```tsx
interface GameInProgressBannerProps {
    room: LobbyData;
}

function GameInProgressBanner({ room }: GameInProgressBannerProps) {
    const { userId } = useSession();

    const isOriginalPlayer = room.originalGamePlayerIds?.includes(userId);
    const isCurrentlyInGame = room.gamePlayerIds?.includes(userId);
    const isSpectator = room.spectators?.includes(userId);
    const disconnectedPlayers = room.users.filter(
        (u) => u.isConnected === false && room.gamePlayerIds?.includes(u.id)
    );

    return (
        <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
            <CardContent className="flex items-center justify-between p-4">
                <div>
                    <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                        Game In Progress
                    </h3>
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                        {room.selectedGameType} •{" "}
                        {room.gamePlayerIds?.length || 0} players
                    </p>
                    {disconnectedPlayers.length > 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                            Waiting for:{" "}
                            {disconnectedPlayers.map((p) => p.name).join(", ")}
                        </p>
                    )}
                </div>

                <div className="flex gap-2">
                    {isOriginalPlayer && !isCurrentlyInGame && (
                        <Button onClick={handleRejoin} variant="default">
                            <PlayIcon className="w-4 h-4 mr-2" />
                            Rejoin Game
                        </Button>
                    )}

                    {!isOriginalPlayer && !isSpectator && (
                        <Button onClick={handleSpectate} variant="outline">
                            <EyeIcon className="w-4 h-4 mr-2" />
                            Spectate
                        </Button>
                    )}

                    {isSpectator && (
                        <Button onClick={handleSpectate} variant="secondary">
                            <EyeIcon className="w-4 h-4 mr-2" />
                            Continue Watching
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
```

### 8.2 Player List Enhancement

Show player status more clearly in lobby:

```tsx
function PlayerListItem({ user, room }: PlayerListItemProps) {
    const position = getUserPosition(room, user.id);
    const isConnected = user.isConnected !== false;

    return (
        <div className="flex items-center gap-3 p-3 rounded-lg">
            <Avatar>
                <AvatarFallback>{user.name[0]}</AvatarFallback>
            </Avatar>

            <div className="flex-1">
                <span className="font-medium">{user.name}</span>
                {user.id === room.leaderId && (
                    <Badge variant="secondary" className="ml-2">
                        Leader
                    </Badge>
                )}
            </div>

            {/* Connection status */}
            {!isConnected && (
                <Badge variant="destructive" className="text-xs">
                    Disconnected
                </Badge>
            )}

            {/* Game position indicator */}
            {position === "in-game" && isConnected && (
                <Badge
                    variant="outline"
                    className="text-xs border-green-500 text-green-600"
                >
                    In Game
                </Badge>
            )}

            {position === "spectating" && (
                <Badge
                    variant="outline"
                    className="text-xs border-blue-500 text-blue-600"
                >
                    Spectating
                </Badge>
            )}

            {/* Ready status (only when no game) */}
            {room.state === "lobby" &&
                (room.readyStates[user.id] ? (
                    <Badge className="bg-green-500">Ready</Badge>
                ) : (
                    <Badge variant="outline">Not Ready</Badge>
                ))}
        </div>
    );
}
```

---

## 9. Socket Event Updates

### New Events

```typescript
// Client → Server
"return_to_lobby"; // Player leaving game voluntarily
"rejoin_game"; // Player requesting to rejoin active game
"toggle_ready"; // Toggle ready state
"abort_game"; // Leader ending game early

// Server → Client
"player_left_to_lobby"; // Player moved from game to lobby
"game_ended"; // Game completed normally
"ready_changed"; // Single player's ready state changed
"ready_states_reset"; // All ready states were reset
"spectator_left"; // Spectator left the game view
```

### Event Payload Updates

```typescript
// Enhanced room_event base
interface RoomEventPayload {
    event: string;
    roomState: LobbyData; // Always include full room state
    timestamp: string;

    // Event-specific fields
    userId?: string;
    userName?: string;
    reason?: string;
}

// LobbyData enhancement
interface LobbyData {
    // ... existing fields ...

    // New fields for game tracking
    gamePlayerIds: string[]; // Current game players
    originalGamePlayerIds: string[]; // Original game players (for rejoin eligibility)
}
```

---

## 10. Implementation Order

### Phase 1: Core Room State (API)

1. Add `gamePlayerIds` and `originalGamePlayerIds` to Room model
2. Update `startGame()` to populate these arrays
3. Update `endGame()` / `abortGame()` to clear and reset states
4. Add `getUserPosition()` utility function

### Phase 2: Ready System (API)

1. Implement `resetReadyStates()` function
2. Add reset calls at appropriate points (join, leave, settings change, game end)
3. Update `toggle_ready` handler
4. Add validation to prevent ready toggle during game

### Phase 3: Return to Lobby Flow (API)

1. Implement `return_to_lobby` socket handler
2. Implement player-to-spectator transition
3. Add game continuation/abort logic based on remaining players
4. Emit appropriate events

### Phase 4: Client Updates

1. Update `LobbyData` type with new fields
2. Enhance `GameInProgressBanner` component
3. Update player list to show game positions
4. Add "Return to Lobby" button in game UI
5. Handle new socket events in `useRoomEvents`

### Phase 5: Reconnection Polish

1. Add `disconnectedAt` tracking
2. Improve direct URL recovery flow
3. Add clear error messages for invalid rejoin attempts
4. Test all reconnection scenarios

---

## 11. Edge Cases

### Multiple Browsers / Tabs

- Same user, multiple tabs: Only allow one active socket
- Current `userToSocket` map handles this (duplicate detection)
- Enhance: Notify user "You're connected in another tab"

### Leader Leaves During Game

1. Transfer leadership to another connected player
2. Continue game with new leader
3. New leader gains abort privileges

### All Players Leave

1. Game should abort after short delay
2. Room transitions to lobby state
3. Spectators become potential players for next game

### Spectator Tries to Act

- Already handled: `dispatchOptimisticAction` is `undefined` for spectators
- Add server-side validation: Reject actions from spectators

### Game Ends While Player Disconnected

1. Player reconnects after game ended
2. Server detects room is in lobby state
3. Player sees normal lobby (not game)
4. Game summary can be shown if they were a participant

---

## 12. Testing Scenarios

### Scenario 1: Normal Game Flow

1. Players join lobby
2. All ready up
3. Leader starts game
4. Game plays to completion
5. All return to lobby with ready states reset

### Scenario 2: Mid-Game Disconnect

1. Game in progress
2. Player closes browser
3. Game pauses (if min players not met)
4. Player reopens browser, navigates to lobby
5. Player sees "Rejoin Game" button
6. Player clicks rejoin, returns to game
7. Game resumes

### Scenario 3: Voluntary Leave

1. Game in progress
2. Player clicks "Return to Lobby"
3. Player moves to spectator list
4. Game continues or pauses based on player count
5. Player can spectate or wait for next game

### Scenario 4: Direct URL Access

1. User has session from previous visit
2. User navigates directly to `/game/[code]`
3. If valid session: Rejoin game
4. If invalid: Show name modal, then rejoin or redirect

### Scenario 5: New User During Game

1. New user joins via room code
2. Lands in lobby, sees game in progress
3. Can spectate or wait
4. When game ends, becomes eligible for next game

---

## 13. File Changes Summary

### API Files to Modify

- `src/models/Room.ts` - Add new fields
- `src/services/RoomService.ts` - Add handlers, update transitions
- `src/services/GameManager.ts` - Add player tracking hooks
- `src/webhooks/roomWebhooks.ts` - Add new event types

### Client Files to Modify

- `src/types/lobby/index.ts` - Update LobbyData interface
- `src/hooks/useRoomEvents.ts` - Handle new events
- `src/components/lobby/GameInProgressBanner.tsx` - Enhance UI
- `src/components/lobby/PlayerList.tsx` - Show game positions
- `src/app/(room)/game/[roomCode]/page.tsx` - Add "Return to Lobby" button
- `src/app/(room)/lobby/[roomCode]/page.tsx` - Handle game ended state

---

## 14. Notes

### Philosophy

The key principle is **explicit user actions**:

- Users choose when to rejoin a game (not automatic)
- Users choose when to leave a game (not forced)
- System only forces transitions for: timeout expiry, kicks, room closure

### Backward Compatibility

Since the user stated no backward compatibility concerns:

- New fields can be required (not optional)
- Existing event payloads can be modified
- No migration needed for existing rooms (in-memory storage)

### Performance

All transitions should be instant:

- State changes are in-memory (Maps)
- Socket events are lightweight
- No database calls in critical path
