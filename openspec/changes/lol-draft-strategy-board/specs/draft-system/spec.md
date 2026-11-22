# Spec Delta

## Purpose

Provides the authenticated, real-time 1v1 League of Legends draft lifecycle, including account access, champion selection, finalization, persistence, and public viewing.

## ADDED Requirements

### Requirement: Account registration
The system SHALL allow a visitor to register with a unique username, unique email address, and password, and SHALL store only a one-way password hash.

#### Scenario: Successful registration
- **WHEN** a visitor submits an unused username, unused email address, and valid password
- **THEN** the system creates the account and returns its public identity without exposing the password hash

#### Scenario: Duplicate identity
- **WHEN** a visitor submits a username or email address that already belongs to an account
- **THEN** the system rejects the registration without changing the existing account

### Requirement: Authenticated session refresh
The system SHALL issue a short-lived access token and a single-use refresh token for an authenticated account, and SHALL rotate the refresh token when a valid session is refreshed.

#### Scenario: Expired access token
- **WHEN** a client presents an expired access token and a valid refresh token
- **THEN** the system invalidates the presented refresh token and returns a new access-token and refresh-token pair

#### Scenario: Invalid refresh token
- **WHEN** a client presents an unknown, expired, or already-used refresh token
- **THEN** the system rejects the request and returns no replacement tokens

### Requirement: Participant-only draft access
The system SHALL require a valid authenticated identity for creating, viewing, joining, and changing the configuration of a participant draft room.

#### Scenario: Unauthenticated participant request
- **WHEN** an unauthenticated client requests a participant-only draft operation
- **THEN** the system rejects the request without exposing or changing draft state

#### Scenario: Non-participant draft mutation
- **WHEN** an authenticated user who is not assigned to either side attempts to change the draft
- **THEN** the system rejects the mutation

### Requirement: Draft room creation
The system SHALL let an authenticated user create a waiting draft, assign that user to the selected side, and return an unambiguous seven-character draft code.

#### Scenario: Create a draft
- **WHEN** an authenticated user requests a new draft and chooses Blue or Red
- **THEN** the system persists a waiting draft, assigns the creator to the chosen side, and returns the draft code

### Requirement: Side assignment and draft start
The system SHALL assign each participant to one side without allowing two users to claim the same side, and SHALL start the first ban turn when both sides are occupied.

#### Scenario: Second participant joins
- **WHEN** an authenticated user joins a waiting draft through an unoccupied side
- **THEN** the system assigns that side and starts the draft at turn 1

#### Scenario: Simultaneous side claim
- **WHEN** two users attempt to claim the same remaining side concurrently
- **THEN** the system grants the side to exactly one request and rejects the conflicting request

### Requirement: Champion catalog availability
The system SHALL provide the current Data Dragon champion names and icon URLs, SHALL reuse the cached catalog while its patch remains current, and SHALL report a clear unavailable state when neither cache nor CDN can serve it.

#### Scenario: Champion catalog request
- **WHEN** the champion catalog is requested
- **THEN** the system returns each usable champion's identifier, name, and icon URL for the current patch

#### Scenario: Data Dragon is unavailable
- **WHEN** the champion catalog is absent from cache and the Data Dragon CDN remains unreachable after retries
- **THEN** the system reports that the champion pool is unavailable

### Requirement: Ban phase schedule
The system SHALL run six alternating ban turns in Ban Phase 1, starting with Blue, and four alternating ban turns in Ban Phase 2, starting with Red.

#### Scenario: Ban Phase 1 starts
- **WHEN** the draft enters Ban Phase 1
- **THEN** turns 1 through 6 alternate Blue and Red for three bans per side

#### Scenario: Ban Phase 2 starts
- **WHEN** the draft enters Ban Phase 2
- **THEN** turns 13 through 16 alternate Red and Blue for two additional bans per side

### Requirement: Pick phase schedule
The system SHALL run the specified asymmetric pick order for Pick Phases 1 and 2 and SHALL produce five locked picks for each side before finalization.

