import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';

import { createFileRoute } from '@tanstack/react-router';
import { defineHooks, type Peer } from 'crossws';

import type {
    ControlAuthMessage,
    ControlAuthResultMessage,
    ControlSetMessage,
    LiveStatusMessage,
    ScreenReadyMessage,
    StoryStateMessage,
    VisitorPickMessage
} from '../lib/realtime';
import { holdMs, weekDurationMs } from '../lib/story/timeline';
import {
    INITIAL_STORY_STATE,
    MAX_PICKS,
    isStationId,
    sanitizeLiveStatus,
    sanitizeStoryPatch,
    type LiveStatus,
    type StoryPatch,
    type StoryState
} from '../lib/story/types';

// With nobody at the controls for this long, the wall plays the story by itself on a loop.
const ATTRACT_IDLE_MS = 45_000;
const IDLE_CHECK_MS = 1_000;
// A visitor's highlighted station fades from the wall after this long.
const PICK_TTL_MS = 90_000;
// TfL's open API, polled by the server only (one request for all 64 screens), no key needed.
const LIVE_POLL_MS = 60_000;
const LIVE_LINES_URL = 'https://api.tfl.gov.uk/Line/Mode/tube,elizabeth-line,dlr,overground/Status';
const LIVE_LIFTS_URL = 'https://api.tfl.gov.uk/Disruptions/Lifts/v2';
const LIVE_FETCH_TIMEOUT_MS = 10_000;

// The bus owns the canonical story state *and* every clock (playback, attract mode, pick expiry,
// live polling). Screens never run their own timers, so all 64 displays stay in lock-step and
// the wall keeps going if every control client disconnects.
type BusRuntime = {
    state: StoryState;
    maxWeek: number;
    peers: Set<Peer>;
    playTimer: ReturnType<typeof setTimeout> | null;
    idleTimer: ReturnType<typeof setInterval> | null;
    liveTimer: ReturnType<typeof setInterval> | null;
    lastControlAt: number;
    pickExpiry: Map<string, number>;
    live: LiveStatus | null;
    password: string;
    // Connections that unlocked the presenter controls.
    presenters: Set<Peer>;
    authFailures: Map<string, { count: number; lockedUntil: number }>;
};

// Kept on globalThis so dev-server hot reloads reuse one runtime; old timers are cleared below.
const globalWithBus = globalThis as typeof globalThis & { __doStoryBus?: BusRuntime };
const bus: BusRuntime = (globalWithBus.__doStoryBus ??= {
    state: INITIAL_STORY_STATE,
    maxWeek: 0,
    peers: new Set(),
    playTimer: null,
    idleTimer: null,
    liveTimer: null,
    lastControlAt: Date.now(),
    pickExpiry: new Map(),
    live: null,
    password: '',
    presenters: new Set(),
    authFailures: new Map()
});
for (const timer of [bus.playTimer, bus.idleTimer, bus.liveTimer]) {
    if (timer) clearTimeout(timer);
}
bus.playTimer = null;
bus.idleTimer = setInterval(housekeeping, IDLE_CHECK_MS);
bus.liveTimer = setInterval(() => void pollLive(), LIVE_POLL_MS);

function broadcast() {
    const message: StoryStateMessage = { type: 'story/state', state: bus.state };
    for (const peer of bus.peers) peer.send(message);
}

function setState(next: StoryState) {
    bus.state = next;
    syncClock();
    broadcast();
}

// ---- playback clock ------------------------------------------------------------------------
// One tick per week, but each week's duration follows its width on the wall (see
// lib/story/timeline.ts), so the playhead sweeps the room at a constant, comfortable speed.
function syncClock() {
    if (bus.state.playing && !bus.playTimer) scheduleTick();
    if (!bus.state.playing && bus.playTimer) {
        clearTimeout(bus.playTimer);
        bus.playTimer = null;
    }
}

function scheduleTick() {
    const { week } = bus.state;
    const delay = weekDurationMs(week, bus.maxWeek) + holdMs(week, bus.maxWeek);
    bus.playTimer = setTimeout(tick, delay);
}

function tick() {
    bus.playTimer = null;
    if (!bus.state.playing) return;
    const atEnd = bus.state.week >= bus.maxWeek;
    if (atEnd && !bus.state.attract) {
        setState({ ...bus.state, playing: false });
        return;
    }
    // Attract mode loops; the end hold (holdMs) has already been waited out.
    const week = atEnd ? 0 : bus.state.week + 1;
    bus.state = { ...bus.state, week };
    scheduleTick();
    broadcast();
}

