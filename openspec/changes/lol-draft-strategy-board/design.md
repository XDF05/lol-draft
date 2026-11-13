# System Architecture Design

## High-Level Overview

A real-time multiplayer draft simulator built on microservices architecture with WebSocket communication, state synchronization, and distributed caching for optimal performance.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                │
│  ┌───────────────────┐                    ┌───────────────────┐    │
│  │   Player 1 Client │                    │   Player 2 Client │    │
│  │     (Blue Team)   │                    │   (Red Team)      │    │
│  └─────────┬─────────┘                    └─────────┬─────────┘    │
│            │ WebSocket                              │ WebSocket     │
│            ▼                                        ▼                │
│  ┌───────────────────┐                    ┌───────────────────┐    │
│  │ Next.js/React     │◄─────sync─────────►│ Next.js/React     │    │
│  │ • Auth UI         │      Socket.IO      │ • Auth UI         │    │
│  │ • Champion Cards  │                    │ • Champion Cards  │    │
│  │ • Timer Display   │                    │ • Timer Display   │    │
│  │ • Pick/Ban Modal  │                    │ • Pick/Ban Modal  │    │
│  └─────────┬─────────┘                    └─────────┬─────────┘    │
└────────────┼────────────────────────────────────────┼──────────────┘
             │                                        │
             │              Socket.IO Server          │
             ▼                                        ▼
┌─────────────────────────┐      ┌──────────────────────────────────┐
│   API GATEWAY (NestJS)  │◄────►│    REAL-TIME ENGINE             │
│                         │      │                                  │
│ • JWT Authentication    │      │ Socket.IO Adapter               │
│ • Rate Limiter          │      │ • Room management                │
│ • CORS Policy           │      │ • Event routing                  │
│ • Input Validation      │      │ • Broadcasting                   │
│                         │      └──────────────┬───────────────────┘
│ • Controllers:          │                     │
│   - AuthController      │    ┌────────────────▼────────────────┐  │
│   - DraftController     │◄──►│        STATE MANAGEMENT         │  │
│   - ChampionController  │    │                                  │  │
│   - GameController      │    │ Redis Cluster                   │  │
│                          │    ├─────────────────────────────────┤  │
│ • Services:              │    │ • Draft session state           │  │
│   - DraftService         │    │ • Turn timer countdowns          │  │
│   - GameService          │    │ • Player connections             │  │
│   - ChampionService      │    │ • Lock states                    │  │
│   - AuthService          │    └──────────────┬───────────────────┘  │
│   - RiotAPIWrapper       │                   │                        │
│                          │                   ▼                        │
│ • Middleware:            │      ┌────────────────────────────────┐   │
│   - JwtAuth              │◄────►│         PERSISTENCE LAYER      │   │
│   - RequestValidator     │      │                                  │   │
│   - ErrorHandler         │      │ PostgreSQL 15                   │   │
│   - Logging              │      │ (Prisma ORM)                    │   │
│                          │      ├─────────────────────────────────┤   │
│ • DTOs & Validators:     │      │ Tables:                         │   │
│   - Ban/PickRequest      │      │ • users                         │   │
│   - FearlessToggleReq    │      │ • drafts                        │   │
│   - ChampionSelectDto    │      │ • picks                          │   │
│   - DraftCodeDto         │      │ • bans                           │   │
│                          │      └─────────────────────────────────┘   │
└──────────────────────────┘                                             │
                                                                          │
                    ┌──────────────────────────────────────────────────┐  │
                    │                EXTERNAL DEPENDENCIES             │  │
                    ├──────────────────────────────────────────────────┤  │
                    │  Riot Games API                                   │  │
                    │  • GET /lol/champion/v4/datastore/               │  │
                    │    → Returns champion names, icons, pool IDs      │  │
                    │                                                   │  │
                    │  Redis Cache Strategy:                           │  │
                    │  • Champion data TTL: 24h                        │  │
                    │  • Session tokens TTL: 15 min                    │  │
                    │  • Rate limit counters TTL: 5 min                │  │
                    └──────────────────────────────────────────────────┘  │
                                                                          │
