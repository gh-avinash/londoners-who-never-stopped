import { createFileRoute } from '@tanstack/react-router';
import { defineHooks, type Peer } from 'crossws';

import type {
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
    live: null
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

// ---- websocket hooks -----------------------------------------------------------------------
const hooks = defineHooks({
    open(peer) {
        bus.peers.add(peer);
        // `hello` bootstraps late joiners (e.g. a screen that rebooted) with the current state.
        peer.send({ type: 'hello', peerId: peer.id, state: bus.state, live: bus.live });
        if (!bus.live) void pollLive();
    },
    message(_peer, message) {
        let payload: Record<string, unknown>;
        try {
            const parsed = message.json() as unknown;
            if (typeof parsed !== 'object' || parsed === null) return;
            payload = parsed as Record<string, unknown>;
        } catch {
            return;
        }
        if (payload.type === 'control/set') {
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
