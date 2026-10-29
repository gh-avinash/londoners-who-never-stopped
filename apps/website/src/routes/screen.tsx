import { createFileRoute, useLocation } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { ScreenLayers } from '../components/wall/screen-layers';
import { StoryMap } from '../components/wall/story-map';
import { Lines, Tile } from '../components/wall/text';
import { screenEngine } from '../lib/realtime/engines/screen-engine';
import { useScreenStore } from '../lib/realtime/stores/screen-store';
import { useStationsData, useStoryData } from '../lib/story/data';
import { COLORS, dotScaleFor, tileMapView } from '../lib/story/layout';
import { DEEPEST_LOCKDOWN_WEEK } from '../lib/story/timeline';
import { SCREEN_HEIGHT, SCREEN_WIDTH, WALL_COLS, WALL_ROWS } from '../lib/wall';

export const Route = createFileRoute('/screen')({
    component: ScreenPage
});

// One `/screen?c=<col>&r=<row>` instance drives one physical display of the 16 x 4 wall. Each
// screen draws its window onto one shared wall-sized picture: the map is the continuous
// background on every screen, with the story's layers (screen-layers.tsx) on top.
function ScreenPage() {
    const { search } = useLocation();
    const searchParams = (search as Record<string, unknown>) ?? {};
    const c = parseScreenCoordinate(searchParams.c, WALL_COLS, 0);
    const r = parseScreenCoordinate(searchParams.r, WALL_ROWS, 0);

    const story = useScreenStore((state) => state.story);
    const live = useScreenStore((state) => state.live);
    const stations = useStationsData();
    const storyData = useStoryData();
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
        // WebGL maps and the websocket only exist in the browser (BEST_PRACTICES §4). Reading the
        // engine role here also makes sure the singleton engine is created and connects.
        setIsClient(screenEngine.getRole() === 'screen');
    }, []);

    const data =
        stations.data && storyData.data ? { stations: stations.data, story: storyData.data } : null;
    const lastWeek = data ? data.stations.weeks.length - 1 : 0;

    useEffect(() => {
        if (lastWeek > 0) screenEngine.announceDataset(lastWeek);
    }, [lastWeek]);

    const week = Math.min(story.week, lastWeek);
    const error = stations.error ?? storyData.error;

    return (
        <main
            style={{
                position: 'relative',
                width: SCREEN_WIDTH,
                height: SCREEN_HEIGHT,
                overflow: 'hidden',
                background: COLORS.background
            }}
        >
            {error && (
                <Tile>
                    <Lines
                        size="secondary"
                        color={COLORS.subtle}
                        lines={['Data unavailable', 'retrying on reload']}
                    />
                </Tile>
            )}
            {data && (
                <>
                    {isClient && (
                        <StoryMap
                            view={tileMapView(c, r)}
                            width={SCREEN_WIDTH}
                            height={SCREEN_HEIGHT}
                            dotScale={dotScaleFor(c)}
                            stations={data.stations.stations}
                            week={week}
                            networkPct={data.stations.network[week] ?? 0}
                            selected={story.selected}
                            picks={story.picks}
                            whatIf={story.whatIf}
                            lockdownWeek={DEEPEST_LOCKDOWN_WEEK}
                            lockdownNetworkPct={data.story.networkLockdownPct}
                        />
                    )}
                    <ScreenLayers c={c} r={r} data={data} story={story} live={live} />
                </>
            )}
        </main>
    );
}

function parseScreenCoordinate(value: unknown, size: number, fallback: number) {
    // SSR and direct route probes may hit `/screen` without `c`/`r`.
    // Fail gracefully by falling back to a deterministic tile.
    if (value === null || value === undefined) {
        return Math.min(size - 1, Math.max(0, fallback));
    }
    const parsed =
        typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isInteger(parsed)) {
        return Math.min(size - 1, Math.max(0, fallback));
    }
    // Clamp keeps out-of-range coordinates inside the supported wall grid.
    return Math.min(size - 1, Math.max(0, parsed));
}