```

## Component Architecture

### 1. Frontend Components (Next.js + React)

#### Application Structure
```
src/
├── app/                          # Next.js App Router
│   ├── draft/                   # Draft application pages
│   │   ├── new/                 # Create new draft
│   │   │   └── page.tsx        # Draft creation UI
│   │   ├── [code]/             # Active draft room
│   │   │   ├── layout.tsx      # Shared draft layout
│   │   │   ├── page.tsx        # Main draft board
│   │   │   └── join/          # Public viewing link
│   │   │       └── page.tsx    # Spectator view
│   │   └── results/[id]/       # Completed drafts
│   │       └── page.tsx        # Results display
│   ├── login/                   # Authentication pages
│   │   ├── page.tsx            # Login form
│   │   └── register/           # Registration
│   │       └── page.tsx
│   └── globals.css             # Global styles
│
├── components/                  # Reusable React components
│   ├── common/                 # Shared UI elements
│   │   ├── Button.tsx
│   │   ├── Modal.tsx
│   │   ├── TimerDisplay.tsx    # Countdown timer UI
│   │   └── LoadingSpinner.tsx
│   │
│   ├── draft/                  # Draft-specific components
│   │   ├── DraftBoard.tsx      # Main board layout
│   │   ├── ChampionCard.tsx    # Individual champion display
│   │   ├── BanPhase.tsx        # Ban phase UI
│   │   ├── PickPhase.tsx       # Pick phase UI
│   │   ├── TeamBanner.tsx      # Team identifier
│   │   └── FearlessToggle.tsx  # Mode toggle button
│   │
│   └── socket/                 # Socket.IO components
│       └── ConnectionIndicator.tsx
│
├── hooks/                      # Custom React hooks
│   ├── useSocket.ts           # Socket connection management
│   ├── useDraftState.ts      # Draft state subscription
│   ├── useTimer.ts            # Turn timer logic
│   ├── useChampionData.ts     # Champion list fetching
│   └── useAuth.ts             # Authentication handling
│
├── lib/                        # Utility libraries
│   ├── socket.ts              # Socket.IO client init
│   ├── api.ts                 # HTTP API client
│   ├── constants.ts           # Draft rules, timer values
│   └── types.ts               # TypeScript interfaces
│
└── store/                      # State management
    └── draftStore.ts          # Zustand/Redux store
```

#### Key UI Components

**DraftBoard Component**
```typescript
interface Props {
  blueTeam: Player;
  redTeam: Player;
  currentTurn: Turn;
  phase: DraftPhase;
  selectedChampion?: Champion;
  onLockSelection: (championId: string) => void;
  onSkipTurn: () => void;
}

const DraftBoard = ({ blueTeam, redTeam, currentTurn, ... }) => {
  const [selected, setSelected] = useState<string | null>(null);
  
  return (
    <div className="draft-board">
      {/* Top Banner */}
      <PhaseBanner phase={phase} turnNumber={currentTurn.number} />
      
      {/* Banned Champions Section */}
      <BannedChampions bans={currentTurn.bans} />
      
      {/* Main Selection Area */}
      <ChampionPool 
        champions={availableChampions}
        selectedId={selected}
        onSelect={setSelected}
        onLock={() => onLockSelection(selected)}
      />
      
      {/* Timer Display */}
      <TimerDisplay seconds={currentTurn.remainingSeconds} />
      
      {/* Action Button */}
      <ActionButton 
        disabled={!selected}
        onClick={onLockSelection}
      />
    </div>
  );
};
```

**ChampionCard Component**
```typescript
interface Props {
  champion: Champion;
  isSelected?: boolean;
  isBanned?: boolean;
  isPickedByTeam?: boolean[]; // Blue picked, Red picked
}

const ChampionCard = ({ champion, ... }) => {
  const cardStyle = {
    opacity: isBanned ? 0.3 : 1,
    border: isSelected 
      ? '4px solid #FFD700'   // Gold for selected
      : isPickedByTeam.some(p => p) 
        ? '2px solid #888'     // Gray for opponent's picks
        : '2px solid transparent',
    cursor: !isBanned && !isPickedByTeam.some(p => p) ? 'pointer' : 'not-allowed'
  };
  
  return (
    <div style={cardStyle} onClick={!isBanned ? () => setSelected(champion.id) : null}>
      <img src={champion.iconUrl} alt={champion.name} />
      <span>{champion.name}</span>
    </div>
  );
};
```

### 2. Backend Services (NestJS)

#### Service Layer Architecture
```typescript
// services/draft.service.ts
@Injectable()
export class DraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly riotApiService: RiotApiService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  async startDraft(draftCode: string): Promise<DraftState> {
    // Validate draft exists and is waiting for players
    const draft = await this.prisma.draft.findUnique({
      where: { code: draftCode },
      include: { blueTeamPlayer: true, redTeamPlayer: true }
    });

