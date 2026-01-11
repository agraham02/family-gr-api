# Spectator Mode Implementation

## Overview

This document specifies the implementation of a comprehensive spectator mode, allowing players in the lobby to watch active games, claim open player slots, and transition between spectator and player roles seamlessly.

---

## 1. Current State Analysis

### What's Already Implemented

**API (RoomService.ts)**:

- `room.spectators: string[]` - Array of user IDs who are spectators
- `addSpectator()` - Add a user as a spectator to an active game
- `moveToSpectators()` - Move a player from game to spectator mode
- `claimPlayerSlot()` - Allow spectator to take a disconnected player's slot
- `getAvailableSlots()` - Get list of disconnected player slots
- Spectator-aware socket registration and reconnection

**Client**:

- `SpectatorBanner` component - Shown at top of game view for spectators
- `isSpectator` state in game page
- `spectator_state` socket event handling
- "Join Game" button to claim open slots
- "Lobby" button to return to lobby

**GameManager**:

- `transferPlayerSlot()` - Transfer player slot ownership

### Current Gaps

1. **Spectator view restrictions** - Not fully enforced (spectators might see private info)
2. **No spectator count limits** - Room can have unlimited spectators
3. **Spectator-to-player transitions** - Works only for claiming disconnected slots
4. **No spectator-specific UI** - Same game view as players (without actions)
5. **Chat restrictions** - Not enforced for spectators

---

## 2. Spectator Model

### User Position States

```typescript
type UserPosition = "lobby-only" | "in-game" | "spectating";
```

### Spectator Properties

```typescript
interface SpectatorInfo {
    odusId: string;
    odusName: string;
    joinedAt: Date;

    /** Whether spectator has requested to join as player */
    wantsToPlay: boolean;
}
```

### Room Spectator Tracking

Enhance the Room model:

```typescript
interface Room {
    // ... existing fields ...

    /** List of user IDs currently spectating */
    spectators: string[];

    /** Maximum spectators allowed (optional) */
    maxSpectators?: number;
}
```

**Default Limits**:

- If `settings.maxPlayers` is set, spectator limit = `maxPlayers - gamePlayerCount`
- Otherwise, no limit (or configurable global limit)

---

## 3. Joining as Spectator

### Entry Points

1. **From Lobby** - Click "Watch Game" / "Spectate" button
2. **Via Direct URL** - Navigate to `/game/[code]?spectate=true`
3. **After Leaving Game** - Player who "returns to lobby" but stays on game page

### Socket Event: `spectate_game`

**Client → Server**:

```typescript
socket.emit("spectate_game", {
    roomCode: string,
    userId: string,
    userName: string,
});
```

**Server Handler**:

```typescript
socket.on("spectate_game", async ({ roomCode, userId, userName }) => {
    try {
        const result = addSpectator(roomCode, userName, userId);

        // Send spectator-specific state
        const gameState = gameManager.getPublicState(result.room.gameId);

        socket.emit("spectator_state", {
            gameState,
            room: result.room,
            isSpectator: true,
        });

        // Register socket for room events
        socket.join(`room:${result.room.id}`);
    } catch (error) {
        socket.emit("error", { message: error.message });
    }
});
```

### REST Endpoint Alternative

**POST** `/api/rooms/:code/spectate`

```typescript
// RoomController.ts
router.post("/rooms/:code/spectate", async (req, res) => {
    const { code } = req.params;
    const { userName, userId } = req.body;

    try {
        const result = addSpectator(code, userName, userId);

        res.json({
            roomId: result.room.id,
            userId: result.user.id,
            isSpectator: true,
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});
```

---

## 4. Spectator View Restrictions

### Public vs Private Game State

Games must distinguish between public and private information:

```typescript
interface GameModule {
    // ... existing methods ...

    /**
     * Get the public-only state for spectators.
     * Should NOT include: player hands, hidden cards, private bids, etc.
     */
    getPublicState(state: GameState): PublicGameState;
}
```

### Game-Specific Implementations

#### Spades Public State

```typescript
// In spades/index.ts
getPublicState(state: SpadesState): PublicSpadesState {
  return {
    phase: state.phase,
    currentPlayerIndex: state.currentPlayerIndex,
    dealerIndex: state.dealerIndex,
    leadPlayerIndex: state.leadPlayerIndex,
    trumpBroken: state.trumpBroken,
    currentTrick: state.currentTrick,

    // Public player info (no hands)
    players: state.players.map(p => ({
      odusId: p.odusId,
      odusName: p.odusName,
      isConnected: p.isConnected,
      bid: p.bid, // Bids are public after bidding phase
      tricksTaken: p.tricksTaken,
      // NO hand field
    })),

    teams: state.teams,
    roundNumber: state.roundNumber,
    trickNumber: state.trickNumber,

    // Only show card count, not actual cards
    playerCardCounts: state.players.map(p => p.hand.length),
  };
}
```

