import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { SocketUser } from './socket-events';

interface TrackedConnection {
  socketId: string;
  user: SocketUser;
  connectedAt: number;
  lastPingAt: number | null;
  /** Round-trip latency (ms) measured from the most recent `health.ping`. */
  lastLatencyMs: number | null;
  draftIds: Set<number>;
}

export interface ConnectionStats {
  totalConnections: number;
  byDraft: Record<string, number>;
  averageLatencyMs: number | null;
}

/**
 * Connection health monitoring (T-006).
 *
 * Tracks every authenticated socket, its user, the draft rooms it joined and
 * its measured ping latency. The gateway feeds connection/disconnect/ping
 * events into this service; a periodic log line gives operational visibility.
 */
@Injectable()
export class ConnectionHealthService implements OnModuleDestroy {
  private readonly logger = new Logger(ConnectionHealthService.name);
  private readonly connections = new Map<string, TrackedConnection>();
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  register(socketId: string, user: SocketUser): void {
    this.connections.set(socketId, {
      socketId,
      user,
      connectedAt: Date.now(),
      lastPingAt: null,
      lastLatencyMs: null,
      draftIds: new Set(),
    });
  }

  unregister(socketId: string): TrackedConnection | undefined {
    const removed = this.connections.get(socketId);
    this.connections.delete(socketId);
    return removed;
  }

  /** Record that a socket joined a draft room. */
  attachToDraft(socketId: string, draftId: number): void {
    this.connections.get(socketId)?.draftIds.add(draftId);
  }

  /** Record that a socket left a draft room. */
  detachFromDraft(socketId: string, draftId: number): void {
    this.connections.get(socketId)?.draftIds.delete(draftId);
  }

  /** Record a client ping and return the measured latency in ms (if known). */
  recordPing(socketId: string, latencyMs: number | null): number | null {
    const conn = this.connections.get(socketId);
    if (!conn) {
      return null;
    }
    conn.lastPingAt = Date.now();
    if (latencyMs !== null) {
      conn.lastLatencyMs = latencyMs;
    }
    return conn.lastLatencyMs;
  }

  stats(): ConnectionStats {
    const byDraft: Record<string, number> = {};
    let latencySum = 0;
    let latencyCount = 0;

    for (const conn of this.connections.values()) {
      for (const draftId of conn.draftIds) {
        byDraft[`draft:${draftId}`] = (byDraft[`draft:${draftId}`] ?? 0) + 1;
      }
      if (conn.lastLatencyMs !== null) {
        latencySum += conn.lastLatencyMs;
        latencyCount += 1;
      }
    }

    return {
      totalConnections: this.connections.size,
      byDraft,
      averageLatencyMs: latencyCount > 0 ? latencySum / latencyCount : null,
    };
  }

  /** Emit a periodic connection summary (only when sockets are present). */
  startPeriodicLogging(intervalMs = 60_000): void {
    if (this.statsTimer) {
      return;
    }
    this.statsTimer = setInterval(() => {
      const stats = this.stats();
      if (stats.totalConnections > 0) {
        this.logger.log(
          `health: connections=${stats.totalConnections} drafts=${JSON.stringify(
            stats.byDraft,
          )} avgLatency=${
            stats.averageLatencyMs === null
              ? 'n/a'
              : `${Math.round(stats.averageLatencyMs)}ms`
          }`,
        );
      }
    }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }
}
