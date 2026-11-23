// Turns codexbar's JSON into what the UI shows. Plain JS with no Shell
// imports, so prefs.js and tests can share it.

export const PROVIDERS = [
    {id: 'claude', name: 'Claude', color: '#d97757'},
    {id: 'codex', name: 'Codex', color: '#10a37f'},
    {
        id: 'antigravity',
        name: 'Antigravity',
        color: '#4f8ef7',
        emptyHint: 'Update the Antigravity CLI (agy update) and sign in with agy to get usage',
    },
];

const CODEXBAR_URL = 'https://github.com/steipete/CodexBar';
const ANTIGRAVITY_HELP_URL = 'https://antigravity.google/docs/install/';

export const MUTED_COLOR = '#888888';
const WARN = {percent: 70, color: '#e5a50a'};
export const DANGER_COLOR = '#e01b24';
const DANGER = {percent: 90, color: DANGER_COLOR};
export const SPEND_COLOR = '#33d17a';
// Windows up to a day long count as sessions, longer ones as weekly.
const SHORT_WINDOW_MINUTES = 1440;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function firstUsefulError(stderr) {
    return (stderr ?? '')
        .split('\n')
        .map(line => line.trim())
        .find(line => line && !/no version information available/i.test(line));
}

// Returns the provider's report; codexbar reports failures as JSON too.
export function parseReport(stdout, stderr = '') {
    const raw = (stdout ?? '').trim();
    if (!raw)
        throw new Error(firstUsefulError(stderr) ?? 'codexbar returned no data');

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(firstUsefulError(stderr) ?? 'codexbar returned invalid JSON');
    }

    const report = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!report || typeof report !== 'object')
        throw new Error(firstUsefulError(stderr) ?? 'codexbar returned no data');
    if (report.error)
        throw new Error(report.error.message ?? 'codexbar failed');
    return report;
}

// A plain-words explanation of a known error with a command that fixes it (run
// in a terminal), a web page that helps (url, urlLabel), or both. Null for
// errors without a known fix.
// hasProgram(name) says whether a program is installed.
export function fixFor(providerId, message, hasProgram) {
    if (/codexbar not found|no such file or directory.*codexbar/i.test(message)) {
        return {
            hint: 'codexbar is not installed. Install it so the extension can read your usage.',
            label: 'Install codexbar',
            command: hasProgram('brew') ? 'brew install steipete/tap/codexbar' : null,
            url: CODEXBAR_URL,
            urlLabel: 'How to install codexbar',
        };
    }
    if (providerId === 'claude' &&
        /oauth|credentials|sign in|login|unauthorized|401|expired|not authenticated|reauthenticate/i.test(message) &&
        hasProgram('claude')) {
        return {
            hint: 'Your Claude sign-in has expired. Sign in again in the browser window that opens.',
            label: 'Sign in to Claude',
            command: 'claude auth login',
        };
    }
    if (providerId === 'codex' &&
        /auth\.json|codex login|reauthenticate|unauthorized|401|expired/i.test(message)) {
        const login = hasProgram('codex') ? 'codex login' : 'npx -y @openai/codex login';
        return {
            hint: 'Your Codex sign-in has expired. Sign in again in the browser window that opens.',
            label: 'Sign in to Codex',
            command: login,
        };
    }
    if (providerId === 'antigravity') {
        // codexbar's message when it finds neither the CLI nor the app.
        if (/not detected/i.test(message)) {
            return {
                hint: 'Antigravity usage is read with its CLI (agy). Install it, then run agy once to sign in.',
                url: ANTIGRAVITY_HELP_URL,
                urlLabel: 'How to install agy',
            };
        }
        // agy makes a one-time sign-in link itself and opens it in the browser.
        if (/signed out|sign in|not signed|session expired|auth not found/i.test(message)) {
            return {
                hint: 'Your Antigravity sign-in has expired. Choose Google OAuth in the terminal, sign in in the browser, then type /quit.',
                label: 'Sign in to Antigravity',
                // The installer's directory may be missing from the session's PATH.
                command: 'PATH="$PATH:$HOME/.local/bin" agy',
                url: ANTIGRAVITY_HELP_URL,
                urlLabel: 'Sign-in help',
            };
        }
    }
    return null;
}

