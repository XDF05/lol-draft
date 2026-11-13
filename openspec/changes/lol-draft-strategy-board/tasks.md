# Implementation Tasks

## Overview

This document outlines the implementation tasks for the League of Legends Draft Strategy Board, organized by phase and dependency.

---

## Phase 1: Foundation & Setup

### T-001: Project Initialization
**ID**: TASK-PHASE1-T001  
**Priority**: High  
**Estimate**: 2 hours  
**Dependencies**: None  
**Deliverable**: Repository with Docker configuration

**Tasks**:
- [ ] Initialize Git repository structure
- [ ] Set up project directories (frontend/, backend/, docker/)
- [ ] Create Dockerfile for Next.js frontend
- [ ] Create Dockerfile for NestJS backend
- [ ] Configure docker-compose.yml with all services
- [ ] Set up .env.example files for environment variables
- [ ] Add .gitignore with IDE exclusions

**Acceptance Criteria**:
```bash
$ docker-compose up -d
# All services (web, api, db, redis) start successfully
# Database health check passes
# Redis is accepting connections
```

**Test Commands**:
```bash
docker-compose ps
docker-compose logs web  # Should show successful startup
docker-compose logs api  # Should show database connection
```

---

### T-002: Database Schema & Migration
**ID**: TASK-PHASE1-T002  
**Priority**: High  
**Estimate**: 3 hours  
**Dependencies**: T-001  
**Deliverable**: Prisma schema with all required models

**Tasks**:
- [ ] Create Prisma schema file (schema.prisma)
- [ ] Define User model with authentication fields
- [ ] Define Draft model with turn tracking
- [ ] Define Ban and Pick models with proper foreign keys
- [ ] Add indexes for performance optimization
- [ ] Create migration files for PostgreSQL
- [ ] Initialize Prisma Client in backend

**Acceptance Criteria**:
```bash
$ npx prisma db push --schema=./prisma/schema.prisma
# Migration succeeds without errors

$ npx prisma studio
# Can connect to database and view tables
```

---

### T-003: Authentication System (Backend)
**ID**: TASK-PHASE1-T003  
**Priority**: High  
**Estimate**: 5 hours  
**Dependencies**: T-002  
**Deliverable**: JWT-based authentication in NestJS

**Tasks**:
- [ ] Install dependencies (bcryptjs, jsonwebtoken, class-validator)
- [ ] Create AuthModule with module definition
- [ ] Implement UserEntity and DTOs
- [ ] Create LoginController with password validation
- [ ] Create AuthService for token generation/validation
- [ ] Add JwtAuthGuard middleware
- [ ] Configure Redis for session storage
- [ ] Implement refresh token rotation

**Acceptance Criteria**:
```bash
$ curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"secure123"}'

# Response should contain:
{
  "access_token": "eyJ...",
  "refresh_token": "xyz...",
  "expiresIn": 900
}
```

**Security Requirements**:
- Password hashing with bcrypt (cost factor 12)
- JWT tokens expire after 15 minutes
- Refresh tokens stored in Redis with TTL
- Rate limiting: 5 login attempts per minute

---

### T-004: Authentication System (Frontend)
**ID**: TASK-PHASE1-T004  
**Priority**: High  
**Estimate**: 6 hours  
**Dependencies**: T-002, T-003  
**Deliverable**: React authentication UI with Next.js

**Tasks**:
- [ ] Install dependencies (react-router-dom, axios)
- [ ] Create LoginPage component with form validation
- [ ] Create RegisterPage component
- [ ] Implement useAuth hook for JWT management
- [ ] Add protected route wrapper components
- [ ] Configure HTTP interceptor to attach JWT
- [ ] Handle token refresh automatically
- [ ] Create AuthContext for global state

**Acceptance Criteria**:
```typescript
// Login success flow
const { user, token } = await login({ username, password });
useEffect(() => localStorage.setItem('auth_token', token), []);

// Protected route check
<ProtectedRoute>
  <DraftBoard />
</ProtectedRoute>
```

**Test Scenarios**:
- Successful login with valid credentials
- Invalid credentials show error message
- Session expires after 15 minutes → auto-refresh
- Protected routes redirect to login when unauthenticated