#### Dominoes Public State

```typescript
// In dominoes/index.ts
getPublicState(state: DominoesState): PublicDominoesState {
  return {
    phase: state.phase,
    currentPlayerIndex: state.currentPlayerIndex,
    board: state.board, // Board is fully public
    boardEnds: state.boardEnds,

    players: state.players.map(p => ({
      odusId: p.odusId,
      odusName: p.odusName,
      isConnected: p.isConnected,
      hasPassed: p.hasPassed,
      tileCount: p.hand.length, // Count only, not tiles
      // NO hand field
    })),

    teams: state.teams,
    scores: state.scores,
    roundNumber: state.roundNumber,
    passCount: state.passCount,
  };
}
```

#### LRC Public State

LRC is fully public - no hidden information:

```typescript
// In lrc/index.ts
getPublicState(state: LRCState): LRCState {
  // LRC has no private information
  return state;
}
```

---

## 5. GameManager Spectator Support

### Add getPublicState Method

**File**: `src/services/GameManager.ts`

```typescript
/**
 * Get the public (spectator-safe) game state.
 */
getPublicState(gameId: string): PublicGameState | null {
  const game = this.games.get(gameId);
  if (!game) return null;

  const module = this.getModule(game.type);
  if (!module) return null;

  // Use getPublicState if available, otherwise use getState
  if (module.getPublicState) {
    return module.getPublicState(game.state);
  }

  // Fallback: return full state (less secure)
  console.warn(`Game ${game.type} does not implement getPublicState`);
  return module.getState(game.state);
}
```

### Send Spectator State

When spectator requests state or game updates:

```typescript
function emitToSpectators(room: Room, eventType: string, data: any) {
    const spectatorSockets = room.spectators
        .map((id) => userToSocket.get(id))
        .filter(Boolean);

    const publicState = gameManager.getPublicState(room.gameId);

    spectatorSockets.forEach((socketId) => {
        io.to(socketId).emit("spectator_state", {
            ...data,
            gameState: publicState,
            isSpectator: true,
        });
    });
}
```

---

## 6. Spectator-to-Player Transitions

### 6.1 Claiming a Disconnected Slot

**Already Implemented** in `claimPlayerSlot()`.

**Enhancements**:

1. **Validate team balance** (if applicable):

    ```typescript
    function canClaimSlot(
        room: Room,
        claimingUserId: string,
        targetSlotUserId: string
    ): boolean {
        // If teams exist, ensure the claiming user would join the same team
        // This prevents spectators from choosing which team to join
        return true; // Slot is assigned, not chosen
    }
    ```

2. **Notify all spectators of slot claim**:
    ```typescript
    emitToSpectators(room, "slot_claimed", {
        claimedBy: claimingUserId,
        slotId: targetSlotUserId,
        remainingSlots: getAvailableSlots(room.id).length,
    });
    ```

### 6.2 Waiting for Next Game

Spectators who want to play in the next game:

**Socket Event**: `request_to_play`

```typescript
socket.emit("request_to_play", { roomId, userId });
```

**Server Handler**:

```typescript
socket.on("request_to_play", ({ roomId, userId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    // Track that this spectator wants to play
    if (!room.playRequestQueue) {
        room.playRequestQueue = [];
    }

    if (!room.playRequestQueue.includes(userId)) {
        room.playRequestQueue.push(userId);
    }

    emitRoomEvent(room, "play_request_added", { userId });
});
```

**When Game Ends**:

```typescript
function handleGameEnded(room: Room) {
    // ... transition to lobby ...

    // Process play request queue
    if (room.playRequestQueue?.length > 0) {
        // Move spectators who requested to play into player list
        room.playRequestQueue.forEach((spectatorId) => {
            if (room.spectators?.includes(spectatorId)) {
                room.spectators = room.spectators.filter(
                    (id) => id !== spectatorId
                );
                // User is now a regular player for next game
            }
        });

        room.playRequestQueue = [];
    }

    // Clear spectator list (everyone starts fresh in lobby)
    room.spectators = [];
}
```