// ---- control / visitor messages --------------------------------------------------------------
function applyControl(patch: StoryPatch) {
    bus.lastControlAt = Date.now();
    if (patch.maxWeek !== undefined) bus.maxWeek = patch.maxWeek;
    const { maxWeek: _ignored, ...statePatch } = patch;
    // Any presenter input takes the wall out of attract mode.
    const next: StoryState = { ...bus.state, ...statePatch, attract: false };
    if (bus.maxWeek > 0) next.week = Math.min(next.week, bus.maxWeek);
    // Playing needs a known end; otherwise the clock could run past the data.
    if (next.playing && (bus.maxWeek === 0 || next.week >= bus.maxWeek)) next.playing = false;
    setState(next);
}

function applyPick(id: string) {
    bus.pickExpiry.set(id, Date.now() + PICK_TTL_MS);
    // Newest last; re-picking a station moves it to the end. Oldest drop off past MAX_PICKS.
    const picks = [...bus.state.picks.filter((p) => p !== id), id].slice(-MAX_PICKS);
    setState({ ...bus.state, picks });
}

// ---- housekeeping: pick expiry + attract mode ------------------------------------------------
function housekeeping() {
    const now = Date.now();
    const picks = bus.state.picks.filter((id) => (bus.pickExpiry.get(id) ?? 0) > now);
    for (const [id, expiry] of bus.pickExpiry) if (expiry <= now) bus.pickExpiry.delete(id);
    let next = picks.length === bus.state.picks.length ? bus.state : { ...bus.state, picks };

    const idle = now - bus.lastControlAt > ATTRACT_IDLE_MS;
    if (idle && !next.playing && bus.maxWeek > 0 && bus.peers.size > 0) {
        next = {
            ...next,
            attract: true,
            playing: true,
            focus: 'auto',
            selected: null,
            whatIf: 0,
            week: next.week >= bus.maxWeek ? 0 : next.week
        };
    }
    if (next !== bus.state) setState(next);
}

// ---- live TfL data -------------------------------------------------------------------------
async function fetchJson(url: string): Promise<unknown> {
    const response = await fetch(url, { signal: AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json() as Promise<unknown>;
}

// External data is untrusted: read only the fields we need, defensively.
async function pollLive() {
    if (bus.peers.size === 0) return;
    try {
        const [lines, lifts] = await Promise.all([
            fetchJson(LIVE_LINES_URL),
            fetchJson(LIVE_LIFTS_URL)
        ]);
        const parsed = sanitizeLiveStatus({
            at: new Date().toISOString(),
            lines: (Array.isArray(lines) ? lines : []).map((line: unknown) => {
                const l = line as { name?: unknown; lineStatuses?: Array<Record<string, unknown>> };
                const status = l.lineStatuses?.[0];
                return {
                    name: typeof l.name === 'string' ? l.name : '',
                    status:
                        typeof status?.statusSeverityDescription === 'string'
                            ? status.statusSeverityDescription
                            : 'Unknown',
                    // TfL severity 10 = "Good Service".
                    good: status?.statusSeverity === 10
                };
            }),
            liftsOut: (Array.isArray(lifts) ? lifts : []).reduce(
                (sum: number, item: unknown) =>
                    sum +
                    (Array.isArray(
                        (item as { disruptedLiftUniqueIds?: unknown }).disruptedLiftUniqueIds
                    )
                        ? (item as { disruptedLiftUniqueIds: unknown[] }).disruptedLiftUniqueIds
                              .length
                        : 0),
                0
            )
        });
        if (!parsed) return;
        bus.live = parsed;
        const message: LiveStatusMessage = { type: 'live/status', live: parsed };
        for (const peer of bus.peers) peer.send(message);
    } catch {
        // Keep showing the last good snapshot; try again on the next poll.
    }
}

// This machine's IPv4 address on the local network (Wi-Fi/Ethernet), for the visitor QR code.
// Skips loopback and self-assigned (169.254.x.x) addresses; null when offline.
function lanAddress(): string | null {
    for (const addresses of Object.values(networkInterfaces())) {
        for (const a of addresses ?? []) {
            if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
                return a.address;
            }
        }
    }
    return null;
}

// ---- presenter password ---------------------------------------------------------------------
// Only the presenter's tablet needs it: the bus ignores control/set from any connection that
// hasn't unlocked. Screens and visitor phones (the QR page) never need a password.
// CONTROL_PASSWORD sets it; otherwise one is generated at start-up and printed in the terminal.
const MIN_PASSWORD_LENGTH = 4;
const MAX_PASSWORD_LENGTH = 200;
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const GENERATED_PASSWORD_LENGTH = 8;
// Brute-force guard: this many wrong attempts from one device locks it out for a minute.
const MAX_AUTH_FAILURES = 5;
const AUTH_LOCK_MS = 60_000;

function configuredPassword(): string | null {
    const value = process.env.CONTROL_PASSWORD?.trim();
    return value && value.length >= MIN_PASSWORD_LENGTH ? value : null;
}

function generatePassword() {
    return Array.from(
        { length: GENERATED_PASSWORD_LENGTH },
        () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]
    ).join('');
}