    if (!draft || draft.status !== 'WAITING_FOR_PLAYERS') {
      throw new NotFoundHttpException('Draft not found or expired');
    }

    // Initialize state in Redis for real-time updates
    await this.redisService.set(`draft:${draft.id}`, JSON.stringify(draft));
    
    // Create broadcast room
    const roomId = `draft:${draft.id}`;
    await this.socketAdapter.joinRoom(roomId, draft.blueTeamPlayer.userId);
    await this.socketAdapter.joinRoom(roomId, draft.redTeamPlayer.userId);

    // Transition to in-progress
    return this.prisma.draft.update({
      where: { id: draft.id },
      data: { 
        status: 'IN_PROGRESS',
        currentTurn: 1,
        updatedAt: new Date()
      }
    });
  }

  async processBanSelection(
    playerId: string,
    championId: string | null,
    autoLock: boolean = false
  ): Promise<BanAction> {
    // Get current draft state from Redis
    const draftState = await this.redisService.get(`draft:${currentDraftId}`);
    
    // Validate: correct team's turn?
    if (!this.isBanTurn(draftState.currentTurn)) {
      throw new UnauthorizedHttpException('Not your turn');
    }

    // Check champion availability
    const isBanned = draftState.bansPhase1[championId] || draftState.bansPhase2[championId];
    if (isBanned) {
      throw new ConflictHttpException('Champion already banned');
    }

    // Apply ban
    const newBans = { ...draftState.bansPhase1, [championId]: true };
    
    // Emit broadcast event
    await this.eventEmitter.emitToRoom(
      `draft:${currentDraftId}`,
      'ban.confirmed',
      { championId, bans: newBans }
    );

    // Persist to database
    await this.prisma.ban.upsert({
      where: { 
        draft_id_champion_id_team_player_id: {
          draft_id: currentDraftId,
          champion_id: championId!,
          team: 'BLUE' // or RED based on player ID
        }
      },
      update: { locked: true },
      create: {
        draft_id: currentDraftId,
        champion_id: championId!,
        team: 'BLUE',
        playerId: playerId,
        locked: true
      }
    });

    return { success: true, bans: newBans };
  }

  async processPickSelection(
    playerId: string,
    championId: string | null,
    autoLock: boolean = false
  ): Promise<PickAction> {
    // Similar flow to ban but with pick tracking and fearless mode check
    
    // Fearless mode validation
    if (draftState.fearlessMode) {
      const alreadyPickedByOpponent = draftState.redPicks.some(p => p.id === championId);
      if (alreadyPickedByOpponent) {
        throw new ConflictHttpException('Cannot pick champion in fearless mode');
      }
    }

    // Continue with pick logic...
  }
}
```

#### Controller Layer
```typescript
// controllers/draft.controller.ts
@Controller('draft')
@UseGuards(JwtAuthGuard)
export class DraftController {
  constructor(private readonly draftService: DraftService) {}

  @Get(':code/bans')
  @UsePipes(ValidationPipe)
  async getBans(@Param('code') code: string): Promise<Ban[]> {
    return this.prisma.ban.findMany({
      where: { draft_code: code },
      include: { champion: true }
    });
  }

  @Get(':code/picks')
  @UsePipes(ValidationPipe)
  async getPicks(@Param('code') code: string): Promise<Pick[]> {
    return this.prisma.pick.findMany({
      where: { draft_code: code },
      include: { champion: true }
    });
  }

  @Post(':code/fearless-toggle')
  async toggleFearless(@Param('code') code: string, @Body() dto: FearlessToggleDto) {
    // Only allowed before draft starts
    const draft = await this.draftService.getDraft(code);
    
    if (draft.status === 'IN_PROGRESS') {
      throw new UnauthorizedHttpException('Cannot toggle during active draft');
    }

    return this.prisma.draft.update({
      where: { id: draft.id },
      data: { fearlessMode: dto.fearless }
    });
  }
}
```

### 3. Data Models (Prisma Schema)

```prisma
// schema.prisma

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id        Int      @id @default(autoincrement())
  username  String   @unique
  email     String   @unique
  passwordHash String @unique
  
  createdAt DateTime @default(now())
  
  blueTeamDrafts Draft[] @relation("BlueTeam")
  redTeamDrafts Draft[] @relation("RedTeam")
}

