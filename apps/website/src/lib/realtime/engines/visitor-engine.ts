import { Store } from '@tanstack/react-store';

import { createInitialEngineStoreState, type EngineStoreState } from '../types';
import { BusEngine } from './bus-engine';

// Visitor phones (`/visit`): a send-only client. It can light up one station at a time on the
// wall, and nothing else - the bus accepts only `visitor/pick` from it.
export const visitorStore = new Store<EngineStoreState>(createInitialEngineStoreState('visitor'));

export class VisitorEngine extends BusEngine<EngineStoreState> {
    private constructor() {
        super('visitor', visitorStore);
    }

    static getInstance() {
        const globalWithVisitorEngine = globalThis as typeof globalThis & {
            __visitorEngineInstance?: VisitorEngine;
        };
        if (!globalWithVisitorEngine.__visitorEngineInstance) {
            globalWithVisitorEngine.__visitorEngineInstance = new VisitorEngine();
        }
        return globalWithVisitorEngine.__visitorEngineInstance;
    }

    pick(stationId: string) {
        this.send({ type: 'visitor/pick', id: stationId });
    }
}

export const visitorEngine = VisitorEngine.getInstance();
