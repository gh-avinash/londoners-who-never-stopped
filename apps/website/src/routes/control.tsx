import { PauseIcon, PlayIcon } from '@phosphor-icons/react';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState, type FormEvent } from 'react';

import { Button } from '../components/button';
import { Slider } from '../components/slider';
import { controlEngine } from '../lib/realtime/engines/control-engine';
import { useControlStore } from '../lib/realtime/stores/control-store';
import { useStoryData } from '../lib/story/data';
import { findWeek, formatWeek } from '../lib/story/layout';
import { DEEPEST_LOCKDOWN_WEEK, effectiveFocus } from '../lib/story/timeline';
import type { Focus } from '../lib/story/types';

type ControlSearch = {
    // Optional label so multiple control clients can be distinguished in the simulator.
    operator: string;
};

// A normal pre-pandemic autumn week for the "Before" chapter.
const NORMAL_WEEK = '2019-10-07';

// The what-if view is either real lockdown travel or the prediction (FINDINGS F11).
const WHAT_IF_OPTIONS = [
    { label: 'Reality', value: 0 },
    { label: 'Prediction', value: 100 }
];

// Stations worth showing a visitor, each illustrating a finding (see data/FINDINGS.md).
const SPOTLIGHT_STATIONS = [
    'Barking',
    'Bank',
    'Hampstead Heath',
    'Whitechapel',
    'Denmark Hill',
    'Heathrow Terminal 5'
];

export const Route = createFileRoute('/control')({
    validateSearch: (search: Record<string, unknown>): ControlSearch => {
        return {
            // Default operator id keeps the route usable when query params are omitted.
            operator: typeof search.operator === 'string' ? search.operator : 'A'
        };
    },
    component: ControlPage
});