model Draft {
  id        Int         @id @default(autoincrement())
  code      String      @unique
  
  blueTeamPlayerId Int
  redTeamPlayerId  Int
  blueTeamPlayer   User  @relation("BlueTeam", fields: [blueTeamPlayerId], references: [id])
  redTeamPlayer    User  @relation("RedTeam", fields: [redTeamPlayerId], references: [id])
  
  fearlessMode    Boolean     @default(false)
  status          String      // WAITING_FOR_PLAYERS | IN_PROGRESS | COMPLETE
  
  currentTurn     Int         @default(1) @db.Int
  maxTurns        Int         // Fixed at 21
  
  createdAt       DateTime    @default(now())
  completedAt     DateTime?
  
  bansPhase1    Ban[]
  bansPhase2    Ban[]
  bluePicks     Pick[]
  redPicks      Pick[]
}

model Ban {
  id          Int   @id @default(autoincrement())
  draftId     Int
  championId  String // Map to champion.id from Riot API
  
  draft       Draft @relation(fields: [draftId], references: [id], onDelete: Cascade)
  
  playerId    Int
  team        String // BLUE | RED
  
  locked      Boolean @default(false)
  
  createdAt   DateTime  @default(now())
  
  @@unique([draftId, championId, team])
}

model Pick {
  id          Int   @id @default(autoincrement())
  draftId     Int
  championId  String
  
  draft       Draft @relation(fields: [draftId], references: [id], onDelete: Cascade)
  
  playerId    Int
  team        String // BLUE | RED
  
  locked      Boolean @default(false)
  
  createdAt   DateTime  @default(now())
  
  @@unique([draftId, championId, team])
}

