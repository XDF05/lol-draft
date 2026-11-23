/**
 * End-to-end draft suite (task 11.4).
 *
 * This test talks to a running Compose stack over HTTP and Socket.IO; it does
 * not boot an in-process Nest application. CI starts the stack and runs:
 *
 *   E2E_API_URL=http://127.0.0.1:4000 npm run test:e2e
 *
 * The suite registers two players, creates and joins a draft, plays all 20
 * action turns through the real gateway, waits for Finalization to complete,
 * and verifies the public snapshot and spectator socket.
 */
import { io, type Socket } from 'socket.io-client';

const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4000';
const FINALIZATION_TIMEOUT_MS = Number(
  process.env.E2E_FINALIZATION_TIMEOUT_MS ?? 90_000,
);
const ACTION_TIMEOUT_MS = 15_000;

type Team = 'BLUE' | 'RED';
type ActionType = 'BAN' | 'PICK';

interface Turn {
  team: Team;
  action: ActionType;
}

/** The fixed 21-turn schedule (turns 1-20 act; turn 21 is Finalization). */
const SCHEDULE: Turn[] = [
  { team: 'BLUE', action: 'BAN' },
  { team: 'RED', action: 'BAN' },
  { team: 'BLUE', action: 'BAN' },
  { team: 'RED', action: 'BAN' },
  { team: 'BLUE', action: 'BAN' },
  { team: 'RED', action: 'BAN' },
  { team: 'BLUE', action: 'PICK' },
  { team: 'RED', action: 'PICK' },
  { team: 'RED', action: 'PICK' },
  { team: 'BLUE', action: 'PICK' },
  { team: 'BLUE', action: 'PICK' },
  { team: 'RED', action: 'PICK' },
  { team: 'RED', action: 'BAN' },
  { team: 'BLUE', action: 'BAN' },
  { team: 'RED', action: 'BAN' },
  { team: 'BLUE', action: 'BAN' },
  { team: 'RED', action: 'PICK' },
  { team: 'BLUE', action: 'PICK' },
  { team: 'BLUE', action: 'PICK' },
  { team: 'RED', action: 'PICK' },
];

/** 20 unique Data Dragon-shaped champion ids (10 bans + 10 picks). */
const CHAMPIONS = [
  'Aatrox',
  'Ahri',
  'Akali',
  'Alistar',
  'Amumu',
  'Annie',
  'Ashe',
  'AurelionSol',
  'Azir',
  'Bard',
  'Blitzcrank',
  'Brand',
  'Braum',
  'Caitlyn',
  'Camille',
  'Cassiopeia',
  'ChoGath',
  'Corki',
  'Darius',
  'Diana',
];

interface ApiResponse<T> {
  status: number;
  body: T;
}

async function api<T = any>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    token?: string;
    body?: unknown;
  } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : undefined) as T,
  };
}

function connect(token?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(API_URL, {
      transports: ['websocket'],
      reconnection: false,
      timeout: ACTION_TIMEOUT_MS,
      ...(token ? { auth: { token } } : {}),
    });

    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('timed out connecting to the API socket'));
    }, ACTION_TIMEOUT_MS);

    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(err);
    });
    socket.once('connection.ready', () => {
      clearTimeout(timer);
      resolve(socket);
    });
  });
}

function once<T = any>(
  socket: Socket,
  event: string,
  predicate: (payload: T) => boolean = () => true,
  timeoutMs = ACTION_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);

    const handler = (payload: T) => {
      if (!predicate(payload)) {
        return;
      }
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler as never);
  });
}

function emitAck<T = any>(
  socket: Socket,
  event: string,
  payload?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('exception', onException);
      reject(new Error(`timed out waiting for ${event} acknowledgement`));
    }, ACTION_TIMEOUT_MS);

    const onException = (err: { message?: string }) => {
      clearTimeout(timer);
      socket.off('exception', onException);
      reject(new Error(`${event} failed: ${err?.message ?? 'unknown error'}`));
    };
    socket.once('exception', onException);

    const ack = (response: T) => {
      clearTimeout(timer);
      socket.off('exception', onException);
      resolve(response);
    };

    if (payload === undefined) {
      socket.emit(event, ack as never);
    } else {
      socket.emit(event, payload as never, ack as never);
    }
  });
}

