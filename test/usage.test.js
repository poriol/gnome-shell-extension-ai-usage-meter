import {describe, it} from 'node:test';
import assert from 'node:assert/strict';

import {
    DANGER_COLOR,
    bestSpend,
    durationText,
    exhaustedWindow,
    fixFor,
    isSession,
    isWeekly,
    panelWindow,
    parseReport,
    resetText,
    spendOf,
    usageColor,
    windowsOf,
} from '../usage.js';

const NOW = Date.parse('2026-11-23T21:30:00Z');
const OPTS = {minLeft: 20, sessionMinutes: 60, weeklyHours: 24};

const CLAUDE_REPORT = {
    provider: 'claude',
    rateWindowLabels: {primary: 'Session', secondary: 'Weekly'},
    usage: {
        updatedAt: '2026-11-23T21:29:47Z',
        primary: {windowMinutes: 300, resetsAt: '2026-11-24T01:20:00Z', usedPercent: 79},
        secondary: {windowMinutes: 10080, resetsAt: '2026-11-26T23:00:00Z', usedPercent: 6},
        tertiary: null,
    },
};

const CODEX_REPORT = {
    provider: 'codex',
    rateWindowLabels: {primary: 'Session', secondary: 'Weekly'},
    usage: {
        updatedAt: '2026-11-23T21:45:21Z',
        primary: {windowMinutes: 300, resetsAt: '2026-11-24T02:45:20Z', usedPercent: 0},
        secondary: {windowMinutes: 10080, resetsAt: '2026-11-25T18:17:32Z', usedPercent: 100},
        tertiary: null,
    },
};

const ANTIGRAVITY_REPORT = {
    provider: 'antigravity',
    rateWindowLabels: {primary: 'Gemini Models', secondary: 'Claude and GPT'},
    usage: {
        updatedAt: '2026-11-23T21:26:13Z',
        primary: {windowMinutes: 300, resetsAt: '2026-11-24T01:06:22Z', usedPercent: 4.5},
        secondary: {windowMinutes: 300, resetsAt: '2026-11-24T02:26:12Z', usedPercent: 0},
        tertiary: null,
        extraRateWindows: [
            {
                id: 'antigravity-quota-summary-gemini-5h',
                title: 'Gemini 5-hour',
                window: {windowMinutes: 300, resetsAt: '2026-11-24T01:06:22Z', usedPercent: 4.5},
            },
            {
                id: 'antigravity-quota-summary-gemini-weekly',
                title: 'Gemini weekly',
                window: {windowMinutes: 10080, resetsAt: '2026-11-30T20:06:22Z', usedPercent: 2.1},
            },
            {
                id: 'antigravity-quota-summary-3p-5h',
                title: 'Claude/GPT 5-hour',
                window: {windowMinutes: 300, resetsAt: '2026-11-24T02:26:12Z', usedPercent: 0},
            },
            {
                id: 'antigravity-quota-summary-3p-weekly',
                title: 'Claude/GPT weekly',
                window: {windowMinutes: 10080, resetsAt: '2026-11-30T21:26:12Z', usedPercent: 0},
            },
        ],
    },
};

describe('parseReport', () => {
    it('parses valid array output and ignores libcurl warnings on stderr', () => {
        const stderr = 'CodexBarCLI: /lib64/libcurl.so.4: no version information available\n';
        const report = parseReport(JSON.stringify([CLAUDE_REPORT]), stderr);
        assert.equal(report.provider, 'claude');
    });

    it('surfaces useful stderr when stdout is empty', () => {
        const stderr = 'CodexBarCLI: /lib64/libcurl.so.4: no version information available\nfatal: crash\n';
        assert.throws(() => parseReport('', stderr), /fatal: crash/);
    });

    it('falls back to a clear message when both stdout and stderr are useless', () => {
        assert.throws(() => parseReport('', ''), /codexbar returned no data/);
        assert.throws(() => parseReport('not json', ''), /invalid JSON/);
    });

    it('throws provider error messages from JSON', () => {
        assert.throws(
            () => parseReport(JSON.stringify([{error: {message: 'Token expired'}}])),
            /Token expired/);
    });
});

