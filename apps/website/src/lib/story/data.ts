import { useEffect, useState } from 'react';

import type { CardsData, Station, StationsData, StoryData } from './types';

const STATIONS_URL = '/data/stations.json';
const STORY_URL = '/data/story.json';
const CARDS_URL = '/data/cards.json';

type LoadState<T> = { data: T | null; error: string | null };

// One in-flight request per URL, shared by every component on the page. A failed request is
// forgotten so a later mount can retry.
const requests = new Map<string, Promise<unknown>>();

function fetchJson(url: string): Promise<unknown> {
    let request = requests.get(url);
    if (!request) {
        request = fetch(url, { headers: { accept: 'application/json' } }).then((response) => {
            if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
            return response.json() as Promise<unknown>;
        });
        request.catch(() => requests.delete(url));
        requests.set(url, request);
    }
    return request;
}

function isStation(value: unknown): value is Station {
    if (typeof value !== 'object' || value === null) return false;
    const s = value as Partial<Station>;
    return (
        typeof s.id === 'string' &&
        typeof s.name === 'string' &&
        typeof s.lat === 'number' &&
        typeof s.lon === 'number' &&
        typeof s.base === 'number' &&
        Array.isArray(s.w)
    );
}

// Shape checks on the fields the renderer relies on; malformed stations are dropped.
function parseStations(payload: unknown): StationsData {
    if (typeof payload !== 'object' || payload === null) throw new Error('stations: not an object');
    const raw = payload as Partial<StationsData>;
    if (!Array.isArray(raw.weeks) || !Array.isArray(raw.network) || !Array.isArray(raw.stations)) {
        throw new Error('stations: missing weeks/network/stations');
    }
    const weekCount = raw.weeks.length;
    const stations = raw.stations.filter(
        (s): s is Station => isStation(s) && s.w.length === weekCount
    );
    return { weeks: raw.weeks, network: raw.network, stations };
}

function parseStory(payload: unknown): StoryData {
    if (typeof payload !== 'object' || payload === null) throw new Error('story: not an object');
    const raw = payload as Partial<StoryData>;
    if (!Array.isArray(raw.weeks) || !Array.isArray(raw.stationIndex)) {
        throw new Error('story: missing weeks/stationIndex');
    }
    return raw as StoryData;
}

function useJson<T>(url: string, parse: (payload: unknown) => T): LoadState<T> {
    const [state, setState] = useState<LoadState<T>>({ data: null, error: null });
    useEffect(() => {
        let alive = true;
        fetchJson(url)
            .then((payload) => alive && setState({ data: parse(payload), error: null }))
            .catch((error: unknown) => alive && setState({ data: null, error: String(error) }));
        return () => {
            alive = false;
        };
    }, [url, parse]);
    return state;
}

export function useStationsData() {
    return useJson(STATIONS_URL, parseStations);
}

export function useStoryData() {
    return useJson(STORY_URL, parseStory);
}

function parseCards(payload: unknown): CardsData {
    if (typeof payload !== 'object' || payload === null) throw new Error('cards: not an object');
    const raw = payload as Partial<CardsData>;
    if (!Array.isArray(raw.stations)) throw new Error('cards: missing stations');
    return {
        networkLockdownPct: Number(raw.networkLockdownPct) || 0,
        recovery2026: Number(raw.recovery2026) || 0,
        stations: raw.stations.filter(
            (s) =>
                typeof s === 'object' &&
                s !== null &&
                typeof s.id === 'string' &&
                typeof s.name === 'string'
        )
    };
}

// Small file for visitors' phones (no weekly series).
export function useCardsData() {
    return useJson(CARDS_URL, parseCards);
}