model SessionToken {
  id        Int      @id @default(autoincrement())
  userId    Int
  token     String   @unique
  
  expiresAt DateTime
  
  createdAt DateTime @default(now())
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// Redis-backed state (not persisted to DB, managed by Redis)
// • Current turn timer countdowns
// • Pending selections awaiting lock confirmation
// • Player connection status
```

### 4. Socket.IO Event Flow

#### Client → Server Events
```typescript
interface ClientEvents {
  // Authentication & Connection
  'auth.login': (credentials: LoginCredentials) => Promise<{ token: string }>;
  
  'draft.join': (draftCode: string, teamPreference: 'BLUE' | 'RED') => Promise<void>;
  
  'draft.fearless.toggle': (fearlessMode: boolean) => Promise<boolean>;
  
  // Selection Actions
  'ban.select': (championId: string | null) => void;
  'ban.lock': () => void;
  
  'pick.select': (championId: string | null) => void;
  'pick.lock': () => void;
  
  'turn.skip': () => Promise<void>;
  
  // Finalization Phase
  'swap.request': (targetChampionId: string, proposedSwapWith: string) => void;
  'swap.approve': (requestId: string) => void;
  'swap.reject': (requestId: string) => void;
}
```

#### Server → Client Events
```typescript
interface ServerEvents {
  // State Updates
  'draft.update': (state: DraftState) => void;
  
  // Turn Management
  'turn.start': (turn: Turn) => void;
  'turn.end': (nextTurnNumber: number) => void;
  
  // Selection Feedback
  'ban.confirmed': (bans: Ban[]) => void;
  'pick.confirmed': (picks: Pick[]) => void;
  
  // Timer Events
  'timer.warning': { seconds: number, turn: Turn } => void;
  'timer.expired': (autoLockedChampionId: string | null) => void;
  
  // Phase Transitions
  'phase.ban1.start': () => void;
  'phase.pick1.start': () => void;
  'phase.ban2.start': () => void;
  'phase.pick2.start': () => void;
  'phase.finalization.start': () => void;
  
  // Draft Lifecycle
  'draft.completed': (results: DraftResults) => void;
  'draft.expired': { reason: string } => void;
}
```

#### Event Router (Server-Side)
```typescript
@OnMessage('ban.select')
async handleBanSelect(
  @Socket() socket: Socket,
  @Body() data: { championId: string | null }
): Promise<void> {
  // Get player from socket room
  const playerId = socket.data.userId;
  const draftId = socket.data.draftId;
  
  const selectedChampion = data.championId 
    ? await this.redisService.get(`draft:${draftId}.champion:${data.championId}`)
    : null;
  
  // Forward to selection processor
  await this.draftService.processBanSelection(playerId, selectedChampion);
}

@OnMessage('timer.warning')
async handleTimerWarning(
  @Socket() socket: Socket,
  @Body() data: { seconds: number }
): Promise<void> {
  // Broadcast warning to all players in room
  this.eventEmitter.emitToRoom(socket.data.roomId, 'timer.warning', data);
}
```

### 5. Real-Time State Management (Zustand)

```typescript
// store/draftStore.ts
import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';

interface DraftState {
  // Core state
  currentTurn: Turn | null;
  selectedChampionId: string | null;
  bans: Ban[];
  picks: Pick[];
  phase: DraftPhase;
  
  // Player info
  playerId: string | null;
  team: 'BLUE' | 'RED';
  
  // Connection state
  isConnected: boolean;
  socket: Socket | null;
  
  // Actions
  connectSocket: (draftId: string, userId: string) => void;
  disconnectSocket: () => void;
  selectChampion: (championId: string | null) => void;
  lockSelection: () => void;
  skipTurn: () => Promise<void>;
  
  // Listeners
  onTurnUpdate: (callback: (turn: Turn) => void) => () => void;
  onBanUpdate: (callback: (bans: Ban[]) => void) => () => void;
}

export const useDraftStore = create<DraftState>((set, get) => ({
  currentTurn: null,
  selectedChampionId: null,
  bans: [],
  picks: [],
  phase: 'BANNING_P1',
  playerId: null,
  team: 'BLUE',
  isConnected: false,
  socket: null,
  
  connectSocket: (draftId, userId) => {
    const socket = io(process.env.NEXT_PUBLIC_API_URL);
    
    socket.on('connect', () => {
      socket.emit('auth.login', get().playerId);
      socket.emit('draft.join', draftId, get().team);
      
      // Subscribe to events
      socket.on('turn.start', (turn: Turn) => set({ currentTurn: turn }));
      socket.on('ban.confirmed', (bans: Ban[]) => set({ bans }));
    });
    
    set({ socket, isConnected: true });
  },
  
  disconnectSocket: () => {
    get().socket?.disconnect();
    set({ isConnected: false, socket: null });
  },
  
  selectChampion: (championId) => set({ selectedChampionId: championId }),
  
  lockSelection: async () => {
    await get().socket?.emit('ban.lock', { draftId: get().currentTurn?.draftId });
    set({ selectedChampionId: null });
  },
  
  skipTurn: async () => {
    // Handle turn timeout logic...
  },
}));
```

### 6. Docker Compose Configuration

```yaml
version: '3.8'

services:
  # Web Frontend
  web:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - NEXT_PUBLIC_API_URL=http://api:4000
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      - api
    networks:
      - app-network

  # API Backend
  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "4000:4000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/league_draft?schema=draft_db
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - PORT=4000
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    networks:
      - app-network

  # PostgreSQL Database
  db:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=league_draft
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - app-network

  # Redis Cache
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redisdata:/data
    networks:
      - app-network

volumes:
  pgdata:
  redisdata:

networks:
  app-network:
    driver: bridge
```

### 7. Security Architecture

#### Authentication Flow
```mermaid
sequenceDiagram
    participant Browser
    participant NestJS as API Gateway
    participant Redis
    participant Postgres

    Browser->>NestJS: POST /auth/login {username, password}
    NestJS->>Redis: Check session token
    alt Token exists and valid
        Redis-->>NestJS: Valid session found
        NestJS-->>Browser: 200 OK with refresh token
    else No/invalid token
        NestJS->>Postgres: Verify credentials + bcrypt
        Postgres-->>NestJS: User record
        alt Credentials valid
            NestJS->>Redis: Create JWT session (15 min TTL)
            Redis-->>NestJS: Token stored
            NestJS-->>Browser: 200 OK with access token
        else Invalid credentials
            NestJS-->>Browser: 401 Unauthorized
    end
```

#### Security Layers
```
┌─────────────────────────────────────────┐
│         SECURITY LAYER HIERARCHY        │
├─────────────────────────────────────────┤
│                                         │
│  1. Network Level                       │
│     └─ Docker network isolation         │
│     └─ No external ports except web/API │
│                                          │
│  2. Application Level                   │
│     ├─ JWT authentication               │
│     ├─ CORS: localhost:* only           │
│     ├─ Rate limiting (5 requests/sec)   │
│     └─ Input validation on all inputs   │
│                                          │
│  3. Data Level                          │
│     ├─ Prepared statements (Prisma ORM) │
│     ├─ No SQL injection risk            │
│     ├─ Password hashing (bcrypt)        │
│     └─ Session tokens encrypted         │
│                                          │
│  4. Infrastructure                      │
│     ├─ Docker container isolation       │
│     ├─ Local-only deployment           │
│     └─ No internet-facing services     │
│                                          │
└─────────────────────────────────────────┘
```

#### API Security Configuration
```typescript
// nestjs.config.ts
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '15m' }, // Short-lived access tokens
    }),
    RateLimitingModule.forRoot({
      windowMs: 60000,
      max: 5, // Max 5 requests per minute
      redisStore: {
        client: RedisClient.new(),
        prefix: 'rate_limit:',
      },
    }),
    CORSModule.forRoot({
      origin: (origin) => {
        // Only allow localhost for local development/deployment
        return origin === 'http://localhost:3000' || false;
      },
      credentials: true,
    }),
  ],
})
export class AppConfiguration {}