// Antigravity tracks independent quota pools (e.g. gemini vs 3p) whose ids
// look like antigravity-quota-summary-<pool>-(5h|weekly). Shared windows
// (Claude, Codex) have no pool (null).
function quotaPool(id) {
    const match = id?.match(/^antigravity-quota-summary-(.+)-(?:5h|weekly|daily|session|\d+[mhd])$/);
    return match?.[1] ?? null;
}

function toWindow(key, label, raw, pool = null) {
    const minutes = typeof raw.windowMinutes === 'number' && Number.isFinite(raw.windowMinutes)
        ? raw.windowMinutes
        : null;
    return {
        key,
        label,
        pool,
        used: clamp(raw.usedPercent, 0, 100),
        resetsAt: Date.parse(raw.resetsAt),
        minutes,
    };
}

// Antigravity titles a model's own quota like the general one ("Gemini
// weekly") and only the id tells them apart: ...-gemini-argon-wtu-weekly.
function extraTitle({id, title}) {
    const model = id.match(/-gemini-([a-z]+)-/)?.[1];
    if (!model || title.toLowerCase().includes(model))
        return title;
    return title.replace('Gemini', `Gemini ${model[0].toUpperCase()}${model.slice(1)}`);
}

// When codexbar can't read Antigravity's quotas it reports an untouched window
// without a length that "resets" a whole number of hours after the report was
// made: a placeholder recomputed on every call, not real usage. Real untouched
// windows have a length. The report time may be a second off.
function isPlaceholder(window, updatedAt) {
    const ms = window.resetsAt - updatedAt;
    return window.minutes === null && window.used === 0 && ms > 0 &&
        Math.abs(ms - Math.round(ms / 3600000) * 3600000) <= 2000;
}

const isSameQuota = (a, b) =>
    a.minutes === b.minutes && Object.is(a.resetsAt, b.resetsAt) && a.used === b.used;

export function isWeekly(window) {
    return window.minutes !== null
        ? window.minutes > SHORT_WINDOW_MINUTES
        : window.key === 'secondary';
}

export function isSession(window) {
    return window.minutes !== null
        ? window.minutes <= SHORT_WINDOW_MINUTES
        : window.key === 'primary';
}

const highestUsed = windows =>
    windows.reduce((a, b) => (!a || b.used > a.used ? b : a), null);

// Lists the windows with known usage, shortest first. Antigravity repeats
// primary/secondary in its extra windows: each pair becomes one row with the
// extra's descriptive title and pool, and the core window's key.
export function windowsOf(report) {
    const usage = report.usage ?? {};
    const labels = report.rateWindowLabels ?? {};
    const core = [];
    const extras = [];

    for (const [key, fallback] of [['primary', 'Session'], ['secondary', 'Weekly'], ['tertiary', 'Other']]) {
        if (typeof usage[key]?.usedPercent === 'number')
            core.push(toWindow(key, labels[key] ?? fallback, usage[key]));
    }

    for (const extra of usage.extraRateWindows ?? []) {
        if (extra.usageKnown === false || typeof extra.window?.usedPercent !== 'number')
            continue;
        const window = toWindow(extra.id, extraTitle(extra), extra.window, quotaPool(extra.id));
        const twin = core.find(w => isSameQuota(w, window));
        if (twin) {
            core.splice(core.indexOf(twin), 1);
            window.key = twin.key;
        }
        extras.push(window);
    }
    const windows = [...core, ...extras];
    if (windows.length === 0)
        return [];
    // All placeholders means nothing is connected, so no usage is known.
    const updatedAt = Date.parse(usage.updatedAt);
    if (windows.every(w => isPlaceholder(w, updatedAt)))
        return [];
    // Stable, so windows of equal length keep codexbar's order.
    return windows.sort((a, b) => {
        const am = a.minutes ?? Infinity;
        const bm = b.minutes ?? Infinity;
        return am === bm ? 0 : am - bm;
    });
}