function digest(value: string) {
    return createHash('sha256').update(value).digest();
}

// Constant-time comparison of hashes, so response time leaks nothing about the password.
function passwordMatches(given: unknown) {
    if (typeof given !== 'string' || given.length > MAX_PASSWORD_LENGTH) return false;
    return timingSafeEqual(digest(given.trim()), digest(bus.password));
}

// Failed attempts are counted per device (network address), so reconnecting doesn't reset them.
function deviceKey(peer: Peer) {
    return peer.remoteAddress ?? peer.id;
}

function handleAuth(peer: Peer, password: unknown) {
    const key = deviceKey(peer);
    const now = Date.now();
    const record = bus.authFailures.get(key);
    if (record && record.lockedUntil > now) {
        peer.send({ type: 'control/auth-result', ok: false, locked: true });
        return;
    }
    if (passwordMatches(password)) {
        bus.authFailures.delete(key);
        bus.presenters.add(peer);
        const result: ControlAuthResultMessage = { type: 'control/auth-result', ok: true };
        peer.send(result);
        return;
    }
    const count = (record && record.lockedUntil > 0 ? 0 : (record?.count ?? 0)) + 1;
    const locked = count >= MAX_AUTH_FAILURES;
    bus.authFailures.set(key, { count, lockedUntil: locked ? now + AUTH_LOCK_MS : 0 });
    const result: ControlAuthResultMessage = { type: 'control/auth-result', ok: false, locked };
    peer.send(result);
}

// A runtime created by older code (before a hot reload) may lack these fields.
bus.presenters ??= new Set();
bus.authFailures ??= new Map();
// A password set in the environment always wins; a generated one is kept across hot reloads.
{
    const configured = configuredPassword();
    if (configured) {
        bus.password = configured;
    } else if (!bus.password) {
        bus.password = generatePassword();
        console.log(
            `\n  Presenter password for /control: ${bus.password}\n` +
                '  (set CONTROL_PASSWORD to choose your own)\n'
        );
    }
}

// ---- websocket hooks -----------------------------------------------------------------------
const hooks = defineHooks({
    open(peer) {
        bus.peers.add(peer);
        // `hello` bootstraps late joiners (e.g. a screen that rebooted) with the current state.
        peer.send({
            type: 'hello',
            peerId: peer.id,
            state: bus.state,
            live: bus.live,
            lanHost: lanAddress()
        });
        if (!bus.live) void pollLive();
    },
    message(peer, message) {
        let payload: Record<string, unknown>;
        try {
            const parsed = message.json() as unknown;
            if (typeof parsed !== 'object' || parsed === null) return;
            payload = parsed as Record<string, unknown>;
        } catch {
            return;
        }
        if (payload.type === 'control/auth') {
            handleAuth(peer, (payload as Partial<ControlAuthMessage>).password);
        } else if (payload.type === 'control/set') {
            // Presenter controls only work after the password has been accepted.
            if (!bus.presenters.has(peer)) return;
            applyControl(sanitizeStoryPatch((payload as Partial<ControlSetMessage>).patch));
        } else if (payload.type === 'visitor/pick') {
            const { id } = payload as Partial<VisitorPickMessage>;
            if (isStationId(id)) applyPick(id);
        } else if (payload.type === 'screen/ready') {
            const { maxWeek } = payload as Partial<ScreenReadyMessage>;
            if (
                Number.isInteger(maxWeek) &&
                (maxWeek as number) > 0 &&
                (maxWeek as number) < 10_000
            ) {
                bus.maxWeek = maxWeek as number;
            }
        }
    },
    close(peer) {
        bus.peers.delete(peer);
        bus.presenters.delete(peer);
    }
});

export const Route = createFileRoute('/bus')({
    server: {
        handlers: {
            GET: async () => {
                // HTTP fallback response: this endpoint is a websocket upgrade target.
                return Object.assign(
                    new Response('WebSocket upgrade is required.', {
                        status: 426
                    }),
                    {
                        crossws: hooks
                    }
                );
            }
        }
    }
});
