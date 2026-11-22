# Tasks

The checklist below reconciles the original implementation breakdown with the behavior that is now present. Completed items are marked only where the corresponding behavior exists in the repository. Unchecked items remain implementation or verification work.

## 1. Foundation and persistence

- [x] 1.1 Create the `frontend/`, `backend/`, `docker/`, and `scripts/` project layout and verify the expected directories are present
- [x] 1.2 Add backend, frontend, and root environment templates plus ignore rules, and verify no local secret file is tracked
- [x] 1.3 Define the User, Draft, Ban, Pick, and SessionToken Prisma models with the initial migration, and verify the migration and schema are present
- [x] 1.4 Add the backend and frontend container builds plus the four-service Compose topology, and verify `docker compose config` resolves the services
- [x] 1.5 Add the API health endpoint and PostgreSQL initialization script, and verify `/health` is routed by the backend application

## 2. Authentication

- [x] 2.1 Implement registration and login with unique identities and bcrypt password hashing, and verify duplicate identities and invalid passwords are rejected
- [x] 2.2 Issue 15-minute JWT access tokens and protect HTTP participant routes, and verify an expired or malformed token is rejected
- [x] 2.3 Store opaque refresh tokens in Redis and rotate them on every refresh, and verify the previous refresh token cannot be reused
- [x] 2.4 Apply the Redis-backed five-attempt login limit and the Socket.IO JWT handshake guard, and verify invalid presented socket credentials are disconnected
- [x] 2.5 Implement the frontend login, registration, auth context, bearer interceptor, refresh-on-401 flow, and protected routes, and verify a refreshed session restores the current user
- [ ] 2.6 Add backend unit and integration tests for registration, login, token expiration, refresh rotation, and rate limiting, and verify the auth test suite passes
- [ ] 2.7 Document account and session behavior, and verify the documented login, registration, and refresh flows match the API routes

## 3. Champion catalog

- [x] 3.1 Fetch the latest patch and normalized champion names and icon URLs from Data Dragon, and verify the API response contains identifier, name, and icon URL fields
- [x] 3.2 Cache the patch-aware champion catalog in Redis with version checks, retry/backoff, and a bounded timeout, and verify a cache hit does not refetch the champion payload
- [x] 3.3 Load and share the champion pool in the frontend with loading, ready, and unavailable states, and verify the pool can be searched by champion name
- [ ] 3.4 Add backend tests for cache hits, patch changes, retries, corrupt cache entries, and total CDN failure, and verify the champion service test suite passes

## 4. Draft room lifecycle

- [x] 4.1 Create waiting drafts with an unambiguous seven-character code and creator-selected side, and verify the persisted draft begins in `WAITING_FOR_PLAYERS`
- [x] 4.2 Claim a remaining side atomically and start turn 1 when both sides are occupied, and verify simultaneous claims cannot assign one side twice
- [x] 4.3 Fetch participant draft state and remove waiting drafts that remain incomplete for five minutes, and verify stale waiting codes resolve as not found
- [ ] 4.4 Remove Fearless mode configuration from the draft lifecycle (toggle endpoint, session flag, persistence column) and verify no Fearless control remains on the backend
- [x] 4.5 Implement the waiting-room, join, participant, complete, and expired room states with a shareable spectator link, and verify each state renders its corresponding outcome
- [ ] 4.6 Add backend integration tests for create, join races, idempotent rejoin, waiting cleanup, and completed-state lookup, and verify the room lifecycle test suite passes
- [ ] 4.7 Document draft creation, code sharing, and side assignment, and verify the instructions work in a fresh local environment

## 5. Real-time turn engine

