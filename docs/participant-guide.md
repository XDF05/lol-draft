# Participant Guide

This guide walks through a complete 1v1 draft in the web interface. It matches
the implemented pages under `frontend/app/` and the server rules described in
[`docs/api.md`](api.md).

## 1. Create an account and sign in

1. Open `http://127.0.0.1:3000/register` and create an account with a unique
   username, unique email address, and a password of at least 8 characters.
2. Sign in at `http://127.0.0.1:3000/login`.
3. Your session is kept in browser storage. An expired access token is
   refreshed automatically; if the refresh token is no longer valid, you are
   returned to the login page.

Both players need their own account. See
[`docs/account-session.md`](account-session.md) for the session details.

## 2. Create a draft room

1. Open `http://127.0.0.1:3000/draft/new`.
2. Choose **Blue side** or **Red side**:
   - **Blue** has the first overall pick on turn 7.
   - **Red** has the counter-pick advantage on turn 9.
3. Select **Create draft**. The app creates the room and opens
   `/draft/<code>`.

The room starts in **Waiting for opponent**. The seven-character draft code is
shown in large type and can be copied with **Copy code**. The waiting room
also shows a spectator link for public viewing.

## 3. Invite the opponent

Send the draft code to the other player. They sign in, open
`/draft/<code>`, and automatically claim the remaining side. The draft starts
immediately at turn 1 once both sides are filled.

- If the opponent opens the room while the draft is still waiting, they join
  the free side.
- If both sides are already filled, the join is rejected and the room
  reports that it already has two players or is no longer accepting players.
- A waiting room that never receives a second player is removed after five
  minutes. Its code then resolves as not found.

## 4. Draft schedule

The server runs the fixed 21-turn schedule below. Each action turn has a
30-second timer. The timer is authoritative on the server; the interface
counts down and warns at 5, 3, and 1 seconds.

| Turns | Phase | Acting sides |
|---|---|---|
| 1–6 | Ban Phase 1 | Blue, Red, Blue, Red, Blue, Red |
| 7–12 | Pick Phase 1 | Blue, Red, Red, Blue, Blue, Red |
| 13–16 | Ban Phase 2 | Red, Blue, Red, Blue |
| 17–20 | Pick Phase 2 | Red, Blue, Blue, Red |
| 21 | Finalization | Neither side acts; 60-second swap window |

Each side ends with five bans and five picks.

## 5. Ban and pick

On your turn, the phase panel shows the searchable champion pool and a timer.

1. Click a champion card to stage it. Click it again to clear the selection.
2. Select **Lock ban** or **Lock pick** to confirm.
3. Press **Enter** to lock the staged champion, or **Escape** to clear it.

A staged selection is private: your opponent does not see it until you lock.
Once locked, the server persists it and broadcasts the confirmed ban or pick to
both players.

Availability rules are enforced on the server and reflected in the pool:

- A champion that is already banned is marked **Banned** and cannot be
  selected.
- A champion that is already picked is marked **Picked** and cannot be
  selected.
- A locked pick can never be banned later in the same draft.

If the timer expires:

- with a staged champion, that champion is locked;
- without a staged champion on a pick turn, the first available champion in
  alphabetical order is locked;
- without a staged champion on a ban turn, the ban is skipped.

The draft always advances exactly once per turn, even if a lock races the
timer.

## 6. Finalization

After turn 20, the room enters **Finalization** for 60 seconds. Both players
see the five locked picks for each side.

- Click **Swap Pick** on one of your own picks, then click another of your own
  picks to exchange them.
- Swaps are immediate, unlimited during the window, and never require the
  opponent's approval.
- Opponent picks are read-only; a cross-side swap is rejected.
- After the timer ends, swaps are rejected and the draft is marked
  **COMPLETE**.

When Finalization ends, the room shows **Draft complete**, the final pick order
for both sides, and the completion time. The final bans remain available in
the spectator view.

## 7. Watch as a spectator

The waiting room and live room show a public link in the form
`/d/<code>`. Anyone with the link can open it without an account:

- the draft status, phase, timer, participants, locked bans, and locked picks
  update live;
- staged selections are never shown;
- an unknown or expired code shows a not-found message without draft details;
- the final result remains viewable after completion.

A spectator's connection has its own 30-second reconnect window. If it stays
offline longer, the page reports that the spectator session ended. A
spectator disconnect never expires the draft; only participant disconnects
start the player grace period.

See [`docs/spectator-viewing.md`](spectator-viewing.md) for the public/private
data boundary.

## 8. Connection loss and reconnection

If your socket connection drops, the interface keeps the last confirmed bans,
picks, and turn on screen and shows the reconnecting state. On reconnect it
rejoins the room and receives the current turn with the real remaining
countdown.

If you stay disconnected for more than 30 seconds, the draft is marked
**EXPIRED** and both players see an explanation. Create a new draft to play
again. A spectator staying offline cannot cause this expiry.

## 9. Theme and responsive controls

- Use the theme toggle to switch between light and dark. The choice is saved
  in browser storage and restored before the page paints on later visits.
- The board and champion pool adapt to narrow screens. Selection, lock, and
  keyboard controls remain available on mobile layouts.
- The connection indicator shows connected, reconnecting, and disconnected
  states, plus measured latency while connected.

## Related documents

- [`docs/local-development.md`](local-development.md) — start the stack and
  create accounts locally.
- [`docs/api.md`](api.md) — HTTP and Socket.IO contracts.
- [`docs/troubleshooting.md`](troubleshooting.md) — fixes for common failures.