// Picks the window the top bar shows. Falls back to the highest-used window
// when a provider has no window matching the requested metric. Null when empty.
export function panelWindow(windows, metric) {
    if (metric === 'session')
        return highestUsed(windows.filter(isSession)) ?? highestUsed(windows);
    if (metric === 'weekly')
        return highestUsed(windows.filter(isWeekly)) ?? highestUsed(windows);
    return highestUsed(windows);
}

function isLaterReset(candidate, current) {
    const cFinite = Number.isFinite(candidate.resetsAt);
    const curFinite = Number.isFinite(current.resetsAt);
    if (cFinite !== curFinite)
        return cFinite;
    return cFinite && candidate.resetsAt > current.resetsAt;
}

// The weekly (longer than a day) window that is used up, or null. With
// several, the one resetting last: it is what keeps the provider blocked.
export function exhaustedWindow(windows) {
    return windows
        .filter(w => isWeekly(w) && w.used >= 100)
        .reduce((a, b) => (!a || isLaterReset(b, a) ? b : a), null);
}

export function usageColor(used, baseColor) {
    if (used >= DANGER.percent)
        return DANGER.color;
    return used >= WARN.percent ? WARN.color : baseColor;
}

// Human-readable duration for a positive millisecond span, or '' / 'now'.
export function durationText(ms) {
    if (!Number.isFinite(ms))
        return '';
    if (ms <= 0)
        return 'now';
    if (ms < 60000)
        return '<1m';
    const mins = Math.floor(ms / 60000);
    const d = Math.floor(mins / 1440);
    const h = Math.floor(mins % 1440 / 60);
    const m = mins % 60;
    if (d)
        return `${d}d ${h}h`;
    return h ? `${h}h ${m}m` : `${m}m`;
}

// Short countdown to the window's reset, or '' if unknown.
export function resetText(window, now = Date.now()) {
    return durationText(window.resetsAt - now);
}

const samePool = (a, b) => !a.pool || !b.pool || a.pool === b.pool;

function isLongerWindow(longer, shorter) {
    if (longer.minutes !== null && shorter.minutes !== null)
        return longer.minutes > shorter.minutes;
    return isWeekly(longer) && isSession(shorter);
}

// Usage still to spend in a window before it resets and the rest is lost, or
// null when it isn't worth flagging: too much time left, too little usage
// left, or reset time unknown (a Claude session that hasn't started yet).
// A strictly longer window in the same quota pool caps what a shorter one can
// still spend: 80% of a session left is worth only 10% when its weekly window
// has 10% left.
export function spendOf(window, windows, opts, now = Date.now()) {
    const msLeft = window.resetsAt - now;
    if (!Number.isFinite(msLeft) || msLeft <= 0)
        return null;
    const finalMinutes = isWeekly(window) ? opts.weeklyHours * 60 : opts.sessionMinutes;
    if (msLeft > finalMinutes * 60000)
        return null;
    const caps = windows
        .filter(w => w !== window && samePool(w, window) && isLongerWindow(w, window))
        .map(w => 100 - w.used);
    const left = Math.min(...caps, 100 - window.used);
    return left >= opts.minLeft ? {left, msLeft} : null;
}

// The provider's window with the most usage to spend, or null.
export function bestSpend(windows, opts, now = Date.now()) {
    let best = null;
    for (const window of windows) {
        const spend = spendOf(window, windows, opts, now);
        if (spend && (!best || spend.left > best.spend.left))
            best = {window, spend};
    }
    return best;
}