---

### T-005: Riot API Integration & Caching
**ID**: TASK-PHASE1-T005  
**Priority**: Medium  
**Estimate**: 4 hours  
**Dependencies**: T-002  
**Deliverable**: Champion data fetching with Redis cache

**Tasks**:
- [ ] Create RiotApiService in NestJS
- [ ] Implement GET /lol/champion/v4/datastore endpoint
- [ ] Fetch champion names and icon URLs for all champions
- [ ] Add Redis caching layer (TTL: 24 hours)
- [ ] Implement fallback retry with exponential backoff
- [ ] Create Champion data interface in TypeScript
- [ ] Add error handling for API failures
- [ ] Store champion pool in frontend store

**Acceptance Criteria**:
```typescript
// First request - hits Riot API
const champions = await riotApiService.getChampions();
// Response: { count: 140, data: [...] }

// Subsequent requests - cache hit
const cached = await redisService.get('champions:data');
// Returns same response without external call
```

**Performance Targets**:
- Cache hit ratio > 95% after initial load
- API fallback timeout: 30 seconds max
- Retry attempts: 3 with increasing delays (1s, 2s, 4s)

---

### T-006: Socket.IO Implementation (Server)
**ID**: TASK-PHASE1-T006  
**Priority**: High  
**Estimate**: 5 hours  
**Dependencies**: T-002  
**Deliverable**: Real-time event broadcasting infrastructure

**Tasks**:
- [ ] Install Socket.IO for NestJS (@nestjs/websockets)
- [ ] Create DraftEventsModule with socket configuration
- [ ] Implement SocketGateway with @MessagePattern decorators
- [ ] Add room management (join/leave broadcast rooms)
- [ ] Define server-side event handlers:
  - ban.select, ban.lock, ban.skip
  - pick.select, pick.lock, pick.skip
  - swap.request, swap.approve, swap.reject
- [ ] Implement event validation middleware
- [ ] Add connection health monitoring

**Acceptance Criteria**:
```typescript
@OnMessage('draft.join')
async handleDraftJoin(
  @Socket() socket: Socket,
  @Body() data: { code: string; team: 'BLUE' | 'RED' }
): Promise<void> {
  const draft = await this.prisma.draft.findUnique({
    where: { code: data.code }
  });
  
  if (!draft) throw new NotFoundHttpException('Draft not found');
  
  await socket.join(`draft:${draft.id}`);
  await this.eventEmitter.emitToRoom(
    `draft:${draft.id}`, 
    'turn.start', 
    getInitialTurn()
  );
}
```

---

### T-007: Socket.IO Client Implementation (Frontend)
**ID**: TASK-PHASE1-T007  
**Priority**: High  
**Estimate**: 4 hours  
**Dependencies**: T-005, T-006  
**Deliverable**: Real-time client for Next.js

**Tasks**:
- [ ] Install Socket.IO client in frontend
- [ ] Create useSocket custom hook
- [ ] Implement event listeners:
  - turn.start, turn.end
  - ban.confirmed, pick.confirmed
  - timer.warning, timer.expired
  - phase.ban1.start, etc.
- [ ] Add connection state indicator UI
- [ ] Implement automatic reconnection logic
- [ ] Handle disconnection gracefully (state preservation)
- [ ] Create socket event types definition

**Acceptance Criteria**:
```typescript
// Hook usage in component
const useDraftEvents = () => {
  const { currentTurn, bans, picks } = useDraftStore();
  
  useEffect(() => {
    socket.on('turn.start', (turn) => {
      dispatch(setCurrentTurn(turn));
    });
    
    return () => socket.off('turn.start');
  }, []);
};
```

---

## Phase 2: Core Draft System

### T-008: Draft Room Creation Flow
**ID**: TASK-PHASE2-T008  
**Priority**: High  
**Estimate**: 4 hours  
**Dependencies**: T-003, T-005, T-006  
**Deliverable**: New draft creation UI and backend