- [x] 5.1 Authenticate participant sockets, join draft rooms, and track live presence, and verify a non-participant cannot join a participant room
- [x] 5.2 Validate Socket.IO payloads and render handler errors as acknowledgements or exception events, and verify malformed event bodies are rejected
- [x] 5.3 Implement the fixed 21-turn ban, pick, and finalization schedule, and verify turn phase, expected side, and duration match the specification
- [x] 5.4 Implement deadline-based 30-second action timers, 60-second finalization, 5/3/1 warnings, and reconnect countdown restoration, and verify a reconnect does not reset an active deadline
- [x] 5.5 Persist and broadcast confirmed bans and picks under an exclusive per-turn claim, and verify a lock racing the timer cannot advance the draft twice
- [x] 5.6 Enforce banned and picked champion availability on the server for selections and locks, and verify invalid champions leave the turn unresolved
- [x] 5.7 Resolve an expired turn deterministically by locking a staged champion, choosing the first available champion for an unstaged pick, or skipping an unstaged ban, and verify each branch advances exactly once
- [x] 5.8 Clear stale participant state when switching to a different draft room, and verify the new room never renders the previous room's bans, picks, or turn
- [ ] 5.9 Enforce one ban rule on the server and the ban board — a champion that is already banned or already picked is never bannable — and verify the server rejects the selection and the board disables the card
- [ ] 5.10 Add backend unit and integration tests for turn ownership, legality, timer races, timeout fallback, reconnect behavior, and Redis-session rebuilding, and verify the turn engine test suite passes

## 6. Finalization and completion

- [x] 6.1 Advance through Ban Phase 2 and Pick Phase 2 to five locked picks per side and then the finalization phase, and verify the persisted turn reaches 21
- [x] 6.2 Accept only unlimited same-side swaps between locked picks during finalization, and verify a cross-side or post-expiry swap is rejected
- [x] 6.3 Persist and broadcast the reordered pick list after every valid swap, and verify both participant clients receive the authoritative order
- [x] 6.4 Mark the draft complete with a completion timestamp after the finalization timer and broadcast the final bans and picks, and verify participant and public results resolve the completed draft
- [ ] 6.5 Add backend and end-to-end tests for phase transitions, swap constraints, repeated swaps, timer completion, and durable result retrieval, and verify the finalization test suite passes

## 7. Public spectator viewing

- [x] 7.1 Provide an unauthenticated public draft snapshot containing public state, locked history, and the current turn, and verify pending selections are absent
- [x] 7.2 Add an anonymous spectator socket and a separate sanitized public room, and verify public broadcasts contain no staged selections
- [x] 7.3 Implement the public `/d/:code` page with waiting, live, complete, and expired states, and verify a valid link updates without authentication
- [x] 7.4 Preserve the spectator view across a short disconnection and report the end of a connection that remains offline for 30 seconds, and verify a spectator disconnect cannot expire the draft
- [x] 7.5 Remove expired drafts and their dependent history after the retention period, and verify stale public codes resolve as not found
- [ ] 7.6 Add end-to-end tests for public access, state sanitization, live updates, reconnect behavior, completed results, and invalid codes, and verify the spectator test suite passes
- [ ] 7.7 Document how to create and share a spectator link and which draft details are public, and verify the instructions match the current routes

## 8. Interface feedback and accessibility

- [x] 8.1 Render the responsive draft board with Blue and Red pick rails, ten ban slots, phase labels, and a 21-turn progress indicator, and verify the board reflects confirmed server state
- [x] 8.2 Distinguish available, picked, and banned champions in the searchable pool and prevent unavailable champions from being selected, and verify each state is visibly and semantically distinguishable
- [x] 8.3 Provide loading skeletons, error boundaries, action toasts, champion-pool errors, and structured draft errors, and verify failures do not leave an indefinitely pending action
- [x] 8.4 Add Escape/Enter keyboard shortcuts and responsive layouts for mobile and desktop, and verify selection controls remain usable at narrow widths
- [x] 8.5 Show connection, reconnect, ping-latency, and expired-session states, and verify a dropped socket preserves the last confirmed draft state
- [x] 8.6 Add a site-wide light/dark theme with pre-paint restoration and browser-storage persistence, and verify a saved preference is applied on the next visit
- [ ] 8.7 Add frontend component and accessibility tests for champion states, keyboard controls, responsive behavior, error feedback, and theme restoration, and verify the frontend test suite passes
- [ ] 8.8 Remove the Fearless toggle from the draft interface and verify the waiting room no longer offers the mode

