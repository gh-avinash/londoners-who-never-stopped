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
};

export type ScreenStoreState = EngineStoreState & {
    story: StoryState;
    live: LiveStatus | null;
};
