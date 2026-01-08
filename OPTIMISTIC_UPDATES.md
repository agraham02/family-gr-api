# Optimistic Updates System

This system implements instant client-side updates for all player actions, with automatic rollback if the server rejects the action or the network fails.

## Architecture

### Core Components

1. **`useOptimisticGameAction` Hook** ([hooks/useOptimisticGameAction.ts](../../family-gr-client/src/hooks/useOptimisticGameAction.ts))
    - Manages optimistic action lifecycle
    - Saves state snapshots before actions
    - Applies client-side predictions
    - Handles rollback on failure or timeout
    - Confirms successful actions

2. **Client-Side Reducers** ([lib/gameReducers.ts](../../family-gr-client/src/lib/gameReducers.ts))
    - Mirrors server-side game logic
    - Predicts state changes for each action type
    - Validates actions before applying optimistically
    - Supports all game types (Spades, Dominoes)

3. **Server Acknowledgements** ([family-gr-api/src/index.ts](../../family-gr-api/src/index.ts))
    - Sends `action_ack` events with success/failure status
    - Includes action IDs for matching pending actions
    - Provides error messages for rollback feedback

### Data Flow

```
User Action (e.g., plays card)
    ↓
1. Save state snapshot
2. Apply optimistic update locally (card instantly moves)
3. Queue action as "pending"
4. Emit socket event with action ID
    ↓
Server processes action
    ↓
5a. ✅ Success → Server broadcasts sync → Client confirms & clears pending
5b. ❌ Failure → Server sends error ack → Client restores snapshot + shows toast
5c. ⏱️ Timeout → Client restores snapshot after 5s + shows toast
```

## Supported Actions

### Spades

- **`PLAY_CARD`** - Instantly remove card from hand and add to trick
- **`PLACE_BID`** - Instantly update bid and advance turn

### Dominoes

- **`PLACE_TILE`** - Instantly remove tile from hand and update board
- **`PASS`** - Instantly advance turn and increment pass counter

### Non-Optimistic Actions

Actions like `CONTINUE_AFTER_TRICK_RESULT` and `CONTINUE_AFTER_ROUND_SUMMARY` are not optimized, as they don't require instant feedback.

## Implementation Details

### Game Page Integration

The game page ([game/[roomCode]/page.tsx](<../../family-gr-client/src/app/(room)/game/[roomCode]/page.tsx>)) initializes the optimistic hook:

```tsx
const optimisticAction = useOptimisticGameAction({
    socket,
    connected,
    roomId,
    userId,
    gameData,
    playerData,
    setGameData,
    setPlayerData,
    optimisticReducer: optimisticGameReducer,
    onRollback: (reason) => {
        toast.error(`Action reverted: ${reason}`);
    },
    actionTimeout: 5000, // 5 seconds before rollback
});
```

It listens for server acknowledgements:

```tsx
sock.on("action_ack", ({ actionId, success, error }) => {
    if (!success && error) {
        optimisticAction.rollback(error);
    }
});
```

And confirms actions when sync events arrive:

```tsx
case "sync":
    setGameData(payload.gameState);
    if (optimisticAction.hasPendingAction) {
        optimisticAction.confirm();
    }
    break;
```

### Game Component Integration

Game components receive the `dispatchOptimisticAction` function:

```tsx
<GameComponent
    gameData={gameData}
    playerData={playerData}
    dispatchOptimisticAction={optimisticAction.dispatch}
/>
```

Components use it instead of direct socket emission:

```tsx
const sendGameAction = useCallback(
    (type: string, payload: unknown) => {
        if (dispatchOptimisticAction) {
            dispatchOptimisticAction(type, payload);
        } else {
            // Fallback for backwards compatibility
            socket.emit("game_action", { roomId, action });
        }
    },
    [dispatchOptimisticAction, socket, roomId]
);
```

### Client-Side Validation

The optimistic reducers validate actions before applying them:

```typescript
// Example: Spades PLAY_CARD validation
const currentPlayerId = gameData.playOrder[gameData.currentTurnIndex];
if (currentPlayerId !== userId) {
    return null; // Not player's turn - don't apply optimistically
}

const cardIndex = playerData.hand.findIndex(/* card match */);
if (cardIndex === -1) {
    return null; // Card not in hand - don't apply optimistically
}
```

This prevents invalid optimistic updates that would always roll back.

## User Experience

### Success Path

1. User clicks card → Card **instantly** moves to trick
2. Server confirms → State stays as-is
3. Total latency: **0ms perceived** (actual network latency hidden)

### Failure Path (Invalid Action)

1. User clicks card → Card **instantly** moves to trick
2. Server rejects (e.g., wrong suit) → Card slides back to hand
3. Toast notification: "Action reverted: Must follow suit"
4. Total latency: ~200-500ms round-trip

### Timeout Path (Network Issues)

1. User clicks card → Card **instantly** moves to trick
2. Server doesn't respond within 5s → Card slides back to hand
3. Toast notification: "Action reverted: Action timed out"
4. Reconnecting banner likely visible

## Visual Feedback

1. **Pending Indicator** - Blue "Processing..." pill in top-right during pending action
2. **Rollback Toast** - Error toast with reason when action is reverted
3. **Existing Feedback** - All existing animations and transitions work normally

## Edge Cases Handled

1. **Rapid Inputs** - Pending actions block new actions until confirmed/rolled back
2. **Connection Loss During Action** - Timeout triggers rollback after 5s
3. **Page Refresh** - State is re-fetched from server (no stale optimistic state)
4. **Server Rejection** - Specific error message shown to user
5. **Race Conditions** - Action IDs ensure correct matching of pending actions

## Performance Benefits

- **Perceived latency**: Reduced from 200-500ms to **0ms**
- **User satisfaction**: Instant feedback feels responsive and modern
- **Network efficiency**: No change (same number of messages)
- **Server load**: No change (server logic unchanged)

## Future Enhancements

1. **Action Queue** - Allow queueing multiple actions sequentially
2. **Partial Rollback** - Rollback only specific state changes, not entire snapshot
3. **Optimistic Animations** - Add special "revert" animations for rollbacks
4. **Client-Side Prediction** - Predict opponent actions for smoother experience
5. **Shared Validation** - Extract validation logic to shared package between client/server