// Middleware example
@Injectable()
export class DraftAccessMiddleware implements NestInterceptor {
  async intercept(
    context: ExecutionContext,
    next: CallHandler
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    
    // Extract draft code from route params or headers
    const draftCode = request.params.code || request.headers['x-draft-code'];
    
    // Validate draft exists and user has access
    const draft = await this.draftService.validateDraftAccess(draftCode, request.user.id);
    
    if (!draft) {
      throw new UnauthorizedHttpException('Invalid draft access');
    }
    
    request.draft = draft;
    return next.handle();
  }
}
```

---

## Technology Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 14 | Full-stack React framework with SSR/SSG |
| | React 18 | UI library with concurrent rendering |
| | TypeScript | Type safety for all code |
| | Socket.IO Client | Real-time WebSocket communication |
| | Zustand | Lightweight state management |
| **Backend** | NestJS 10 | Modular Node.js framework |
| | TypeScript | Type safety |
| | Prisma ORM | Type-safe database access |
| | Socket.IO Server | Real-time event broadcasting |
| | JWT (jsonwebtoken) | Token-based authentication |
| **Database** | PostgreSQL 15 | Persistent draft state and user data |
| | Prisma Client 6 | ORM layer for Postgres |
| **Cache** | Redis 7 | Session state, timers, API caching |
| **Infrastructure** | Docker Engine | Container runtime |
| | Docker Compose v3.8 | Multi-container orchestration |
| | GitHub Actions | CI/CD pipeline |
| | Riot Games API v4 | Champion data source |

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     LOCAL DEPLOYMENT ENVIRONMENT                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │  Frontend    │◄──►│   API        │◄──►│   Database   │       │
│  │   (Port 3000)│ WebSocket│  (Port 4000)│ SQL  │          │       │
│  └──────────────┘    └──────────────┘    └──────┬───────┘       │
│                                                 │               │
│  ┌──────────────┐                               ▼               │
│  │   Redis      │◄───────────────────────────────────────────┐   │
│  │   (Port 6379)│ Cache, Sessions, Timers                   │   │
│  └──────────────┘                                           │   │
│                                                             │   │
│  Network: Docker bridge network                             │   │
│  External Access: localhost:3000                            │   │
│  No internet-facing services                                │   │
│                                                             │   │
└─────────────────────────────────────────────────────────────────┘

CI/CD Pipeline (GitHub Actions):
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Push to     │───►│  Run Tests   │───►│ Build Docker │
│   any branch │    │ & Lint       │    │ Containers    │
└──────────────┘    └──────────────┘    └──────┬───────┘
                                              │
                        ┌──────────────────────┼──────────────────────┐
                        │                      ▼                      │
                        │              ┌──────────────┐               │
                        └─────────────►│ Deploy to   │◄──────────────┘
                                        │Local Docker │  (on merge)
                                        │    Compose  │
                                        └─────────────┘
```