### 6.3 Automatic Slot Offer

When a slot opens during a game, offer it to spectators:

```typescript
function offerOpenSlot(room: Room, slotUserId: string) {
    const slot = room.users.find((u) => u.id === slotUserId);
    if (!slot) return;

    // Notify spectators of available slot
    emitToSpectators(room, "slot_available", {
        slotUserId: slot.id,
        slotUserName: slot.name,
        teamIndex: getPlayerTeam(room, slotUserId),
    });
}
```

---

## 7. Spectator Restrictions

### 7.1 No Game Actions

Spectators cannot perform game actions:

**Server Validation**:

```typescript
socket.on("game-action", ({ roomId, userId, action }) => {
    const room = rooms.get(roomId);

    // Block spectators
    if (room?.spectators?.includes(userId)) {
        socket.emit("error", { message: "Spectators cannot perform actions" });
        return;
    }

    // ... handle action ...
});
```

**Client Prevention**:

```tsx
// Already implemented: dispatchOptimisticAction is undefined for spectators
{
    isSpectator ? undefined : optimisticAction.dispatch;
}
```

### 7.2 No Chat (Optional)

If chat is implemented, spectators should be silent observers:

```typescript
socket.on("chat_message", ({ roomId, userId, message }) => {
    const room = rooms.get(roomId);

    if (room?.spectators?.includes(userId)) {
        socket.emit("error", { message: "Spectators cannot chat" });
        return;
    }

    // ... broadcast message ...
});
```

**Alternative**: Allow spectator chat in a separate "spectator chat" channel.

### 7.3 No Voting/Actions

Any future voting or action systems should check spectator status:

```typescript
function canVote(room: Room, userId: string): boolean {
    return !room.spectators?.includes(userId);
}
```

---

## 8. Spectator UI Components

### 8.1 SpectatorBanner (Enhanced)

**File**: `src/components/games/SpectatorBanner.tsx`

```tsx
interface SpectatorBannerProps {
    disconnectedPlayers: User[];
    spectatorCount: number;
    onClaimSlot?: (targetUserId: string) => void;
    onReturnToLobby?: () => void;
    onRequestToPlay?: () => void;
    hasRequestedToPlay: boolean;
}

function SpectatorBanner({
    disconnectedPlayers,
    spectatorCount,
    onClaimSlot,
    onReturnToLobby,
    onRequestToPlay,
    hasRequestedToPlay,
}: SpectatorBannerProps) {
    const hasOpenSlots = disconnectedPlayers.length > 0;

    return (
        <div className="fixed top-0 left-0 right-0 z-50 bg-purple-500/95 backdrop-blur-sm text-white px-4 py-2">
            <div className="max-w-4xl mx-auto flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <EyeIcon className="w-4 h-4" />
                    <span className="font-medium">Spectator Mode</span>

                    {spectatorCount > 1 && (
                        <Badge variant="secondary" className="bg-white/20">
                            {spectatorCount} watching
                        </Badge>
                    )}

                    {hasOpenSlots && (
                        <Badge className="bg-emerald-500">
                            {disconnectedPlayers.length} slot
                            {disconnectedPlayers.length > 1 ? "s" : ""} open
                        </Badge>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Claim Slot */}
                    {hasOpenSlots && onClaimSlot && (
                        <Select onValueChange={onClaimSlot}>
                            <SelectTrigger className="w-40 bg-emerald-600">
                                <SelectValue placeholder="Join as..." />
                            </SelectTrigger>
                            <SelectContent>
                                {disconnectedPlayers.map((player) => (
                                    <SelectItem
                                        key={player.id}
                                        value={player.id}
                                    >
                                        Take {player.name}'s spot
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}

                    {/* Request to Play (next game) */}
                    {!hasOpenSlots && onRequestToPlay && (
                        <Button
                            size="sm"
                            variant={
                                hasRequestedToPlay ? "secondary" : "default"
                            }
                            onClick={onRequestToPlay}
                            disabled={hasRequestedToPlay}
                        >
                            {hasRequestedToPlay ? (
                                <>
                                    <CheckIcon className="w-4 h-4 mr-1" />
                                    Requested
                                </>
                            ) : (
                                <>
                                    <PlayIcon className="w-4 h-4 mr-1" />
                                    Join Next Game
                                </>
                            )}
                        </Button>
                    )}

                    {/* Return to Lobby */}
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={onReturnToLobby}
                        className="text-white hover:bg-white/20"
                    >
                        <DoorOpenIcon className="w-4 h-4 mr-1" />
                        Lobby
                    </Button>
                </div>
            </div>
        </div>
    );
}
```