#### Scenario: Pick Phase 1 starts
- **WHEN** the draft enters Pick Phase 1
- **THEN** turns 7 through 12 assign picks in the order Blue, Red, Red, Blue, Blue, Red

#### Scenario: Pick Phase 2 starts
- **WHEN** the draft enters Pick Phase 2
- **THEN** turns 17 through 20 assign picks in the order Red, Blue, Blue, Red

### Requirement: Ban champion availability
The system SHALL reject a champion that is already banned, SHALL permit a locked pick to be counter-banned in Ban Phase 2 while Fearless mode is disabled, and SHALL reject that counter-ban while Fearless mode is enabled.

#### Scenario: Duplicate ban
- **WHEN** a player attempts to ban a champion already banned in the draft
- **THEN** the system rejects the selection

#### Scenario: Normal-mode counter-ban
- **WHEN** Fearless mode is disabled and a player attempts to ban a champion locked by the opponent
- **THEN** the system accepts the ban if that champion has not already been banned

#### Scenario: Fearless-mode counter-ban
- **WHEN** Fearless mode is enabled and a player attempts to ban a champion locked by the opponent
- **THEN** the system rejects the selection as already picked

### Requirement: Pick champion availability
The system SHALL prevent a player from picking a champion that is already banned or already locked in the current draft.

#### Scenario: Unavailable champion selected
- **WHEN** a player attempts to pick a banned or already-picked champion
- **THEN** the system rejects the selection and leaves the pending selection unchanged

### Requirement: Selection staging and locking
The system SHALL keep a staged ban or pick private to the selecting participant until it is locked, and SHALL persist and broadcast a confirmed selection to both participants.

#### Scenario: Selection is staged
- **WHEN** the acting participant selects a champion
- **THEN** the system records the pending selection without revealing it to the opponent

#### Scenario: Selection is locked
- **WHEN** the acting participant locks a valid pending selection
- **THEN** the system persists the locked ban or pick, clears the pending selection, and broadcasts the confirmed result

### Requirement: Turn timeout resolution
The system SHALL resolve an expired ban or pick turn exactly once, SHALL lock a staged selection, SHALL select the first available champion in alphabetical order for an expired pick turn without a staged champion, and SHALL skip an expired ban turn without a staged champion.

#### Scenario: Staged selection expires
- **WHEN** a turn expires with a valid staged champion
- **THEN** the system locks and persists that champion and advances the turn

#### Scenario: Unstaged pick turn expires
- **WHEN** a pick turn expires without a staged champion
- **THEN** the system locks the first available champion in alphabetical order and advances the turn

#### Scenario: Unstaged ban turn expires
- **WHEN** a ban turn expires without a staged champion
- **THEN** the system records the skip and advances the turn

### Requirement: Turn timers and synchronization
The system SHALL give each ban or pick action a 30-second server-authoritative timer, SHALL give finalization a 60-second timer, and SHALL synchronize confirmed state changes to connected participants.

#### Scenario: Timer warning threshold
- **WHEN** an action timer reaches 5, 3, or 1 remaining seconds
- **THEN** the system emits the corresponding warning state

#### Scenario: Reconnect during a turn
- **WHEN** a participant reconnects while a turn is active
- **THEN** the system returns the current turn and remaining countdown rather than granting a fresh timer

### Requirement: Fearless mode configuration
The system SHALL allow a participant to enable or disable Fearless mode only while the draft is waiting for players, and SHALL make the choice permanent once the draft starts.

#### Scenario: Toggle before start
- **WHEN** a participant changes Fearless mode while the draft is waiting
- **THEN** the system persists the new setting for both participants

#### Scenario: Toggle after start
- **WHEN** a participant attempts to change Fearless mode after the draft has started
- **THEN** the system rejects the change and preserves the locked setting

### Requirement: Finalization team-internal swaps
The system SHALL allow unlimited swaps between two locked picks belonging to the requesting participant's side during the 60-second finalization window, without requesting approval from the opposing side.

