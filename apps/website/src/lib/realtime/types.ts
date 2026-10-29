import type { LiveStatus, StoryPatch, StoryState } from '../story/types';

export type BusMessage = {
    // Keep message kinds namespaced (`control/*`, `story/*`).
    type: string;
    peerId?: string;
    peerCount?: number;
    [key: string]: unknown;
};

export type HelloBusMessage = BusMessage & {
    type: 'hello';
    peerId: string;
    state?: StoryState;
    live?: LiveStatus | null;
    // The server's address on the local network (e.g. 192.168.0.25), so the wall's QR code
    // can point phones at it even when the wall itself was opened via localhost.
    lanHost?: string | null;
};

// Control -> bus: request a change. The bus validates it, merges it into the canonical state
// and answers every peer with `story/state`.
export type ControlSetMessage = BusMessage & {
    type: 'control/set';
    patch: StoryPatch;
};

// Bus -> everyone: the full canonical state (it is tiny, so no deltas needed).
export type StoryStateMessage = BusMessage & {
    type: 'story/state';
    state: StoryState;
};

// Visitor phone -> bus: highlight one station on the wall (visitors cannot steer the story).
export type VisitorPickMessage = BusMessage & {
    type: 'visitor/pick';
    id: string;
};

// Screen -> bus on connect: the dataset's last week index, so the bus can run playback even
// before any control client has connected (attract mode).
export type ScreenReadyMessage = BusMessage & {
    type: 'screen/ready';
    maxWeek: number;
};

// Control -> bus: unlock this connection's presenter controls. Until it succeeds the bus
// ignores the connection's control/set messages. Screens and visitor phones never need it.
export type ControlAuthMessage = BusMessage & {
    type: 'control/auth';
    password: string;
};

// Bus -> that control client only: whether the password was accepted. `locked` = too many
// wrong attempts from this device; try again in a minute.
export type ControlAuthResultMessage = BusMessage & {
    type: 'control/auth-result';
    ok: boolean;
    locked?: boolean;
};

// Bus -> everyone: latest live network snapshot from TfL.
export type LiveStatusMessage = BusMessage & {
    type: 'live/status';
    live: LiveStatus;
};

export type EngineRole = 'screen' | 'control' | 'visitor';

export type EngineConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export type EngineStoreState = {
    role: EngineRole;
    peerId: string | null;
    connection: EngineConnectionState;
    messageCount: number;
    lastMessageType: string | null;
    lastMessageAt: number | null;
    lastError: string | null;
};

export const createInitialEngineStoreState = (role: EngineRole): EngineStoreState => ({
    role,
    peerId: null,
    connection: 'idle',
    messageCount: 0,
    lastMessageType: null,
    lastMessageAt: null,
    lastError: null
});

export type ControlStoreState = EngineStoreState & {
    story: StoryState;
    // True while the operator drags the timeline; remote week echoes are ignored meanwhile.
    isScrubbing: boolean;
    // Presenter password state: checking = waiting for the bus, needed = ask the presenter.
    auth: ControlAuthState;
};

export type ControlAuthState = 'checking' | 'needed' | 'ok' | 'wrong' | 'locked';

export type ScreenStoreState = EngineStoreState & {
    story: StoryState;
    live: LiveStatus | null;
    lanHost: string | null;
};
