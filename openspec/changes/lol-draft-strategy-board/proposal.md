# League of Legends 1v1 Draft Strategy Board

## Executive Summary

A real-time multiplayer drafting simulator for League of Legends featuring two authenticated players competing in a 1v1 format, following official LoL drafting rules. The application supports Bo1/Bo3/Bo5 series formats, includes optional "Fearless Drafting" mode, and features public viewing with secure link-based access.

## Project Vision

Create an engaging, professional-grade draft simulator that captures the strategic depth of League of Legends champion selection while providing a smooth real-time experience for competitive players.

## Scope Overview

### In Scope ✅

- **Real-time 1v1 Drafting**: Two authenticated players selecting/banning champions
- **Official LoL Draft Rules**: Accurate implementation of all ban/pick phases
- **Bo1/Bo3/Bo5 Support**: Series format configuration with ban carry-over options
- **Fearless Drafting Mode**: Optional toggle that locks picks permanently
- **Public Viewing**: Link-based access for spectators during active drafts
- **League API Integration**: Champion data fetched from Riot Games APIs
- **Local Deployment**: Docker containerized for secure offline operation
- **CI/CD Pipeline**: GitHub Actions for automated testing and deployment

### Out of Scope ❌

- Multiplayer team drafting (5v5)
- Actual gameplay simulation or match rendering
- Spectator accounts with persistent profiles
- Champion statistics databases beyond basic icons/names
- Ranked matchmaking system
- Cross-platform play (all local deployment)

## Core Features

### 1. Player Authentication System
- Secure JWT-based authentication for draft participants
- Session management with automatic expiration
- Draft room access via unique codes

### 2. Real-time Draft Engine
- WebSocket-powered synchronization between players
- Lock mechanism to prevent accidental changes
- Auto-commit after 30-second timer per action
- Visual feedback for selection states

### 3. Official LoL Draft Sequence
```
Ban Phase 1: 6 turns (3 bans each)
  → Blue ban, Red ban, Blue ban, Red ban, Blue ban, Red ban

Pick Phase 1: 6 turns
  → Blue picks 1
  → Red picks 2 (separate)
  → Blue picks 2 (separate)
  → Red picks 1

Ban Phase 2: 4 turns (2 bans each)
  → Red ban, Blue ban, Red ban, Blue ban

Pick Phase 2: 4 turns
  → Red picks 1
  → Blue picks 2 (separate)
  → Red picks 1

Finalization: 1 turn (60s grace period for swaps)
```

### 4. Fearless Drafting Mode
- Toggle available ONLY before draft starts
- Locks all picks permanently - cannot be banned later
- Forces early strategic commitments
- Creates permanent champion "shield" state

### 5. Public Viewing System
- Link-based access without authentication
- Real-time draft visibility for spectators
- 30-second reconnection grace period
- Auto-deletion after session timeout
- Draft results accessible post-completion

## Technical Architecture

### Frontend
- **Framework**: Next.js 14 with React 18
- **Language**: TypeScript
- **Real-time**: Socket.IO client
- **State Management**: Zustand or Redux Toolkit
- **UI Components**: Custom React components for champion cards, timer displays

### Backend
- **Framework**: NestJS 10 with TypeScript
- **Database**: PostgreSQL 15 (Prisma ORM)
- **Cache**: Redis 7 for session state and Data Dragon champion data
- **Real-time**: Socket.IO server
- **Security**: JWT validation, rate limiting, CORS restrictions

### Infrastructure
- **Containerization**: Docker Compose multi-service deployment
- **CI/CD**: GitHub Actions pipeline for testing and deployment
- **API Source**: Riot Games Developer Portal v4 Datastore API

## Key Differentiators

1. **Authentic Draft Rules**: Precise implementation of official League of Legends drafting sequence with correct phase durations and pick order
2. **Lock Mechanism**: UX improvement allowing players to commit selections without waiting full timer duration
3. **Local Deployment Focus**: Secure, offline-first design for privacy-conscious use
4. **Public Viewing Access**: Link-based spectator experience without authentication barriers
5. **Fearless Mode Impact**: Creates unique strategic dynamics by preventing counter-bans on picked champions

## User Experience Goals

- **Smooth Draft Flow**: Minimize waiting time through lock mechanism and proper phase transitions
- **Clear Visual Feedback**: Immediate updates when bans/picks are made or locked
- **Timer Awareness**: Visible countdowns with warning states (5s, 3s, 1s)
- **Responsive Interface**: Instant action confirmation with minimal latency
- **Accessible Spectating**: Anyone with a draft link can view in real-time

## Success Metrics

- Draft completes within expected ~14 minute window
- No data loss during disconnections
- Less than 2% draft timeouts due to network issues
- Public viewing refresh rate under 500ms
- Zero security vulnerabilities in authentication flow

## Risk Mitigation

- **API Reliability**: Redis caching with fallback retry logic
- **Network Failures**: Client-side state persistence with reconciliation
- **Security**: Local-only deployment eliminates external exposure
- **Data Integrity**: Database transactions for critical draft operations

---

*This proposal defines the scope for implementing a professional League of Legends drafting simulator that respects official game rules while providing an engaging real-time competitive experience.*