function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function registerAndLogin(suffix: string, side: 'blue' | 'red') {
  const username = `e2e_${side}_${suffix}`;
  const email = `${username}@example.com`;
  const password = 'E2ePassword123!';

  const registered = await api('/auth/register', {
    method: 'POST',
    body: { username, email, password },
  });
  expect(registered.status).toBe(201);

  const login = await api<{ access_token: string }>('/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  expect(login.status).toBe(201);
  expect(typeof login.body.access_token).toBe('string');
  return { username, token: login.body.access_token };
}

describe('End-to-end 1v1 draft flow', () => {
  const sockets: Socket[] = [];

  afterAll(() => {
    for (const socket of sockets) {
      socket.disconnect();
    }
  });

  it('plays a complete draft and exposes the public result', async () => {
    const suffix = uniqueSuffix();
    const blue = await registerAndLogin(suffix, 'blue');
    const red = await registerAndLogin(suffix, 'red');

    const created = await api<{ code: string; status: string }>(
      '/draft/create',
      {
        method: 'POST',
        token: blue.token,
        body: { side: 'BLUE' },
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('WAITING_FOR_PLAYERS');
    expect(created.body.code).toMatch(/^[A-HJ-NP-Z2-9]{7}$/);
    const code = created.body.code;

    // The creator joins the socket room before the second player starts the
    // draft so the first turn announcement is not missed.
    const blueSocket = await connect(blue.token);
    sockets.push(blueSocket);
    await emitAck(blueSocket, 'draft.join', { code });

    const joined = await api<{ started: boolean; team: string }>(
      `/draft/${code}/join`,
      {
        method: 'POST',
        token: red.token,
        body: { side: 'RED' },
      },
    );
    expect(joined.status).toBe(201);
    expect(joined.body.team).toBe('RED');
    expect(joined.body.started).toBe(true);

    const redSocket = await connect(red.token);
    sockets.push(redSocket);
    // Register before the join acknowledgement: the gateway announces turn
    // 1 before it returns the ack.
    const firstTurn = once(
      redSocket,
      'turn.start',
      (payload: { turnNumber: number }) => payload.turnNumber === 1,
    );
    await emitAck(redSocket, 'draft.join', { code });
    await firstTurn;

    const byTeam: Record<Team, Socket> = {
      BLUE: blueSocket,
      RED: redSocket,
    };

    for (let turnNumber = 1; turnNumber <= SCHEDULE.length; turnNumber++) {
      const turn = SCHEDULE[turnNumber - 1];
      const socket = byTeam[turn.team];
      const championId = CHAMPIONS[turnNumber - 1];

      // The lock handler advances the turn and emits the next `turn.start`
      // before it returns the acknowledgement, so subscribe first.
      const nextTurn =
        turnNumber < SCHEDULE.length
          ? once(
              byTeam[SCHEDULE[turnNumber].team],
              'turn.start',
              (payload: { turnNumber: number }) =>
                payload.turnNumber === turnNumber + 1,
            )
          : once(
              blueSocket,
              'turn.start',
              (payload: { turnNumber: number; phase: string }) =>
                payload.turnNumber === 21 && payload.phase === 'FINALIZATION',
            );

      await emitAck(socket, `${turn.action.toLowerCase()}.select`, {
        championId,
      });
      const locked = await emitAck<{ championId: string }>(
        socket,
        `${turn.action.toLowerCase()}.lock`,
      );
      expect(locked.championId).toBe(championId);
      await nextTurn;
    }

    // Turn 21 is the 60-second Finalization window. The CI stack shortens
    // it to a few seconds; the default timeout keeps a local run working.
    const completed = await once<{
      completedAt: string;
      picks: Array<{ championId: string; team: Team }>;
      bans: Array<{ championId: string; team: Team }>;
    }>(blueSocket, 'draft.completed', () => true, FINALIZATION_TIMEOUT_MS);

    expect(completed.completedAt).toBeTruthy();
    expect(completed.picks).toHaveLength(10);
    expect(completed.bans).toHaveLength(10);
    expect(completed.picks.filter((p) => p.team === 'BLUE')).toHaveLength(5);
    expect(completed.picks.filter((p) => p.team === 'RED')).toHaveLength(5);
    expect(completed.bans.filter((b) => b.team === 'BLUE')).toHaveLength(5);
    expect(completed.bans.filter((b) => b.team === 'RED')).toHaveLength(5);

    const publicSnapshot = await api<{
      status: string;
      completedAt: string | null;
      picks: unknown[];
      bans: unknown[];
      pending?: unknown;
    }>(`/public/draft/${code}`);
    expect(publicSnapshot.status).toBe(200);
    expect(publicSnapshot.body.status).toBe('COMPLETE');
    expect(publicSnapshot.body.completedAt).toBeTruthy();
    expect(publicSnapshot.body.picks).toHaveLength(10);
    expect(publicSnapshot.body.bans).toHaveLength(10);
    expect(publicSnapshot.body.pending).toBeUndefined();

    const spectator = await connect();
    sockets.push(spectator);
    // The join acknowledgement is sent after the server replays the current
    // state, including draft.completed for a finished draft. Subscribe
    // before joining so the replay is not missed.
    const spectatorCompleted = once(spectator, 'draft.completed', () => true);
    const spectatorAck = await emitAck<{ status: string }>(
      spectator,
      'public.join',
      { draftCode: code },
    );
    expect(spectatorAck.status).toBe('COMPLETE');
    const spectatorResult = await spectatorCompleted;
    expect(spectatorResult.picks).toHaveLength(10);
  }, 240_000);
});