**Tasks**:
- [ ] Create DraftCreationController in NestJS
- [ ] Implement POST /draft/create endpoint
- [ ] Generate unique 7-character draft code
- [ ] Persist draft to PostgreSQL with WAITING_FOR_PLAYERS status
- [ ] Create DraftCreationPage in Next.js
- [ ] Build side selection UI (Blue/Red)
- [ ] Handle player arrival tracking
- [ ] Display "Waiting for opponent" message
- [ ] Add 30-second reconnection grace period logic

**Acceptance Criteria**:
```bash
$ curl -X POST http://localhost:4000/draft/create \
  -H "Authorization: Bearer $TOKEN"

# Response:
{
  "code": "ABC123X",
  "status": "WAITING_FOR_PLAYERS",
  "message": "Draft created. Send this code to your opponent."
}
```

**Edge Cases**:
- Duplicate code collision (generate new if exists)
- Player disconnects before opponent arrives → delete draft after 5 minutes
- Both players arrive simultaneously → assign sides based on connection order

---

### T-009: Ban Phase 1 Implementation
**ID**: TASK-PHASE2-T009  
**Priority**: High  
**Estimate**: 6 hours  
**Dependencies**: T-008  
**Deliverable**: Complete Ban Phase 1 with timer logic

**Tasks**:
- [ ] Create BanPhase component (shared by Blue/Red)
- [ ] Implement ban selection UI with champion cards
- [ ] Add champion pool filtering (exclude banned/picked)
- [ ] Implement lock button functionality
- [ ] Create server-side turn timer (30-second countdown)
- [ ] Implement auto-lock on timeout
- [ ] Emit ban.confirmed event to opponent
- [ ] Update PostgreSQL bans table
- [ ] Display warning states at 5s, 3s, 1s
- [ ] Add visual feedback for selection state

**Acceptance Criteria**:
```typescript
// Ban flow validation
async function handleBanAction(playerId: string, championId: string) {
  const draft = await getDraft();
  
  // Validate correct turn
  if (draft.currentTurn !== 1 && draft.currentTurn !== 2) {
    throw new Error('Not your turn');
  }
  
  // Check champion not already banned
  if (draft.bansPhase1[championId]) {
    throw new Error('Champion already banned');
  }
  
  // Apply ban
  await prisma.ban.upsert({ ... });
  
  // Broadcast to opponent
  socket.to(`player:${opponentId}`).emit('ban.confirmed', draft.bansPhase1);
}
```

**Timer States**:
```
WAITING ─► SELECTING ─► LOCKED ─► COMPLETED
   │           │             │            │
   ▼           ▼             ▼            ▼
0:30        0:28         Confirmed    Next turn begins
           (5s)      (Auto-lock)     (T+1 state update)
```

---

### T-010: Pick Phase 1 Implementation
**ID**: TASK-PHASE2-T010  
**Priority**: High  
**Estimate**: 6 hours  
**Dependencies**: T-009  
**Deliverable**: Complete Pick Phase 1 with asymmetric distribution

**Tasks**:
- [ ] Create PickPhase component variant
- [ ] Implement pick selection UI (similar to Ban but different flow)
- [ ] Add turn sequence logic:
  - Turn 7: Blue picks 1 champion
  - Turn 8: Red picks 1 champion
  - Turn 9: Red picks 2 champions (separate actions)
  - Turn 10-11: Blue picks 2 champions
  - Turn 12: Red picks 3rd pick of P1
- [ ] Validate pick against ban list and fearless mode
- [ ] Implement pick confirmation flow
- [ ] Update PostgreSQL picks table
- [ ] Broadcast pick updates to opponent immediately
- [ ] Display "Blue Advantage" / "Red Advantage" indicators

**Acceptance Criteria**:
```typescript
async function handlePickAction(playerId: string, championId: string) {
  // Fearless mode validation
  if (draft.fearlessMode) {
    const opponentPicks = draft.redPicks.filter(p => p.playerId !== playerId);
    if (opponentPicks.find(p => p.championId === championId)) {
      throw new Error('Cannot pick in fearless mode');
    }
  }
  
  // Normal mode validation
  const isBanned = draft.bans.some(b => b.championId === championId);
  if (isBanned) throw new Error('Champion banned');
  
  // Apply pick
  await prisma.pick.create({ ... });
  
  // Update state
  dispatch(addPick(championId));
}
```

