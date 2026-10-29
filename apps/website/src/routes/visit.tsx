import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { visitorEngine } from '../lib/realtime/engines/visitor-engine';
import { useCardsData } from '../lib/story/data';
import { COLORS, FONT_FAMILY, formatPct } from '../lib/story/layout';
import type { CardsData, StationCardData } from '../lib/story/types';

const MAX_RESULTS = 8;
// Every number on the wall, with its assumptions and corrections (the wall points here).
const METHOD_URL =
    'https://github.com/gh-avinash/londoners-who-never-stopped/blob/main/analysis/FINDINGS.md';

export const Route = createFileRoute('/visit')({
    component: VisitPage
});

// `/visit` opens on a visitor's phone from the QR code on the wall. They find their station; it
// lights up on the wall (via the bus) and its story appears on their phone - a personal
// drill-down that doesn't take the wall away from the presenter.
function VisitPage() {
    const { data, error } = useCardsData();
    const [query, setQuery] = useState('');
    const [chosen, setChosen] = useState<StationCardData | null>(null);

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!data || q.length < 2) return [];
        return data.stations.filter((s) => s.name.toLowerCase().includes(q)).slice(0, MAX_RESULTS);
    }, [data, query]);

    const choose = (station: StationCardData) => {
        setChosen(station);
        setQuery('');
        visitorEngine.pick(station.id);
    };

    return (
        <main
            style={{ fontFamily: FONT_FAMILY, background: COLORS.background, color: COLORS.text }}
            className="min-h-screen p-5"
        >
            <p className="text-xs tracking-[0.2em] uppercase" style={{ color: COLORS.accent }}>
                The Londoners who never stopped
            </p>
            <h1 className="mt-1 text-2xl font-bold">Find your station</h1>
            <p className="mt-1 text-sm" style={{ color: COLORS.subtle }}>
                It will light up on the wall for about a minute.
            </p>

            <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Start typing, e.g. Barking"
                aria-label="Station name"
                className="mt-4 w-full rounded-lg border px-3 py-3 text-base"
                style={{ background: '#1D2228', borderColor: COLORS.muted, color: COLORS.text }}
            />
            {error && <p className="mt-3 text-sm">Couldn’t load stations — please try again.</p>}
            <ul className="mt-2 flex flex-col gap-1">
                {results.map((station) => (
                    <li key={station.id}>
                        <button
                            type="button"
                            onClick={() => choose(station)}
                            className="w-full rounded-lg px-3 py-3 text-left text-base font-semibold"
                            style={{ background: '#1D2228' }}
                        >
                            {station.name}
                        </button>
                    </li>
                ))}
            </ul>

            {chosen && data && <StationStory station={chosen} data={data} />}

            <p className="mt-8 text-sm" style={{ color: COLORS.subtle }}>
                Data: TfL open data and ONS Census 2021.{' '}
                <a href={METHOD_URL} className="underline" style={{ color: COLORS.accent }}>
                    How these numbers were made
                </a>
            </p>
        </main>
    );
}

function StationStory({ station, data }: { station: StationCardData; data: CardsData }) {
    const rows: Array<[string, string]> = [];
    if (station.lockdownStatus === 'ok' && station.lockdown !== null) {
        rows.push([
            'Spring 2020 lockdown',
            `${formatPct(station.lockdown, 1)} of normal (London: ${formatPct(data.networkLockdownPct, 1)})`
        ]);
    } else if (station.lockdownStatus === 'closed') {
        rows.push(['Spring 2020 lockdown', 'Station closed']);
    }
    if (station.rec2026 !== null) {
        rows.push([
            'Autumn 2026',
            `${formatPct(station.rec2026)} of 2019 (London: ${formatPct(data.recovery2026)})`
        ]);
    }
    if (station.frontline !== null) {
        rows.push(['Neighbours in frontline jobs', formatPct(station.frontline)]);
    }
    if (station.model !== null && station.lockdown !== null && station.lockdownStatus === 'ok') {
        const gap = station.lockdown - station.model;
        rows.push([
            'Compared with what neighbours’ jobs predict',
            Math.abs(gap) < 1
                ? 'about as predicted'
                : `${gap > 0 ? 'busier' : 'quieter'} than predicted (${gap > 0 ? '+' : '−'}${Math.abs(gap).toFixed(1)} pts)`
        ]);
    }
    if (station.hospital) rows.push(['Nearby hospital', station.hospital]);

    return (
        <section
            className="mt-6 rounded-xl p-4"
            style={{ background: '#1D2228', borderLeft: `6px solid ${COLORS.accent}` }}
        >
            <h2 className="text-xl font-bold" style={{ color: COLORS.accent }}>
                {station.name}
            </h2>
            <p className="text-sm" style={{ color: COLORS.subtle }}>
                Look at the wall — it’s glowing on the map.
            </p>
            <dl className="mt-3 flex flex-col gap-3">
                {rows.map(([label, value]) => (
                    <div key={label}>
                        <dt className="text-xs uppercase" style={{ color: COLORS.subtle }}>
                            {label}
                        </dt>
                        <dd className="text-base font-semibold">{value}</dd>
                    </div>
                ))}
            </dl>
            {station.recStatus !== 'ok' && station.rec2026 !== null && (
                <p className="mt-3 text-xs" style={{ color: COLORS.subtle }}>
                    Note: this station is left out of the wall’s recovery figures (
                    {station.recStatus.replaceAll('_', ' ')}).
                </p>
            )}
        </section>
    );
}