function ControlPage() {
    // `/control` is the presenter's tablet: it only sends intent to the bus and never renders
    // the heavy wall visuals.
    const { operator } = Route.useSearch();
    const story = useControlStore((state) => state.story);
    const connection = useControlStore((state) => state.connection);
    const auth = useControlStore((state) => state.auth);
    const { data, error } = useStoryData();

    const nameToId = useMemo(
        () => new Map((data?.stationIndex ?? []).map(([id, name]) => [name, id])),
        [data]
    );

    if (auth !== 'ok') return <PasswordGate auth={auth} />;

    if (!data) {
        return (
            <main className="flex h-screen items-center justify-center bg-[var(--background)] text-sm text-[var(--muted-foreground)]">
                {error ? 'Could not load story data.' : 'Loading…'}
            </main>
        );
    }

    const maxWeek = data.weeks.length - 1;
    const active = effectiveFocus(story);
    const chapters: Array<{ label: string; focus: Focus; week?: number; lit: boolean }> = [
        {
            label: '1 · Before',
            focus: 'auto',
            week: findWeek(data.weeks, NORMAL_WEEK),
            lit: active === 'normal'
        },
        {
            label: '2 · Lockdown',
            focus: 'auto',
            week: DEEPEST_LOCKDOWN_WEEK,
            lit: active === 'lockdown'
        },
        { label: '3 · Six years on', focus: 'auto', week: maxWeek, lit: active === 'recovery' },
        { label: 'What if?', focus: 'whatif', lit: active === 'whatif' },
        { label: 'So what?', focus: 'future', lit: active === 'future' },
        { label: 'Show all', focus: 'all', lit: active === 'all' }
    ];

    return (
        <main className="h-screen w-screen overflow-y-auto bg-[var(--background)] text-[var(--foreground)]">
            <div className="flex flex-col gap-3 p-3">
                <header className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                    <div>
                        <p className="text-[10px] tracking-[0.2em] text-[var(--muted-foreground)] uppercase">
                            Presenter {operator} · {connection}
                            {story.attract && ' · wall is playing itself'}
                        </p>
                        <h1 className="text-sm font-semibold">The Londoners who never stopped</h1>
                    </div>
                    <Button onClick={() => controlEngine.tour(maxWeek)} variant="highlight">
                        ▶ Guided tour
                    </Button>
                </header>

                <section className="grid grid-cols-6 gap-2">
                    {chapters.map((chapter) => (
                        <Button
                            key={chapter.label}
                            onClick={() => controlEngine.goTo(chapter.focus, chapter.week)}
                            variant={chapter.lit ? 'highlight' : 'normal'}
                        >
                            {chapter.label}
                        </Button>
                    ))}
                </section>

                <section className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                    <Button
                        onClick={() =>
                            story.playing ? controlEngine.pause() : controlEngine.play(maxWeek)
                        }
                        aria-label={story.playing ? 'Pause timeline' : 'Play timeline'}
                    >
                        {story.playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
                    </Button>
                    <Slider
                        min={0}
                        max={maxWeek}
                        value={story.week}
                        label="Week"
                        className="flex-1"
                        onValueChange={(value) => controlEngine.scrub(Math.round(value))}
                        onInteractionChange={(isScrubbing) =>
                            controlEngine.setScrubbing(isScrubbing)
                        }
                    />
                    <span className="w-24 text-right text-xs tabular-nums">
                        {formatWeek(data.weeks[story.week])}
                    </span>
                </section>

                <section className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                    <p className="text-xs text-[var(--muted-foreground)]">
                        What if? Switch the maps between real lockdown travel and a prediction made
                        only from how many of each station&apos;s neighbours work frontline jobs (it
                        explains {Math.round(data.whatIf.r2 * 100)}% of the differences). Stations
                        that change most are where something else mattered.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                        {WHAT_IF_OPTIONS.map((option) => (
                            <Button
                                key={option.label}
                                onClick={() => controlEngine.setWhatIf(option.value)}
                                variant={
                                    story.whatIf === option.value && active === 'whatif'
                                        ? 'highlight'
                                        : 'normal'
                                }
                            >
                                {option.label}
                            </Button>
                        ))}
                    </div>
                </section>

                <section className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                    <p className="text-xs text-[var(--muted-foreground)]">
                        Highlight a station (visitors can also pick theirs by scanning the QR code)
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                        {SPOTLIGHT_STATIONS.filter((name) => nameToId.has(name)).map((name) => {
                            const id = nameToId.get(name) ?? null;
                            return (
                                <Button
                                    key={name}
                                    onClick={() =>
                                        controlEngine.select(story.selected === id ? null : id)
                                    }
                                    variant={story.selected === id ? 'highlight' : 'normal'}
                                >
                                    {name}
                                </Button>
                            );
                        })}
                    </div>
                    <select
                        aria-label="Any station"
                        value={story.selected ?? ''}
                        onChange={(event) => controlEngine.select(event.target.value || null)}
                        className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-2 text-xs"
                    >
                        <option value="">Any station… (none selected)</option>
                        {data.stationIndex.map(([id, name]) => (
                            <option key={id} value={id}>
                                {name}
                            </option>
                        ))}
                    </select>
                </section>
            </div>
        </main>
    );
}

const AUTH_MESSAGES: Record<string, string> = {
    checking: 'Checking…',
    needed: '',
    wrong: 'That password isn’t right. Try again.',
    locked: 'Too many wrong attempts from this device. Wait a minute, then try again.'
};

// The presenter's controls are locked until the password is accepted by the bus. The wall
// keeps playing by itself meanwhile; screens and visitors' phones never need a password.
function PasswordGate({ auth }: { auth: string }) {
    const [password, setPassword] = useState('');
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (password.trim()) controlEngine.unlock(password);
    };
    return (
        <main className="flex h-screen items-center justify-center bg-[var(--background)] p-4 text-[var(--foreground)]">
            <form
                onSubmit={submit}
                className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-5"
            >
                <h1 className="text-sm font-semibold">The Londoners who never stopped</h1>
                <p className="text-xs text-[var(--muted-foreground)]">
                    Presenter controls. Enter the password shown in the terminal where the app is
                    running (or the one set with CONTROL_PASSWORD).
                </p>
                <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-label="Presenter password"
                    placeholder="Password"
                    className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
                <Button type="submit" variant="highlight" disabled={auth === 'checking'}>
                    Unlock
                </Button>
                {AUTH_MESSAGES[auth] && (
                    <p role="status" className="text-xs text-[var(--muted-foreground)]">
                        {AUTH_MESSAGES[auth]}
                    </p>
                )}
            </form>
        </main>
    );
}
