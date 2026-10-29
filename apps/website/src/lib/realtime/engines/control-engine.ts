import { throttle } from '@tanstack/pacer';

import { sanitizeStoryState, type Focus, type StoryPatch } from '../../story/types';
import { controlStore } from '../stores/control-store';
import type {
    BusMessage,
    ControlAuthResultMessage,
    ControlAuthState,
    ControlStoreState,
    HelloBusMessage,
    StoryStateMessage
} from '../types';
import { BusEngine } from './bus-engine';

// Dragging the timeline can fire dozens of events per second; 10 updates/s is plenty for the
// wall (screens tween between weeks) and keeps websocket traffic small.
const SCRUB_BROADCAST_WAIT_MS = 100;
// The accepted password is remembered for this browser tab only, so reconnects and reloads
// don't ask again but closing the tab does.
const PASSWORD_STORAGE_KEY = 'do-presenter-password';

export class ControlEngine extends BusEngine<ControlStoreState> {
    private readonly sendWeekThrottled = throttle(
        (week: number) => this.sendPatch({ week, playing: false }),
        { wait: SCRUB_BROADCAST_WAIT_MS, leading: true, trailing: true }
    );

    private readonly sendWhatIfThrottled = throttle(
        (whatIf: number) => this.sendPatch({ whatIf, focus: 'whatif', playing: false }),
        { wait: SCRUB_BROADCAST_WAIT_MS, leading: true, trailing: true }
    );

    // Password waiting for the bus's answer; saved only once accepted.
    private pendingPassword: string | null = null;

    private constructor() {
        super('control', controlStore);
    }

    static getInstance() {
        const globalWithControlEngine = globalThis as typeof globalThis & {
            __controlEngineInstance?: ControlEngine;
        };

        if (!globalWithControlEngine.__controlEngineInstance) {
            globalWithControlEngine.__controlEngineInstance = new ControlEngine();
        }

        return globalWithControlEngine.__controlEngineInstance;
    }

    // Presenter typed a password on the tablet.
    unlock(password: string) {
        this.sendAuth(password);
    }

    // Jump to a chapter of the story: spotlight a section and move the timeline there.
    goTo(focus: Focus, week?: number) {
        this.update({
            focus,
            playing: false,
            // Leaving the simulator returns the map to real data.
            ...(focus === 'whatif' ? {} : { whatIf: 0 }),
            ...(week === undefined ? {} : { week })
        });
    }

    // Guided tour: play from the start with the spotlight following the playhead.
    tour(maxWeek: number) {
        this.update({ focus: 'auto', whatIf: 0, selected: null, week: 0, playing: true, maxWeek });
    }

    // `maxWeek` is the last week index of the dataset; the bus stops playback there.
    play(maxWeek: number) {
        const { week } = this.store.state.story;
        // Pressing play at the end restarts from the beginning.
        this.update({ playing: true, maxWeek, week: week >= maxWeek ? 0 : week });
    }

    pause() {
        this.update({ playing: false });
    }

    select(stationId: string | null) {
        this.update({ selected: stationId });
    }

    scrub(week: number) {
        this.store.setState((prev) => ({
            ...prev,
            story: { ...prev.story, week, playing: false }
        }));
        this.sendWeekThrottled(week);
    }

    // What-if simulator: 0 = what really happened, 100 = the jobs-only model.
    setWhatIf(whatIf: number) {
        this.store.setState((prev) => ({
            ...prev,
            story: { ...prev.story, whatIf, focus: 'whatif', playing: false }
        }));
        this.sendWhatIfThrottled(whatIf);
    }

    setScrubbing(isScrubbing: boolean) {
        this.store.setState((prev) =>
            prev.isScrubbing === isScrubbing ? prev : { ...prev, isScrubbing }
        );
    }

    protected override onMessage(message: BusMessage) {
        if (message.type === 'story/state') {
            this.applyState((message as StoryStateMessage).state);
        } else if (message.type === 'control/auth-result') {
            this.applyAuthResult(message as ControlAuthResultMessage);
        }
    }

    protected override onHello(hello: HelloBusMessage) {
        // Newly opened tablets start in sync with the wall.
        this.applyState(hello.state);
        // Every (re)connection starts locked on the bus; unlock again with the saved password.
        const saved = readSavedPassword();
        if (saved) this.sendAuth(saved);
        else this.setAuth('needed');
    }

    private sendAuth(password: string) {
        this.pendingPassword = password;
        this.setAuth('checking');
        this.send({ type: 'control/auth', password });
    }

    private applyAuthResult(result: ControlAuthResultMessage) {
        const tried = this.pendingPassword;
        this.pendingPassword = null;
        if (result.ok === true) {
            if (tried) savePassword(tried);
            this.setAuth('ok');
            return;
        }
        // A saved password that no longer works (server restarted with a new one) just asks
        // again; a typed one that fails says so.
        const wasSaved = tried !== null && tried === readSavedPassword();
        savePassword(null);
        this.setAuth(result.locked === true ? 'locked' : wasSaved ? 'needed' : 'wrong');
    }

    private setAuth(auth: ControlAuthState) {
        this.store.setState((prev) => (prev.auth === auth ? prev : { ...prev, auth }));
    }

    // Optimistic local update, then ask the bus; the bus reply is authoritative.
    private update(patch: StoryPatch) {
        const { maxWeek: _ignored, ...statePatch } = patch;
        this.store.setState((prev) => ({ ...prev, story: { ...prev.story, ...statePatch } }));
        this.sendPatch(patch);
    }

    private sendPatch(patch: StoryPatch) {
        this.send({ type: 'control/set', patch, peerId: this.getPeerId() ?? undefined });
    }

    private applyState(input: unknown) {
        const state = sanitizeStoryState(input);
        if (!state) return;
        this.store.setState((prev) => ({
            ...prev,
            // While this operator drags the slider, keep their local week to avoid jitter.
            story: prev.isScrubbing ? { ...state, week: prev.story.week } : state
        }));
    }
}

function readSavedPassword(): string | null {
    try {
        return typeof window === 'undefined'
            ? null
            : window.sessionStorage.getItem(PASSWORD_STORAGE_KEY);
    } catch {
        return null;
    }
}

function savePassword(password: string | null) {
    try {
        if (typeof window === 'undefined') return;
        if (password) window.sessionStorage.setItem(PASSWORD_STORAGE_KEY, password);
        else window.sessionStorage.removeItem(PASSWORD_STORAGE_KEY);
    } catch {
        // Storage unavailable (private mode): the presenter just types it again next time.
    }
}

export const controlEngine = ControlEngine.getInstance();