## 9. Security hardening

- [ ] 9.1 Audit backend and frontend dependencies and remediate actionable findings, and verify `npm audit` output is reviewed for both packages
- [ ] 9.2 Test the local-origin CORS policy and public endpoint boundary, and verify disallowed browser origins cannot read participant API responses
- [ ] 9.3 Exercise JWT expiration, refresh-token replay, login rate limits, and logout behavior, and verify each abuse case is rejected as specified
- [ ] 9.4 Exercise input validation, SQL-injection attempts, and authentication-bypass paths across HTTP and Socket.IO routes, and verify malformed or unauthorized requests change no state
- [ ] 9.5 Review logs and responses for passwords, tokens, and sensitive draft details, and verify no secret value is emitted
- [ ] 9.6 Add automated security regression coverage for the verified cases, and verify the security test suite passes
- [ ] 9.7 Document the local trust boundary, environment secrets, and deployment security assumptions, and verify the document matches the Compose and CORS configuration

## 10. Container hardening

- [x] 10.1 Use multi-stage backend and frontend container builds, and verify each image contains only the runtime files required by its command
- [x] 10.2 Use Alpine-based Node runtime images, and verify the backend and frontend image bases are lightweight Node variants
- [x] 10.3 Add backend and frontend `.dockerignore` files, and verify local dependencies, build output, and secrets are excluded from build context
- [ ] 10.4 Optimize dependency installation and build-layer caching, and verify a repeated image build reuses unchanged dependency layers
- [ ] 10.5 Run both application containers as a non-root user, and verify the runtime user cannot write outside its permitted paths
- [ ] 10.6 Add Compose health checks for the web and API services and make dependencies honor them, and verify `docker compose ps` reports healthy services
- [ ] 10.7 Add an image smoke test that starts the stack and verifies the API health and champion endpoints, and verify the smoke test passes from a clean build

## 11. Continuous integration

- [ ] 11.1 Add a GitHub Actions workflow triggered by pushes and pull requests, and verify the workflow file is discovered by GitHub Actions
- [ ] 11.2 Configure formatting and lint checks for backend and frontend, and verify the workflow fails on a deliberate lint error
- [ ] 11.3 Run backend and frontend unit tests on every push and pull request, and verify the CI log reports the test results
- [ ] 11.4 Run the end-to-end draft suite against the Compose services for pull requests, and verify a full draft completes in CI
- [ ] 11.5 Build and deploy the local Compose images on the main branch, and verify the deployment job publishes the expected service images
- [ ] 11.6 Document CI prerequisites, secrets, and local reproduction commands, and verify a maintainer can run the same checks locally

## 12. Project documentation

- [x] 12.1 Create the initial README with the project overview, repository layout, services, and quickstart, and verify the documented service names and ports match Compose
- [ ] 12.2 Reconcile the README with the implemented single-draft scope and Data Dragon integration, and verify it no longer claims Bo3/Bo5 or a Riot developer API key
- [ ] 12.3 Document prerequisites, environment configuration, database initialization, and local startup, and verify the commands work from a clean checkout
- [ ] 12.4 Write the participant guide for room creation, side selection, bans, picks, timers, finalization, and public viewing, and verify each step matches the interface
- [ ] 12.5 Add troubleshooting for invalid codes, expired drafts, unavailable champion data, authentication failures, and connection loss, and verify each remedy resolves the documented failure
- [ ] 12.6 Document the HTTP and Socket.IO API contracts, including authentication, event payloads, and error shapes, and verify examples match the implemented routes and types
- [ ] 12.7 Add a documentation link and command check, and verify all local links and documented commands resolve successfully

## Workflow follow-up

- Run `openspec-verify-change` after the implementation and pending verification work agree with the delta.
- Run `openspec-archive-change` only after the remaining tracked tasks are complete or explicitly re-scoped.