describe('windowsOf', () => {
    it('deduplicates Antigravity core/extra twins and preserves pools', () => {
        const windows = windowsOf(ANTIGRAVITY_REPORT);
        assert.equal(windows.length, 4);
        assert.deepEqual(
            windows.map(w => [w.label, w.pool, w.minutes]),
            [
                ['Gemini 5-hour', 'gemini', 300],
                ['Claude/GPT 5-hour', '3p', 300],
                ['Gemini weekly', 'gemini', 10080],
                ['Claude/GPT weekly', '3p', 10080],
            ]);
    });

    it('deduplicates twins even when resetsAt is missing (NaN)', () => {
        const report = {
            rateWindowLabels: {primary: 'Gemini Models'},
            usage: {
                updatedAt: '2026-11-23T21:26:13Z',
                primary: {windowMinutes: 300, usedPercent: 10},
                extraRateWindows: [{
                    id: 'antigravity-quota-summary-gemini-5h',
                    title: 'Gemini 5-hour',
                    window: {windowMinutes: 300, usedPercent: 10},
                }],
            },
        };
        const windows = windowsOf(report);
        assert.equal(windows.length, 1);
        assert.equal(windows[0].label, 'Gemini 5-hour');
    });

    it('rejects reports containing only codexbar placeholder windows', () => {
        const report = {
            usage: {
                updatedAt: '2026-11-23T21:00:00Z',
                primary: {usedPercent: 0, resetsAt: '2026-11-24T02:00:01Z'},
            },
        };
        assert.deepEqual(windowsOf(report), []);
    });

    it('keeps real untouched 0% windows that include windowMinutes', () => {
        const report = {
            usage: {
                updatedAt: '2026-11-23T21:00:00Z',
                primary: {windowMinutes: 300, usedPercent: 0, resetsAt: '2026-11-24T02:00:00Z'},
            },
        };
        assert.equal(windowsOf(report).length, 1);
    });

    it('disambiguates model-specific Gemini titles', () => {
        const report = {
            usage: {
                updatedAt: '2026-11-23T21:00:00Z',
                extraRateWindows: [{
                    id: 'antigravity-quota-summary-gemini-argon-wtu-weekly',
                    title: 'Gemini weekly',
                    window: {windowMinutes: 10080, usedPercent: 15, resetsAt: '2026-11-30T21:00:00Z'},
                }],
            },
        };
        const [win] = windowsOf(report);
        assert.equal(win.label, 'Gemini Argon weekly');
        assert.equal(win.pool, 'gemini-argon-wtu');
    });
});

describe('panelWindow', () => {
    it('picks weekly windows properly for Antigravity instead of secondary 5h', () => {
        const windows = windowsOf(ANTIGRAVITY_REPORT);
        assert.equal(panelWindow(windows, 'weekly').label, 'Gemini weekly');
        assert.equal(panelWindow(windows, 'session').label, 'Gemini 5-hour');
        assert.equal(panelWindow(windows, 'highest').label, 'Gemini 5-hour');
    });

    it('picks the highest-used session window when multiple exist', () => {
        const report = structuredClone(ANTIGRAVITY_REPORT);
        report.usage.secondary.usedPercent = 65;
        report.usage.extraRateWindows[2].window.usedPercent = 65;
        const windows = windowsOf(report);
        assert.equal(panelWindow(windows, 'session').label, 'Claude/GPT 5-hour');
    });

    it('falls back to highest window when requested metric is absent', () => {
        const weeklyOnly = [
            {key: 'a', label: 'Weekly A', pool: null, used: 10, resetsAt: NOW + 1e7, minutes: 10080},
            {key: 'b', label: 'Weekly B', pool: null, used: 40, resetsAt: NOW + 1e7, minutes: 10080},
        ];
        assert.equal(panelWindow(weeklyOnly, 'session').label, 'Weekly B');
        assert.equal(panelWindow([], 'session'), null);
    });
});

