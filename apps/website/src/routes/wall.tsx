import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { ScreenLayers } from '../components/wall/screen-layers';
import { StoryMap } from '../components/wall/story-map';
import { screenEngine } from '../lib/realtime/engines/screen-engine';
import { useScreenStore } from '../lib/realtime/stores/screen-store';
import { useStationsData, useStoryData } from '../lib/story/data';
import { COLORS, previewMapRegions } from '../lib/story/layout';
import { DEEPEST_LOCKDOWN_WEEK } from '../lib/story/timeline';
import { SCREEN_HEIGHT, SCREEN_WIDTH, WALL_COLS, WALL_ROWS } from '../lib/wall';

export const Route = createFileRoute('/wall')({
    component: WallPreviewPage
});

const WALL_W = WALL_COLS * SCREEN_WIDTH;
const WALL_H = WALL_ROWS * SCREEN_HEIGHT;
// Thin lines where the physical bezels are, so the preview reads like the real room.
const BEZEL_PX = 1;

// `/wall` previews the whole 16 x 4 wall on one monitor. Unlike the simulator's 64 iframes it
// draws two maps (London, close-up) for the entire wall (a browser allows only ~16 WebGL maps per page) and the
// 64 screens' story layers scaled down on top - the same components the real screens use.
// It listens to the bus like a screen, so the tablet, attract mode and visitor picks all work.
function WallPreviewPage() {
    const story = useScreenStore((state) => state.story);
    const live = useScreenStore((state) => state.live);
    const stations = useStationsData();
    const storyData = useStoryData();
    const [scale, setScale] = useState(0);

    useEffect(() => {
        screenEngine.getRole();
        const update = () => setScale(window.innerWidth / WALL_W);
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);

    const data =
        stations.data && storyData.data ? { stations: stations.data, story: storyData.data } : null;
    const lastWeek = data ? data.stations.weeks.length - 1 : 0;
    useEffect(() => {
        if (lastWeek > 0) screenEngine.announceDataset(lastWeek);
    }, [lastWeek]);
    const week = Math.min(story.week, lastWeek);

    return (
        <main
            style={{
                minHeight: '100vh',
                background: '#000',
                display: 'flex',
                alignItems: 'center'
            }}
        >
            {data && scale > 0 && (
                <div
                    style={{
                        position: 'relative',
                        width: WALL_W * scale,
                        height: WALL_H * scale,
                        overflow: 'hidden',
                        background: COLORS.background
                    }}
                >
                    {previewMapRegions(scale).map((region) => (
                        <div
                            key={region.left}
                            style={{
                                position: 'absolute',
                                left: region.left,
                                top: 0,
                                width: region.width,
                                height: region.height
                            }}
                        >
                            <StoryMap
                                view={region.view}
                                width={region.width}
                                height={region.height}
                                scale={scale}
                                dotScale={region.dotScale}
                                stations={data.stations.stations}
                                week={week}
                                networkPct={data.stations.network[week] ?? 0}
                                selected={story.selected}
                                picks={story.picks}
                                whatIf={story.whatIf}
                                lockdownWeek={DEEPEST_LOCKDOWN_WEEK}
                                lockdownNetworkPct={data.story.networkLockdownPct}
                            />
                        </div>
                    ))}
                    {Array.from({ length: WALL_COLS * WALL_ROWS }, (_, i) => {
                        const c = i % WALL_COLS;
                        const r = Math.floor(i / WALL_COLS);
                        return (
                            <div
                                key={i}
                                style={{
                                    position: 'absolute',
                                    left: c * SCREEN_WIDTH * scale,
                                    top: r * SCREEN_HEIGHT * scale,
                                    width: SCREEN_WIDTH,
                                    height: SCREEN_HEIGHT,
                                    transform: `scale(${scale})`,
                                    transformOrigin: 'top left',
                                    outline: `${BEZEL_PX / scale}px solid rgba(0, 0, 0, 0.6)`
                                }}
                            >
                                <ScreenLayers c={c} r={r} data={data} story={story} live={live} />
                            </div>
                        );
                    })}
                </div>
            )}
        </main>
    );
}