**Visual Feedback**:
- Turn 9 & 10: Highlight "Red gets advantage pick" message
- Turn 12: Show counter-pick indicator for Red
- Each pick removes champion from available pool immediately

---

### T-011: Ban Phase 2 Implementation
**ID**: TASK-PHASE2-T011  
**Priority**: Medium  
**Estimate**: 4 hours  
**Dependencies**: T-010  
**Deliverable**: Complete Ban Phase 2 (counter-bans)

**Tasks**:
- [ ] Extend ban phase UI for Phase 2
- [ ] Implement turn sequence: Red first, then Blue alternate
- [ ] Validate against both Phase 1 bans and picks
- [ ] Support banning champions picked in Phase 1 (if not Fearless)
- [ ] Display "Counter-pick opportunity" message to Red Team
- [ ] Update ban tracking with phase distinction (ban#4, ban#5)
- [ ] Persist to separate bansPhase2 table collection

**Acceptance Criteria**:
```typescript
async function processBanP2(playerId: string, championId: string) {
  const draft = await getDraft();
  
  // Phase 2 rules
  const phase1Bans = [...draft.bansPhase1, ...draft.bansPhase2];
  
  if (phase1Bans.find(b => b.championId === championId)) {
    throw new Error('Cannot re-ban this champion');
  }
  
  // Fearless mode check for picked champions
  if (draft.fearlessMode) {
    const isPicked = draft.bluePicks.some(p => p.championId === championId) ||
                     draft.redPicks.some(p => p.championId === championId);
    if (isPicked) {
      throw new Error('Cannot ban picked champion in Fearless mode');
    }
  }
  
  // Apply ban
  await prisma.ban.create({ ... });
}
```

---

### T-012: Pick Phase 2 Implementation
**ID**: TASK-PHASE2-T012  
**Priority**: Medium  
**Estimate**: 4 hours  
**Dependencies**: T-011  
**Deliverable**: Complete Pick Phase 2 with final picks

**Tasks**:
- [ ] Extend pick phase UI for Phase 2
- [ ] Implement turn sequence: Red → Blue (advantage) → Red
- [ ] Validate picks against all bans and existing picks
- [ ] Calculate and display total picks per team (Blue: 5, Red: 5)
- [ ] Mark draft as COMPLETE after final pick locks
- [ ] Trigger save to database with completedAt timestamp
- [ ] Update draft status to 'COMPLETE'

**Acceptance Criteria**:
```typescript
async function handleFinalPick(playerId: string, championId: string) {
  const draft = await getDraft();
  
  // Verify this is the final turn
  if (draft.currentTurn !== 20) {
    throw new Error('Not the last pick');
  }
  
  // Final validation
  const isAvailable = !draft.bans.some(b => b.championId === championId);
  if (!isAvailable) throw new Error('Champion not available');
  
  // Apply and finalize
  await prisma.pick.create({ ... });
  
  // Mark draft complete
  await prisma.draft.update({
    where: { id: draft.id },
    data: { 
      status: 'COMPLETE',
      completedAt: new Date()
    }
  });
  
  // Notify public viewers
  socket.broadcast.emit('draft.completed', {
    bluePicks: draft.bluePicks,
    redPicks: draft.redPicks
  });
}
```

---

## Phase 3: Advanced Features

### T-013: Fearless Mode Toggle & Validation
**ID**: TASK-PHASE3-T013  
**Priority**: Medium  
**Estimate**: 3 hours  
**Dependencies**: T-008  
**Deliverable**: Fearless Drafting mode with proper state management

**Tasks**:
- [ ] Create FearlessToggle component with modal confirmation
- [ ] Implement POST /draft/:code/fearless-toggle endpoint
- [ ] Validate toggle only allowed before draft starts (status == WAITING_FOR_PLAYERS)
- [ ] Persist fearlessMode to draft record
- [ ] Add visual indicator in UI when enabled
- [ ] Show warning about permanent lock consequences
- [ ] Display "FEARLESS MODE ACTIVE" banner throughout draft

**Acceptance Criteria**:
```typescript
async function toggleFearless(draftCode: string, isFearless: boolean) {
  const draft = await prisma.draft.findUnique({
    where: { code: draftCode }
  });
  
  // Only allowed before draft starts
  if (draft.status !== 'WAITING_FOR_PLAYERS') {
    throw new UnauthorizedHttpException('Cannot toggle during active draft');
  }
  
  return await prisma.draft.update({
    where: { id: draft.id },
    data: { fearlessMode: isFearless }
  });
}

// Frontend validation
const canToggleFearless = useDraftStore.getState().draftStatus === 'WAITING_FOR_PLAYERS';
```

---

### T-014: Finalization Phase & Champion Swaps
**ID**: TASK-PHASE3-T014  
**Priority**: Medium  
**Estimate**: 5 hours  
**Dependencies**: T-012  
**Deliverable**: 60-second grace period with swap functionality

**Tasks**:
- [ ] Create FinalizationPhase component
- [ ] Implement 60-second countdown timer
- [ ] Add "Request Swap" button for each pick
- [ ] Create swap request workflow:
  1. Player selects their pick to swap
  2. Shows opponent's pick as target
  3. Other player approves or rejects
- [ ] Display swap requests prominently on both client screens
- [ ] Persist approved swaps to database
- [ ] Update pick ownership after swap approval
- [ ] Lock draft when timer expires

**Acceptance Criteria**:
```typescript
interface SwapRequest {
  id: string;
  playerId: string;
  requestingTeam: 'BLUE' | 'RED';
  championToSwapOutId: string;
  championToSwapWithId?: string; // Optional if player has no picks yet
  
  createdAt: Date;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

async function handleSwapRequest(playerId: string, swapData: SwapRequest) {
  const draft = await getDraft();
  
  // Create pending request
  await prisma.swapRequest.create({ data: { ...swapData } });
  
  // Broadcast to opponent
  socket.emitToRoom(`draft:${draft.id}`, 'swap.request.pending', swapData);
}

async function handleSwapApproval(requestId: string, approve: boolean) {
  const request = await prisma.swapRequest.findUnique({ 
    where: { id: requestId } 
  });
  
  if (!approve || request.status !== 'PENDING') {
    throw new UnauthorizedHttpException('Invalid approval');
  }
  
  // Update picks in database
  await prisma.$transaction(async (tx) => {
    // Revoke original pick from requesting player
    const swapOut = await tx.pick.findUnique({ 
      where: { id: request.championToSwapOutId } 
    });
    
    await tx.pick.delete({ where: { id: swapOut.id } });
    
    // Create new pick for swapped champion (if needed)
    // ...
  });
  
  request.status = 'APPROVED';
}
```

---

### T-015: Public Viewing System
**ID**: TASK-PHASE3-T015  
**Priority**: Medium  
**Estimate**: 4 hours  
**Dependencies**: T-012, T-009  
**Deliverable**: Link-based spectator access with reconnection

**Tasks**:
- [ ] Create SpectatorView page in Next.js
- [ ] Implement public draft link generator (/d/:code)
- [ ] Add socket connection for public viewers (no auth required)
- [ ] Display real-time ban/pick updates to spectators
- [ ] Show timer and phase information
- [ ] Implement 30-second reconnection grace period logic
- [ ] Auto-delete draft after session timeout
- [ ] Display "Draft Complete" results when finished

**Acceptance Criteria**:
```typescript
// Spectator connection flow
const socket = io();
socket.on('connect', () => {
  // Join broadcast room without authentication
  socket.emit('public.join', { 
    draftCode: 'ABC123X' 
  });
});

// Reconnection logic
const RECONNECT_TIMEOUT_MS = 30000; // 30 seconds

socket.on('disconnect', () => {
  const reconnectAttempts = setInterval(async () => {
    await socket.emit('public.join', { draftCode: 'ABC123X' });
    
    setTimeout(() => {
      clearInterval(reconnectAttempts);
      // Mark draft as expired if not reconnected
      prisma.draft.update({
        where: { code: 'ABC123X' },
        data: { status: 'EXPIRED', completedAt: new Date() }
      });
    }, RECONNECT_TIMEOUT_MS);
  }, 5000); // Retry every 5 seconds
});
```

---

### T-016: Timer & Phase Management
**ID**: TASK-PHASE3-T016  
**Priority**: Medium  
**Estimate**: 4 hours  
**Dependencies**: T-009, T-010  
**Deliverable**: Robust timer system with accurate countdowns

**Tasks**:
- [ ] Create TurnManager service for phase orchestration
- [ ] Implement 30-second timer per ban/pick action
- [ ] Add 60-second timer for Finalization phase
- [ ] Create visual countdown display component
- [ ] Implement warning states (5s: yellow, 3s: orange, 1s: red)
- [ ] Auto-increment to next turn on lock/timeout
- [ ] Handle timer resets properly
- [ ] Add server-side timer validation

**Acceptance Criteria**:
```typescript
class TurnManager {
  private timers: Map<string, NodeJS.Timeout>;
  
  startTimer(turnId: string, durationMs: number): void {
    const countdown = durationMs;
    
    this.timers.set(turnId, setInterval(() => {
      countdown -= 1000;
      this.emit('timer.update', { turnId, remainingSeconds: Math.floor(countdown / 1000) });
      
      if (countdown <= 0) {
        clearInterval(this.timers.get(turnId)!);
        this.handleTimeout(turnId);
      }
    }, 1000);
    
    // Immediate warning state emission
    this.emit('timer.update', { turnId, remainingSeconds: durationMs });
  }
  
  handleTimeout(turnId: string): void {
    // Auto-lock mechanism triggers
    const selectedChampion = getPendingSelection();
    broadcastBanOrPick(selectedChampion);
    
    advanceToNextTurn();
  }
}
```

---

### T-017: Error Handling & Edge Cases
**ID**: TASK-PHASE3-T017  
**Priority**: High  
**Estimate**: 4 hours  
**Dependencies**: All Phase 2 tasks  
**Deliverable**: Robust error handling and edge case coverage

**Tasks**:
- [ ] Implement global error handler in NestJS (HttpExceptionFilter)
- [ ] Create custom exceptions for draft-specific errors:
  - DraftNotFoundError
  - InvalidTurnException
  - ChampionUnavailableException
  - FearlessModeViolationException
- [ ] Add client-side error boundary components
- [ ] Handle network disconnection scenarios
- [ ] Implement state reconciliation on reconnection
- [ ] Create "Draft Expired" UI with option to create new draft
- [ ] Add validation for invalid draft codes (404 vs 503 messages)
- [ ] Test with simulated slow/unstable connections

**Acceptance Criteria**:
```typescript
// Global error handler
@UseFilters(DraftHttpExceptionFilter)
@Controller('draft')

class DraftController {}

// Filter implementation
class DraftHttpExceptionFilter extends ExceptionFilter {
  catch(exception: HttpException) {
    if (exception instanceof NotFoundHttpException) {
      return { 
        code: 'DRAFT_NOT_FOUND', 
        message: 'This draft has expired or does not exist' 
      };
    }
    
    if (exception instanceof ForbiddenException) {
      return { 
        code: 'UNAUTHORIZED', 
        message: 'Access denied to this draft room' 
      };
    }
    
    // Log server error
    this.logger.error(exception.message);
    return { code: 'INTERNAL_ERROR', message: 'A system error occurred' };
  }
}
```

---

### T-018: Loading States & UX Polish
**ID**: TASK-PHASE3-T018  
**Priority**: Medium  
**Estimate**: 3 hours  
**Dependencies**: T-006, T-012  
**Deliverable**: Smooth loading indicators and polish

**Tasks**:
- [ ] Create LoadingSpinner component variants
- [ ] Add skeleton loaders for champion cards
- [ ] Implement optimistic UI updates (update local state before server confirmation)
- [ ] Add toast notifications for actions completed
- [ ] Display connection quality indicator (ping latency)
- [ ] Show draft progress bar across all phases
- [ ] Add keyboard shortcuts (Esc to cancel, Enter to confirm)
- [ ] Implement responsive design for different screen sizes

**Acceptance Criteria**:
```typescript
// Optimistic UI pattern
async function lockPick() {
  // Update UI immediately
  optimisticUpdateState(pickedChampion);
  
  try {
    await socket.emit('pick.lock');
  } catch (error) {
    // Rollback on error
    revertOptimisticUpdate();
    showToast('Failed to lock pick. Please try again.');
  }
}
```

---

## Phase 4: Testing & Deployment

### T-019: Unit Tests (Backend)
**ID**: TASK-PHASE4-T019  
**Priority**: High  
**Estimate**: 8 hours  
**Dependencies**: All Phase 2 tasks  
**Deliverable**: Comprehensive unit test suite for NestJS services

**Tasks**:
- [ ] Install testing dependencies (@nestjs/testing, jest, supertest)
- [ ] Configure Jest with NestJS module setup
- [ ] Write tests for:
  - DraftService (ban/pick validation logic)
  - AuthService (JWT generation/validation)
  - RiotApiService (API calls, caching)
  - TurnManager (timer logic, turn progression)
- [ ] Test edge cases for each service
- [ ] Achieve >80% code coverage minimum

**Acceptance Criteria**:
```bash
$ npm run test:unit -- --coverage
# Coverage report shows >80% coverage across services
# All tests pass with zero failures
```

---

### T-020: Integration Tests (E2E)
**ID**: TASK-PHASE4-T020  
**Priority**: High  
**Estimate**: 6 hours  
**Dependencies**: T-019, T-008  
**Deliverable**: End-to-end test scenarios for complete draft flow

**Tasks**:
- [ ] Install Playwright or Cypress for E2E testing
- [ ] Configure Docker-based test environment
- [ ] Create test scenarios:
  - Complete draft sequence with manual locks
  - Timeout auto-lock behavior
  - Network disconnection recovery
  - Public viewing access validation
- [ ] Test Fearless mode toggle and validation
- [ ] Verify database persistence after completion

**Acceptance Criteria**:
```typescript
// E2E test example (Playwright)
test('complete draft sequence', async ({ page }) => {
  // Player 1 creates draft
  await player1.login();
  await page.goto('/draft/new');
  await page.click('button:has-text("Blue Team")');
  
  // Wait for opponent to join...
  
  // Verify all phases complete within ~14 minutes
  const totalTime = await measureTime(
    async () => {
      // ... simulate clicks through all turns
    }
  );
  
  expect(totalTime).toBeLessThan(14 * 60 * 1000); // < 14 minutes
});
```

---

### T-021: Security Audit & Hardening
**ID**: TASK-PHASE4-T021  
**Priority**: High  
**Estimate**: 4 hours  
**Dependencies**: T-019, T-020  
**Deliverable**: Security validation and hardening

**Tasks**:
- [ ] Run dependency audit (npm audit, yarn audit)
- [ ] Test for SQL injection vulnerabilities (Prisma ORM should prevent)
- [ ] Validate CORS configuration (localhost only)
- [ ] Check JWT token expiration enforcement
- [ ] Verify rate limiting works correctly
- [ ] Test authentication bypass attempts
- [ ] Review input sanitization on all endpoints
- [ ] Ensure no sensitive data in logs

**Acceptance Criteria**:
```bash
# Dependency security check
$ npm audit
# Should show only low/moderate vulnerabilities with fix advice

# JWT brute force attempt (should be blocked by rate limit)
$ for i in {1..20}; do \
    curl -X POST http://localhost:4000/auth/login \
      -d '{"username":"admin","password":"wrong"}'; \
  done

# Should return HTTP 429 Too Many Requests on 5th attempt
```

---

### T-022: Docker Image Optimization
**ID**: TASK-PHASE4-T022  
**Priority**: Medium  
**Estimate**: 3 hours  
**Dependencies**: T-001, T-008  
**Deliverable**: Multi-stage Docker builds for production

**Tasks**:
- [ ] Create multi-stage Dockerfiles (build + runtime)
- [ ] Use lightweight base images (alpine, slim)
- [ ] Add .dockerignore to reduce image size
- [ ] Implement build cache optimization
- [ ] Run containers as non-root user
- [ ] Add health check endpoints

**Acceptance Criteria**:
```dockerfile
# Multi-stage example
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/main"]
```

---

### T-023: CI/CD Pipeline Setup
**ID**: TASK-PHASE4-T023  
**Priority**: High  
**Estimate**: 5 hours  
**Dependencies**: T-019, T-022  
**Deliverable**: GitHub Actions workflow for automated testing and deployment

**Tasks**:
- [ ] Create .github/workflows/ci-cd.yml
- [ ] Implement "push" trigger for test suite
- [ ] Add linting step (ESLint, Prettier)
- [ ] Configure unit tests on push to any branch
- [ ] Set up E2E tests on pull request
- [ ] Create "main" branch deployment workflow
- [ ] Build Docker images on main merge
- [ ] Deploy updated containers using docker-compose

**Acceptance Criteria**:
```yaml
# .github/workflows/ci-cd.yml
name: CI/CD Pipeline

on:
  push:
    branches: ['main']
  pull_request:
    branches: ['main']

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run tests
        run: npm ci && npm run test:e2e
      
  build:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - name: Build images
        run: docker-compose --profile build build
      - name: Deploy
        run: docker-compose up -d
```

---

### T-024: Documentation & User Guide
**ID**: TASK-PHASE4-T024  
**Priority**: Medium  
**Estimate**: 3 hours  
**Dependencies**: All tasks  
**Deliverable**: Complete documentation for users and maintainers

**Tasks**:
- [ ] Create README.md with project overview
- [ ] Document installation steps (prerequisites, docker-compose)
- [ ] Add local deployment instructions
- [ ] Create user guide for playing drafts
- [ ] Explain Fearless Mode mechanics
- [ ] Document public viewing access method
- [ ] Add troubleshooting section (common issues)
- [ ] Include API documentation (Swagger/OpenAPI if applicable)

**Acceptance Criteria**:
```markdown
# README.md Contents:
## Installation
1. Prerequisites (Docker, Node.js 18+)
2. Environment setup (.env file)
3. Docker Compose command
4. Verification steps

## First Draft
1. Create draft link
2. Share with opponent
3. Start drafting instructions

## Features
- Real-time drafting
- Fearless Mode explained
- Public viewing access
```

---

## Task Summary & Timeline

| Phase | Tasks | Est. Hours | Deliverables |
|-------|-------|------------|--------------|
| 1: Foundation | T-001 to T-007 | 29h | Docker setup, Auth, Riot API, Socket.IO |
| 2: Core Draft System | T-008 to T-012 | 24h | Complete draft flow (Ban/Pick phases) |
| 3: Advanced Features | T-013 to T-018 | 26h | Fearless mode, Swaps, Public viewing |
| 4: Testing & Deploy | T-019 to T-024 | 24h | Tests, CI/CD, Documentation |
| **TOTAL** | **23 Tasks** | **103 hours** | **Production-ready application** |

---

## Priority Matrix

### Must Have (Phase 1 & 2)
- ✅ All authentication and connection flow
- ✅ Ban Phase 1 & 2 complete
- ✅ Pick Phase 1 & 2 complete
- ✅ Basic error handling

### Should Have (Phase 3)
- ⚠️ Fearless Mode toggle
- ⚠️ Champion swap functionality
- ⚠️ Public viewing system
- ⚠️ Timer precision and warnings

### Nice to Have (Phase 4 - Optional)
- 📝 Unit test coverage >80%
- 🔒 Security audit results
- 📖 Comprehensive user documentation
- 🚀 Advanced CI/CD features

---

## Risk Mitigation Strategy

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Riot API rate limiting | Medium | High | Redis cache with 24h TTL |
| Socket.IO reconnection failures | Low | Medium | Grace period + state restoration |
| Database connection issues | Low | High | Docker networking + health checks |
| Security vulnerabilities | Low | Critical | OWASP guidelines, dependency audit |

---

## Success Criteria

- ✅ Complete draft within 14 minutes average
- ✅ No data loss during disconnections
- ✅ Public viewing refresh rate < 500ms
- ✅ Zero authentication bypass vulnerabilities
- ✅ CI/CD pipeline automated and reliable
- ✅ All core features tested and documented
