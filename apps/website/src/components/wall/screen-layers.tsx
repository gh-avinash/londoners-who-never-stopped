import { MAP_FIRST_COL, isSpotlit, sectionOfColumn } from '../../lib/story/layout';
import { DEEPEST_LOCKDOWN_WEEK } from '../../lib/story/timeline';
import type { LiveStatus, StationsData, StoryData, StoryState } from '../../lib/story/types';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../lib/wall';
import { MapLabels } from './story-map';
import { StationCard, renderTile } from './tiles';
import { BackdropLayer, RiverLabels, RiverLayer } from './wall-graphics';

// Slow fade so spotlight changes never flash in the immersive room.
const SPOTLIGHT_FADE_MS = 900;
const DIMMED_OPACITY = 0.25;
// The presenter's station card sits in the London map's top-left corner (Chilterns edge, where
// there are few stations to cover).
const CARD_TILE = { c: MAP_FIRST_COL, r: 0 };

export type WallData = { stations: StationsData; story: StoryData };

// Everything one screen draws above the map, in order:
//   1. backdrop: scrims, brand wash, top rule (continuous, never dimmed)
//   2. text for this screen's section (dimmed when another section is spotlit)
//   3. map labels   4. timeline river + playhead beam   5. river labels   6. station card
export function ScreenLayers({
    c,
    r,
    data,
    story,
    live
}: {
    c: number;
    r: number;
    data: WallData;
    story: StoryState;
    live: LiveStatus | null;
}) {
    const lastWeek = data.stations.weeks.length - 1;
    const week = Math.min(story.week, lastWeek);
    const networkPct = data.stations.network[week] ?? 0;
    const lit = isSpotlit(sectionOfColumn(c), story);
    const selected = data.stations.stations.find((s) => s.id === story.selected) ?? null;

    return (
        <div
            data-wall-screen
            style={{
                position: 'absolute',
                inset: 0,
                width: SCREEN_WIDTH,
                height: SCREEN_HEIGHT,
                overflow: 'hidden'
            }}
        >
            <BackdropLayer c={c} r={r} state={story} />
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    opacity: lit ? 1 : DIMMED_OPACITY,
                    transition: `opacity ${SPOTLIGHT_FADE_MS}ms ease`
                }}
            >
                {renderTile(c, r, {
                    story: data.story,
                    stations: data.stations,
                    week,
                    state: story,
                    live,
                    lit
                })}
            </div>
            <MapLabels
                c={c}
                r={r}
                stations={data.stations.stations}
                week={week}
                selected={story.selected}
                picks={story.picks}
                whatIf={story.whatIf}
                lockdownWeek={DEEPEST_LOCKDOWN_WEEK}
            />
            <RiverLayer c={c} r={r} network={data.stations.network} week={week} />
            <RiverLabels
                c={c}
                r={r}
                weeks={data.stations.weeks}
                network={data.stations.network}
                week={week}
            />
            {selected && c === CARD_TILE.c && r === CARD_TILE.r && (
                <StationCard station={selected} week={week} networkPct={networkPct} />
            )}
        </div>
    );
}
