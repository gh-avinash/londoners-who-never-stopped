import { sanitizeLiveStatus, sanitizeStoryState, type StoryState } from '../../story/types';
import { screenStore } from '../stores/screen-store';
import type {
    BusMessage,
    HelloBusMessage,
    LiveStatusMessage,
    ScreenStoreState,
    StoryStateMessage
} from '../types';
import { BusEngine } from './bus-engine';

// Screens are pure subscribers: they apply the canonical state from the bus and render it.
export class ScreenEngine extends BusEngine<ScreenStoreState> {
    private maxWeek: number | null = null;

    private constructor() {
        super('screen', screenStore);
    }

    static getInstance() {
        const globalWithScreenEngine = globalThis as typeof globalThis & {
            __screenEngineInstance?: ScreenEngine;
        };

        if (!globalWithScreenEngine.__screenEngineInstance) {
            globalWithScreenEngine.__screenEngineInstance = new ScreenEngine();
        }

        return globalWithScreenEngine.__screenEngineInstance;
    }

    // Called once the dataset has loaded: tells the bus how many weeks there are, so it can run
    // playback (attract mode) even when no control client has ever connected.
    announceDataset(maxWeek: number) {
        this.maxWeek = maxWeek;
        this.sendReady();
    }

    protected override onMessage(message: BusMessage) {
        if (message.type === 'story/state') {
            this.applyState((message as StoryStateMessage).state);
        } else if (message.type === 'live/status') {
            this.applyLive((message as LiveStatusMessage).live);
        }
    }

    protected override onHello(hello: HelloBusMessage) {
        // Same code path as live updates, so a rebooted screen converges identically.
        this.applyState(hello.state);
        this.applyLive(hello.live);
        this.applyLanHost(hello.lanHost);
        // The socket is open now; (re)send readiness after every reconnect.
        this.sendReady();
    }

    private sendReady() {
        if (this.maxWeek !== null) this.send({ type: 'screen/ready', maxWeek: this.maxWeek });
    }

    private applyLanHost(input: unknown) {
        // A plain IPv4 address only; anything else is ignored.
        const lanHost =
            typeof input === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(input) ? input : null;
        this.store.setState((prev) => (prev.lanHost === lanHost ? prev : { ...prev, lanHost }));
    }

    private applyLive(input: unknown) {
        const live = sanitizeLiveStatus(input);
        if (live) this.store.setState((prev) => ({ ...prev, live }));
    }

    private applyState(input: unknown) {
        const state = sanitizeStoryState(input);
        if (!state) return;
        this.store.setState((prev) =>
            storyEqual(prev.story, state) ? prev : { ...prev, story: state }
        );
    }
}

export const screenEngine = ScreenEngine.getInstance();

function storyEqual(a: StoryState, b: StoryState) {
    return (
        a.week === b.week &&
        a.playing === b.playing &&
        a.focus === b.focus &&
        a.selected === b.selected &&
        a.attract === b.attract &&
        a.whatIf === b.whatIf &&
        a.picks.length === b.picks.length &&
        a.picks.every((id, i) => id === b.picks[i])
    );
}