describe('exhaustedWindow', () => {
    it('returns Codex weekly window when at 100%', () => {
        const win = exhaustedWindow(windowsOf(CODEX_REPORT));
        assert.equal(win.label, 'Weekly');
        assert.equal(isWeekly(win), true);
        assert.equal(isSession(win), false);
    });

    it('prefers finite resetsAt over NaN and picks the latest reset', () => {
        const windows = [
            {key: 'a', label: 'W1', pool: null, used: 100, resetsAt: NaN, minutes: 10080},
            {key: 'b', label: 'W2', pool: null, used: 100, resetsAt: NOW + 3600000, minutes: 10080},
            {key: 'c', label: 'W3', pool: null, used: 100, resetsAt: NOW + 7200000, minutes: 10080},
        ];
        assert.equal(exhaustedWindow(windows).key, 'c');
    });
});

describe('durationText and resetText', () => {
    it('formats sub-minute positive durations as <1m instead of now', () => {
        assert.equal(durationText(30000), '<1m');
        assert.equal(durationText(0), 'now');
        assert.equal(durationText(-5000), 'now');
        assert.equal(durationText(NaN), '');
        assert.equal(durationText(90 * 60000), '1h 30m');
        assert.equal(durationText(26 * 3600000), '1d 2h');
        assert.equal(resetText({resetsAt: NOW + 15000}, NOW), '<1m');
    });
});

describe('spendOf and bestSpend', () => {
    it('caps session spend by weekly remaining in shared-pool providers', () => {
        const windows = [
            {key: 'primary', label: 'Session', pool: null, used: 10, resetsAt: NOW + 30 * 60000, minutes: 300},
            {key: 'secondary', label: 'Weekly', pool: null, used: 90, resetsAt: NOW + 48 * 3600000, minutes: 10080},
        ];
        assert.equal(spendOf(windows[0], windows, OPTS, NOW), null);
    });

    it('does not cross-cap sibling windows of the same length or different pools', () => {
        const windows = [
            {key: 'primary', label: 'Gemini 5-hour', pool: 'gemini', used: 95, resetsAt: NOW + 30 * 60000, minutes: 300},
            {key: 'secondary', label: 'Claude/GPT 5-hour', pool: '3p', used: 10, resetsAt: NOW + 30 * 60000, minutes: 300},
            {key: 'g-w', label: 'Gemini weekly', pool: 'gemini', used: 95, resetsAt: NOW + 48 * 3600000, minutes: 10080},
            {key: '3p-w', label: 'Claude/GPT weekly', pool: '3p', used: 20, resetsAt: NOW + 48 * 3600000, minutes: 10080},
        ];
        const spend = spendOf(windows[1], windows, OPTS, NOW);
        assert.equal(spend.left, 80); // capped by 3p weekly (80% left), NOT gemini (5% left)
        assert.equal(bestSpend(windows, OPTS, NOW).window.label, 'Claude/GPT 5-hour');
    });

    it('does not cap same-length weekly pools against each other', () => {
        const windows = [
            {key: 'g-w', label: 'Gemini weekly', pool: 'gemini', used: 95, resetsAt: NOW + 10 * 3600000, minutes: 10080},
            {key: '3p-w', label: 'Claude/GPT weekly', pool: '3p', used: 0, resetsAt: NOW + 10 * 3600000, minutes: 10080},
        ];
        assert.equal(spendOf(windows[1], windows, OPTS, NOW).left, 100);
    });
});

describe('fixFor and usageColor', () => {
    it('provides fixes for missing codexbar, Claude, Codex, and Antigravity', () => {
        assert.equal(fixFor('claude', 'codexbar not found', p => p === 'brew').command, 'brew install steipete/tap/codexbar');
        assert.equal(fixFor('claude', 'codexbar not found', () => false).command, null);
        assert.equal(fixFor('claude', 'OAuth token expired', p => p === 'claude').command, 'claude auth login');
        assert.equal(fixFor('codex', 'Missing auth.json', () => false).command, 'npx -y @openai/codex login');
        assert.equal(fixFor('antigravity', 'Antigravity not detected', () => false).urlLabel, 'How to install agy');
        assert.match(fixFor('antigravity', 'session expired', () => false).command, /agy/);
    });

    it('returns danger color at >= 90%', () => {
        assert.equal(usageColor(90, '#10a37f'), DANGER_COLOR);
        assert.equal(usageColor(50, '#10a37f'), '#10a37f');
    });
});