### 8.2 Spectator Game View

The game component should render differently for spectators:

```tsx
// In game component (e.g., Spades/index.tsx)
function SpadesGame({
    gameData,
    playerData,
    dispatchOptimisticAction,
    isSpectator,
}) {
    if (isSpectator) {
        return <SpectatorGameView gameData={gameData} gameType="spades" />;
    }

    // Regular player view
    return <div className="h-full">{/* ... full player UI ... */}</div>;
}
```

**SpectatorGameView Component**:

```tsx
function SpectatorGameView({ gameData, gameType }: SpectatorGameViewProps) {
    return (
        <div className="h-full flex flex-col">
            {/* Public game board */}
            <div className="flex-1 p-4">
                {gameType === "spades" && (
                    <SpadesSpectatorBoard gameData={gameData} />
                )}
                {gameType === "dominoes" && (
                    <DominoesSpectatorBoard gameData={gameData} />
                )}
                {gameType === "lrc" && (
                    <LRCSpectatorBoard gameData={gameData} />
                )}
            </div>

            {/* Scores and status */}
            <div className="p-4 bg-zinc-100 dark:bg-zinc-900">
                <GameScoreboard gameData={gameData} />
            </div>

            {/* Visual indicator that this is spectator view */}
            <div className="absolute bottom-4 right-4 text-zinc-400 flex items-center gap-2">
                <EyeIcon className="w-4 h-4" />
                <span className="text-sm">Watching</span>
            </div>
        </div>
    );
}
```

---

## 9. Spectator Limits

### Configurable Limits

Add to room settings:

```typescript
interface RoomSettings {
    // ... existing fields ...

    /**
     * Maximum spectators allowed.
     * 0 = unlimited, positive number = limit
     * Default: 0 (unlimited)
     */
    maxSpectators: number;

    /**
     * Whether to allow spectators at all.
     * Default: true
     */
    allowSpectators: boolean;
}
```

### Enforcement

```typescript
function addSpectator(roomCode: string, userName: string, userId?: string) {
    const room = getRoomByCode(roomCode);

    // Check if spectating is allowed
    if (room.settings?.allowSpectators === false) {
        throw new Error("Spectating is not allowed in this room");
    }

    // Check spectator limit
    const maxSpectators = room.settings?.maxSpectators || 0;
    if (maxSpectators > 0 && (room.spectators?.length || 0) >= maxSpectators) {
        throw new Error("Spectator limit reached");
    }

    // ... rest of function ...
}
```

### Room Capacity Calculation

Total room capacity includes both players and spectators:

```typescript
function getRoomCapacity(room: Room): {
    players: number;
    spectators: number;
    total: number;
} {
    const maxPlayers = room.settings?.maxPlayers || 10;
    const maxSpectators = room.settings?.maxSpectators || 10;

    return {
        players: maxPlayers,
        spectators: maxSpectators,
        total: maxPlayers + maxSpectators,
    };
}

function canJoinRoom(room: Room): boolean {
    const capacity = getRoomCapacity(room);
    return room.users.length < capacity.total;
}
```

---

## 10. Socket Events Summary

### Client → Server

| Event               | Payload                                | Description                     |
| ------------------- | -------------------------------------- | ------------------------------- |
| `spectate_game`     | `{ roomCode, userId, userName }`       | Join as spectator               |
| `claim_player_slot` | `{ roomId, userId, targetSlotUserId }` | Take disconnected player's spot |
| `request_to_play`   | `{ roomId, userId }`                   | Request to play in next game    |
| `leave_spectating`  | `{ roomId, userId }`                   | Stop spectating                 |

### Server → Client

| Event                | Payload                                   | Description               |
| -------------------- | ----------------------------------------- | ------------------------- |
| `spectator_state`    | `{ gameState, room, isSpectator }`        | Full spectator state      |
| `slot_available`     | `{ slotUserId, slotUserName, teamIndex }` | Notify of open slot       |
| `slot_claimed`       | `{ claimedBy, slotId, remainingSlots }`   | Slot was taken            |
| `spectator_joined`   | `{ userId, userName, spectatorCount }`    | New spectator             |
| `spectator_left`     | `{ userId, spectatorCount }`              | Spectator left            |
| `play_request_added` | `{ userId }`                              | Someone requested to play |

---

## 11. Implementation Order

