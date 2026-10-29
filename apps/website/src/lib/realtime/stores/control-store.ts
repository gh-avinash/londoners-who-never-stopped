import { Store, useStore } from '@tanstack/react-store';

import { INITIAL_STORY_STATE } from '../../story/types';
import { createInitialEngineStoreState, type ControlStoreState } from '../types';

const initialState: ControlStoreState = {
    ...createInitialEngineStoreState('control'),
    story: INITIAL_STORY_STATE,
    isScrubbing: false,
    auth: 'checking'
};

// Singleton store for all control-route realtime state.
export const controlStore = new Store(initialState);

export function useControlStore(): ControlStoreState;
export function useControlStore<T>(
    selector: (state: ControlStoreState) => T,
    compare?: (a: T, b: T) => boolean
): T;
export function useControlStore<T>(
    selector?: (state: ControlStoreState) => T,
    compare?: (a: T, b: T) => boolean
) {
    // Default selector returns full state; callers can pass a narrow selector for perf.
    const safeSelector = (selector ?? ((state: ControlStoreState) => state as unknown as T)) as (
        state: ControlStoreState
    ) => T;
    return useStore(controlStore, safeSelector, compare);
}
