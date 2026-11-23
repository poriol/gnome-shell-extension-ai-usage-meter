// Turns codexbar's JSON into what the UI shows. Plain JS with no Shell
// imports, so prefs.js can share it.

export const PROVIDERS = [
    {id: 'claude', name: 'Claude', color: '#d97757'},
    {id: 'codex', name: 'Codex', color: '#10a37f'},
    {
        id: 'antigravity',
        name: 'Antigravity',
        color: '#4f8ef7',
        emptyHint: 'Update the Antigravity CLI (agy update) and sign in with agy to get usage',
        // Without a working source, old figures mislead.
        dropStaleData: true,
    },
];

const ANTIGRAVITY_HELP_URL = 'https://antigravity.google/docs/install/';

export const MUTED_COLOR = '#888888';
const WARN = {percent: 70, color: '#e5a50a'};
export const DANGER_COLOR = '#e01b24';
const DANGER = {percent: 90, color: DANGER_COLOR};
export const SPEND_COLOR = '#33d17a';
// Windows up to a day long count as sessions, longer ones as weekly.
const SHORT_WINDOW_MINUTES = 1440;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Returns the provider's report; codexbar reports failures as JSON too.
export function parseReport(stdout) {
    const report = JSON.parse(stdout || '[]')[0];
    if (!report)
        throw new Error('codexbar returned no data');
    if (report.error)
        throw new Error(report.error.message ?? 'codexbar failed');
    return report;
}

// A plain-words explanation of a known error with a command that fixes it (run
// in a terminal), a web page that helps (url, urlLabel), or both. Null for
// errors without a known fix.
// hasProgram(name) says whether a program is installed.
export function fixFor(providerId, message, hasProgram) {
    if (providerId === 'codex' && /auth\.json|codex login|reauthenticate/i.test(message)) {
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

function toWindow(key, label, raw) {
    return {
        key,
        label,
        used: clamp(raw.usedPercent, 0, 100),
        resetsAt: Date.parse(raw.resetsAt),
        minutes: raw.windowMinutes ?? Infinity,
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
    return window.minutes === Infinity && window.used === 0 && ms > 0 &&
        Math.abs(ms - Math.round(ms / 3600000) * 3600000) <= 2000;
}

const isSameQuota = (a, b) =>
    a.minutes === b.minutes && a.resetsAt === b.resetsAt && a.used === b.used;

// Lists the windows with known usage, shortest first. Antigravity repeats
// primary/secondary in its extra windows: each pair becomes one row with the
// extra's descriptive title and the core window's key.
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
        const window = toWindow(extra.id, extraTitle(extra), extra.window);
        const twin = core.find(w => isSameQuota(w, window));
        if (twin) {
            core.splice(core.indexOf(twin), 1);
            window.key = twin.key;
        }
        extras.push(window);
    }
    const windows = [...core, ...extras];
    // All placeholders means nothing is connected, so no usage is known.
    const updatedAt = Date.parse(usage.updatedAt);
    if (windows.every(w => isPlaceholder(w, updatedAt)))
        return [];
    // Stable, so windows of equal length keep codexbar's order.
    return windows.sort((a, b) =>
        a.minutes === b.minutes ? 0 : a.minutes - b.minutes);
}

// Picks the window the top bar shows. Windows are shortest first, so session
// means the first one; a provider without a weekly window shows its highest.
// Null when there are no windows.
export function panelWindow(windows, metric) {
    if (metric === 'session' && windows.length > 0)
        return windows[0];
    return windows.find(w => metric === 'weekly' && w.key === 'secondary') ??
        windows.reduce((a, b) => (!a || b.used > a.used ? b : a), null);
}

// The weekly (longer than a day) window that is used up, or null. With
// several, the one resetting last: it is what keeps the provider blocked.
export function exhaustedWindow(windows) {
    return windows
        .filter(w => w.minutes > SHORT_WINDOW_MINUTES && w.used >= 100)
        .reduce((a, b) => (!a || b.resetsAt > a.resetsAt ? b : a), null);
}

export function usageColor(used, baseColor) {
    if (used >= DANGER.percent)
        return DANGER.color;
    return used >= WARN.percent ? WARN.color : baseColor;
}

// Short countdown to the window's reset, or '' if unknown.
export function resetText(window, now = Date.now()) {
    const mins = Math.floor((window.resetsAt - now) / 60000);
    if (Number.isNaN(mins))
        return '';
    if (mins <= 0)
        return 'now';
    const d = Math.floor(mins / 1440), h = Math.floor(mins % 1440 / 60), m = mins % 60;
    if (d)
        return `${d}d ${h}h`;
    return h ? `${h}h ${m}m` : `${m}m`;
}

// Usage still to spend in a window before it resets and the rest is lost, or
// null when it isn't worth flagging: too much time left, too little usage
// left, or reset time unknown (a Claude session that hasn't started yet).
// A longer window caps what a shorter one can still spend: 80% of a session
// left is worth only 10% when the weekly window has 10% left.
export function spendOf(window, windows, opts, now = Date.now()) {
    const msLeft = window.resetsAt - now;
    if (Number.isNaN(msLeft) || msLeft <= 0)
        return null;
    const finalMinutes = window.minutes <= SHORT_WINDOW_MINUTES
        ? opts.sessionMinutes : opts.weeklyHours * 60;
    if (msLeft > finalMinutes * 60000)
        return null;
    const left = Math.min(...windows
        .filter(w => w.minutes >= window.minutes)
        .map(w => 100 - w.used), 100 - window.used);
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