#### Scenario: Valid own-team swap
- **WHEN** a participant swaps two locked picks from their own side during finalization
- **THEN** the system exchanges the champions immediately, persists the new order, and broadcasts it to both sides

#### Scenario: Opposing-side swap
- **WHEN** a participant attempts to swap a pick belonging to the opposing side
- **THEN** the system rejects the swap

#### Scenario: Swap after finalization
- **WHEN** a participant attempts to swap picks after the finalization timer expires
- **THEN** the system rejects the swap

### Requirement: Draft completion and durable results
The system SHALL complete a draft when the finalization timer expires, SHALL persist its completion time and final locked ban/pick order, and SHALL make the completed result available to participants and spectators.

#### Scenario: Finalization timer expires
- **WHEN** the 60-second finalization timer expires
- **THEN** the system marks the draft complete, records the completion time, and broadcasts the final order

### Requirement: Participant reconnection and expiry
The system SHALL preserve the last confirmed draft state across a participant disconnection, SHALL restore that state when the participant returns within 30 seconds, and SHALL expire the draft when the participant remains absent beyond that grace period.

#### Scenario: Participant returns within grace period
- **WHEN** a participant reconnects within 30 seconds of their final participant socket disconnecting
- **THEN** the system restores the current draft state and cancels the expiry timer

#### Scenario: Grace period expires
- **WHEN** a participant remains disconnected for more than 30 seconds
- **THEN** the system marks the draft expired and informs the room

### Requirement: Public spectator viewing
The system SHALL allow a spectator to open a draft with its shared code without authenticating, SHALL provide a read-only live view, and SHALL exclude staged selections from public state.

#### Scenario: Spectator opens a valid draft
- **WHEN** a spectator opens the public link for a valid draft
- **THEN** the system shows the draft status, phase, timer, locked bans, and locked picks without requiring an account

#### Scenario: Public state is broadcast
- **WHEN** the system sends a draft-state update to spectators
- **THEN** the update contains no participant's staged selection

#### Scenario: Spectator opens an invalid draft
- **WHEN** a spectator opens an unknown or expired draft code
- **THEN** the system reports that the draft was not found without disclosing draft details

### Requirement: Draft cleanup
The system SHALL remove a waiting draft that has not received its second participant within five minutes, and SHALL retain an expired draft briefly before deleting it and its dependent history.

#### Scenario: Waiting draft times out
- **WHEN** a waiting draft remains incomplete for five minutes
- **THEN** the system deletes the draft and its live session

#### Scenario: Expired draft retention ends
- **WHEN** an expired draft has remained retained for five minutes
- **THEN** the system deletes the draft, its bans and picks, and its live session

### Requirement: Draft interface feedback
The system SHALL present the current phase, acting side, timer, locked bans, locked picks, unavailable champion states, connection state, and action errors in the draft interface.

#### Scenario: Champion becomes unavailable
- **WHEN** a champion has been banned or picked
- **THEN** the champion pool marks it unavailable and prevents it from being selected

#### Scenario: Connection drops
- **WHEN** the participant's socket connection drops
- **THEN** the interface preserves the last confirmed draft state and displays the reconnecting state

### Requirement: Theme preference
The system SHALL allow a visitor to switch between light and dark themes and SHALL preserve that preference for later visits when browser storage is available.

#### Scenario: Theme is changed
- **WHEN** a visitor activates the theme toggle
- **THEN** the interface applies the selected theme immediately

#### Scenario: Saved theme is restored
- **WHEN** the application loads with a valid saved theme preference
- **THEN** the application applies that theme before displaying the page content

### Requirement: Server-authoritative draft actions
The system SHALL validate authentication, room membership, acting side, current turn, and champion availability on the server before changing or broadcasting draft state.

#### Scenario: Invalid action is submitted
- **WHEN** a client submits a draft action for the wrong side, wrong phase, or unavailable champion
- **THEN** the system rejects the action without advancing the turn or changing durable state