### Phase 1: Spectator View Restrictions (API)

1. Add `getPublicState()` method to GameModule interface
2. Implement `getPublicState()` for Spades
3. Implement `getPublicState()` for Dominoes
4. Implement `getPublicState()` for LRC
5. Update GameManager to use public state for spectators

### Phase 2: Enhanced Spectator Flow (API)

1. Add spectator limits to room settings
2. Add `allowSpectators` setting
3. Add `playRequestQueue` for next-game requests
4. Add `request_to_play` socket handler
5. Update game end logic to process play requests

### Phase 3: Spectator UI (Client)

1. Enhance `SpectatorBanner` component
2. Create `SpectatorGameView` component
3. Create game-specific spectator board components
4. Add slot selection dropdown
5. Add "Join Next Game" button

### Phase 4: Lobby Integration

1. Show spectator count in `GameInProgressBanner`
2. Add "Watch Game" button visibility rules
3. Show spectator list in lobby (if game active)
4. Handle spectator transitions back to lobby

### Phase 5: Polish

1. Add spectator join/leave animations
2. Add slot claim confirmation modal
3. Add spectator chat (optional)
4. Add spectator perspective toggle (optional - switch between player views)

---

## 12. Testing Scenarios

### Scenario 1: Join as Spectator

1. Game in progress
2. New user joins room
3. User clicks "Watch Game"
4. User sees game without private info
5. User cannot perform actions

### Scenario 2: Claim Open Slot

1. Spectator watching game
2. Player disconnects
3. Slot becomes available
4. Spectator sees "Join as [Player]" option
5. Spectator clicks, takes slot
6. Spectator becomes player, game resumes

### Scenario 3: Request to Play

1. Spectator watching game (no open slots)
2. Spectator clicks "Join Next Game"
3. Game ends normally
4. Spectator is moved to player list
5. Spectator can ready up for next game

### Scenario 4: Spectator Limit

1. Room has maxSpectators = 2
2. 2 spectators watching
3. 3rd user tries to spectate
4. Error: "Spectator limit reached"
5. User can only wait in lobby

### Scenario 5: Player to Spectator

1. Player in game clicks "Return to Lobby"
2. Player becomes spectator
3. Game pauses if min players not met
4. Player can claim their old slot back
5. Or wait as spectator

---

## 13. File Changes Summary

### API Files

**New Files**:

- None (all changes in existing files)

**Modified Files**:

- `src/models/Room.ts` - Add `maxSpectators`, `allowSpectators`, `playRequestQueue`
- `src/services/GameManager.ts` - Add `getPublicState()` method
- `src/services/RoomService.ts` - Add spectator limit checks, play request handling
- `src/games/spades/index.ts` - Add `getPublicState()` implementation
- `src/games/dominoes/index.ts` - Add `getPublicState()` implementation
- `src/games/lrc/index.ts` - Add `getPublicState()` implementation

### Client Files

**New Files**:

- `src/components/games/SpectatorGameView.tsx`
- `src/components/games/spades/SpectatorBoard.tsx`
- `src/components/games/dominoes/SpectatorBoard.tsx`
- `src/components/games/lrc/SpectatorBoard.tsx`

**Modified Files**:

- `src/types/lobby/index.ts` - Add spectator-related types
- `src/components/games/SpectatorBanner.tsx` - Enhance with new features
- `src/components/lobby/GameInProgressBanner.tsx` - Show spectator count
- `src/app/(room)/game/[roomCode]/page.tsx` - Handle play requests

---

## 14. Notes

### Design Philosophy

1. **Spectators are passive** - They observe, don't interact
2. **Clear visual distinction** - Spectators always know they're watching
3. **Easy transitions** - Simple to move between spectator and player
4. **Fair slot claiming** - First-come-first-served for open slots

### Security Considerations

1. **Never expose hands** - Public state must not include private cards
2. **Server-side validation** - Don't trust client `isSpectator` flag
3. **Action blocking** - All game actions must check spectator status

### Performance

1. **Separate update channels** - Spectators get public state, players get full state
2. **Batch spectator updates** - Don't emit individually for each spectator
3. **Limit spectator count** - Prevent room overload

### Future Enhancements

1. **Spectator perspective toggle** - Choose which player's view to follow
2. **Delayed spectator view** - 30-second delay to prevent cheating (for competitive)
3. **Spectator reactions** - Emoji reactions that players can see
4. **Spectator stats** - Track watch time, favorite players, etc.
