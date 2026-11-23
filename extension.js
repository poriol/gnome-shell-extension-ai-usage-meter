import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    DANGER_COLOR, MUTED_COLOR, PROVIDERS, SPEND_COLOR, bestSpend, exhaustedWindow, fixFor,
    panelWindow, parseReport, resetText, spendOf, usageColor, windowsOf,
} from './usage.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');
Gio._promisify(Gio.Subprocess.prototype, 'wait_async');

// Signed out, codexbar waits a minute for agy before it says so; it allows 90 s.
const FETCH_TIMEOUT_S = 100;
const MENU_OPEN_REFRESH_S = 60;
const FALLBACK_CODEXBAR = '/home/linuxbrew/.linuxbrew/bin/codexbar';
const UNKNOWN_ICON_OPACITY = 130;

// A progress bar whose fill is a fraction of the width it actually receives,
// so it stays correct however wide the bar gets.
const UsageBar = GObject.registerClass(
class UsageBar extends St.Widget {
    _init(params) {
        super._init(params);
        this._fraction = 0;
        this._fill = new St.Widget({style_class: 'aiu-bar-fill'});
        this.add_child(this._fill);
    }

    update(percent, color) {
        this._fraction = percent / 100;
        this._fill.visible = percent > 0;
        this._fill.set_style(`background-color: ${color};`);
        this.queue_relayout();
    }

    vfunc_allocate(box) {
        this.set_allocation(box);
        const width = Math.round(box.get_width() * this._fraction);
        this._fill.allocate(Clutter.ActorBox.new(0, 0, width, box.get_height()));
    }
});

function providerIcon(dir, provider, params) {
    return new St.Icon({
        gicon: Gio.FileIcon.new(dir.get_child('icons').get_child(`${provider.id}-symbolic.svg`)),
        style: `color: ${provider.color};`,
        y_align: Clutter.ActorAlign.CENTER,
        ...params,
    });
}

function spendIcon(dir, params) {
    return new St.Icon({
        gicon: Gio.FileIcon.new(dir.get_child('icons').get_child('spend-symbolic.svg')),
        style: `color: ${SPEND_COLOR};`,
        y_align: Clutter.ActorAlign.CENTER,
        ...params,
    });
}

const durationText = ms => resetText({resetsAt: ms}, 0);

function staticItem(styleClass) {
    const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    item.add_style_class_name(styleClass);
    return item;
}

function noteItem(text, styleClass = '') {
    const item = staticItem('aiu-note-item');
    const label = new St.Label({text, style_class: `aiu-note ${styleClass}`, x_expand: true});
    // Wrap long messages, such as errors, instead of cutting them off.
    label.clutter_text.line_wrap = true;
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    item.add_child(label);
    return item;
}

// A clickable menu row with an icon, for actions such as fixing an error.
function actionItem(iconName, text, onActivate) {
    const item = new PopupMenu.PopupMenuItem(text, {style_class: 'aiu-action-item'});
    item.insert_child_at_index(new St.Icon({icon_name: iconName, icon_size: 14}), 1);
    item.connect('activate', onActivate);
    return item;
}

const hasProgram = name => GLib.find_program_in_path(name) !== null;

// Runs a shell command in a new terminal window, keeping it open afterwards
// so its result can be read. Resolves when the terminal process exits.
async function runInTerminal(command) {
    const script = `${command}; printf '\\nPress Enter to close this window.'; read _`;
    const terminal = hasProgram('xdg-terminal-exec')
        ? ['xdg-terminal-exec'] : hasProgram('ptyxis') ? ['ptyxis', '--'] : ['gnome-terminal', '--'];
    const proc = Gio.Subprocess.new([...terminal, 'sh', '-c', script], Gio.SubprocessFlags.NONE);
    await proc.wait_async(null);
}

function headerItem(dir, provider, state) {
    const item = staticItem('aiu-header');
    item.add_child(providerIcon(dir, provider, {icon_size: 14}));
    item.add_child(new St.Label({
        text: provider.name,
        style_class: 'aiu-header-name',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    if (state?.data && state.error) {
        item.add_child(new St.Label({
            text: `⚠ ${state.updatedAt.format('%H:%M')}`,
            style_class: 'aiu-bad',
            y_align: Clutter.ActorAlign.CENTER,
        }));
    }
    return item;
}

// One rate window on a single line: label, bar, percent, time until reset.
function windowItem(provider, window) {
    const color = usageColor(window.used, provider.color);
    const item = staticItem('aiu-row');
    const label = (text, styleClass, style = '') => new St.Label({
        text,
        style,
        style_class: styleClass,
        y_align: Clutter.ActorAlign.CENTER,
    });

    item.add_child(label(window.label, 'aiu-row-label'));
    const bar = new UsageBar({
        style_class: 'aiu-bar aiu-bar-menu',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    bar.update(window.used, provider.color);
    item.add_child(bar);
    item.add_child(label(`${Math.round(window.used)}%`, 'aiu-row-percent', `color: ${color};`));
    item.add_child(label(resetText(window), 'aiu-row-reset'));
    return item;
}

// Below a window row: how much is left to spend before it resets.
function spendItem(dir, spend) {
    const item = staticItem('aiu-spend-item');
    item.add_child(spendIcon(dir, {icon_size: 12}));
    item.add_child(new St.Label({
        text: `${Math.round(spend.left)}% left to spend · resets in ${durationText(spend.msLeft)}`,
        style_class: 'aiu-spend',
        style: `color: ${SPEND_COLOR};`,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    return item;
}

function footerButton(iconName, accessibleName, onClicked) {
    const button = new St.Button({
        style_class: 'aiu-footer-button',
        accessible_name: accessibleName,
        can_focus: true,
        child: new St.Icon({icon_name: iconName, icon_size: 14}),
    });
    button.connect('clicked', onClicked);
    return button;
}

// A provider's icon, bar and (when high enough) percentage in the top bar.
class PanelItem {
    constructor(dir, provider) {
        this.provider = provider;
        this.actor = new St.BoxLayout({style_class: 'aiu-provider'});
        this._bar = new UsageBar({
            style_class: 'aiu-bar aiu-bar-panel',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({
            style_class: 'aiu-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Stands in for the bar when usage is unknown: an empty bar would read as 0% used.
        // A sleeping moon: no source could report usage.
        this._unknown = new St.Icon({
            gicon: Gio.FileIcon.new(dir.get_child('icons').get_child('closed-symbolic.svg')),
            style_class: 'aiu-unknown',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        // A used-up weekly window blocks the provider whatever the session says.
        this._locked = new St.Icon({
            gicon: Gio.FileIcon.new(dir.get_child('icons').get_child('locked-symbolic.svg')),
            style_class: 'aiu-locked',
            style: `color: ${DANGER_COLOR};`,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._icon = providerIcon(dir, provider, {style_class: 'aiu-icon'});
        // Usage left to spend before a reset: a green bolt and the percentage.
        this._spend = new St.BoxLayout({style_class: 'aiu-spend-box', visible: false});
        this._spend.add_child(spendIcon(dir, {style_class: 'aiu-spend-icon'}));
        this._spendLabel = new St.Label({
            style_class: 'aiu-label',
            style: `color: ${SPEND_COLOR};`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._spend.add_child(this._spendLabel);
        this.actor.add_child(this._icon);
        this.actor.add_child(this._bar);
        this.actor.add_child(this._unknown);
        this.actor.add_child(this._locked);
        this.actor.add_child(this._label);
        this.actor.add_child(this._spend);
    }

    update(state, metric, percentMin, spendOpts) {
        const windows = state?.data ? windowsOf(state.data) : [];
        const best = spendOpts ? bestSpend(windows, spendOpts) : null;
        this._spend.visible = Boolean(best);
        if (best)
            this._spendLabel.text = `${Math.round(best.spend.left)}%`;
        const exhausted = exhaustedWindow(windows);
        this._locked.visible = Boolean(exhausted);
        const window = exhausted ?? (state?.data ? panelWindow(windows, metric) : null);
        const failed = !window && state?.error && !this.provider.dropStaleData;
        const unknown = Boolean(state) && !window && !failed;
        this._bar.visible = Boolean(window);
        this._unknown.visible = unknown;
        this._icon.opacity = unknown ? UNKNOWN_ICON_OPACITY : 255;
        if (exhausted) {
            this._bar.update(100, DANGER_COLOR);
            // Blocked until the weekly reset: show when, as its biggest unit ("2d").
            this._setLabel(resetText(exhausted).split(' ')[0], DANGER_COLOR);
        } else if (window) {
            const color = usageColor(window.used, this.provider.color);
            this._bar.update(window.used, this.provider.color);
            // The bolt's figure says enough; a second percentage would confuse.
            const showUsed = window.used >= percentMin && !best;
            this._setLabel(showUsed ? `${Math.round(window.used)}%` : '', color);
        } else {
            this._setLabel(failed ? '!' : state ? '' : '…', MUTED_COLOR);
        }
    }

    _setLabel(text, color) {
        this._label.text = text;
        this._label.visible = text !== '';
        this._label.set_style(`color: ${color};`);
    }

    destroy() {
        // Destroying this.actor would take its children with it; destroy them
        // by name anyway so each object's cleanup is explicit.
        this._spendLabel.destroy();
        this._spendLabel = null;
        this._spend.destroy();
        this._spend = null;
        this._icon.destroy();
        this._icon = null;
        this._locked.destroy();
        this._locked = null;
        this._unknown.destroy();
        this._unknown = null;
        this._label.destroy();
        this._label = null;
        this._bar.destroy();
        this._bar = null;
        this.actor.destroy();
        this.actor = null;
    }
}

const UsageIndicator = GObject.registerClass(
class UsageIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'AI Usage Meter');
        this._ext = ext;
        this._settings = ext.getSettings();
        this._states = {};
        this._inFlight = new Set();
        this._lastRefresh = 0;
        this._notified = new Set();
        this._cancellable = new Gio.Cancellable();

        const box = new St.BoxLayout({style_class: 'aiu-box'});
        this.add_child(box);
        this._panelItems = PROVIDERS.map(provider => {
            const panelItem = new PanelItem(ext.dir, provider);
            box.add_child(panelItem.actor);
            return panelItem;
        });

        this._settings.connectObject('changed', (_settings, key) => {
            if (key === 'refresh-minutes')
                this._schedule();
            if (key.startsWith('show-'))
                this._refresh();
            this._render();
        }, this);
        this.menu.connectObject('open-state-changed', (_menu, open) => {
            const age = GLib.get_monotonic_time() - this._lastRefresh;
            if (open && age > MENU_OPEN_REFRESH_S * GLib.USEC_PER_SEC)
                this._refresh();
        }, this);

        this._render();
        this._refresh();
        this._schedule();
    }

    _enabledProviders() {
        return PROVIDERS.filter(p => this._settings.get_boolean(`show-${p.id}`));
    }

    _schedule() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            this._settings.get_int('refresh-minutes') * 60, () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            });
    }

    async _fetch(provider) {
        const binary = GLib.find_program_in_path('codexbar') ?? FALLBACK_CODEXBAR;
        const proc = Gio.Subprocess.new(
            [binary, 'usage', '--provider', provider.id, '--format', 'json', '--no-color'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);

        let timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, FETCH_TIMEOUT_S, () => {
            timeoutId = 0;
            proc.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        try {
            const [stdout] = await proc.communicate_utf8_async(null, this._cancellable);
            return parseReport(stdout);
        } finally {
            if (timeoutId)
                GLib.source_remove(timeoutId);
            proc.force_exit();
        }
    }

    async _refreshProvider(provider) {
        if (this._inFlight.has(provider.id))
            return;
        this._inFlight.add(provider.id);
        try {
            const data = await this._fetch(provider);
            this._states[provider.id] = {data, updatedAt: GLib.DateTime.new_now_local()};
        } catch (e) {
            // Keep showing the last good data, if it stays meaningful, and flag the error.
            const previous = provider.dropStaleData ? {} : this._states[provider.id];
            this._states[provider.id] = {...previous, error: e.message};
        }
        this._inFlight.delete(provider.id);
        if (!this._cancellable.is_cancelled())
            this._render();
    }

    _refresh() {
        this._lastRefresh = GLib.get_monotonic_time();
        this._enabledProviders().forEach(p => this._refreshProvider(p));
    }

    _spendOpts() {
        return {
            minLeft: this._settings.get_int('spend-min-left'),
            sessionMinutes: this._settings.get_int('spend-session-minutes'),
            weeklyHours: this._settings.get_int('spend-weekly-hours'),
        };
    }

    _render() {
        const metric = this._settings.get_string('panel-metric');
        const percentMin = this._settings.get_int('percent-min');
        const spendOpts = this._settings.get_boolean('spend-highlight') ? this._spendOpts() : null;
        const enabled = this._enabledProviders();
        for (const item of this._panelItems) {
            item.actor.visible = enabled.includes(item.provider);
            item.update(this._states[item.provider.id], metric, percentMin, spendOpts);
        }
        this._buildMenu(enabled, spendOpts);
        this._notifySpend(enabled);
    }

    // One notification per provider window and reset, so it never repeats.
    _notifySpend(providers) {
        if (!this._settings.get_boolean('spend-notify'))
            return;
        const opts = this._spendOpts();
        for (const provider of providers) {
            const data = this._states[provider.id]?.data;
            const best = data ? bestSpend(windowsOf(data), opts) : null;
            if (!best)
                continue;
            const id = `${provider.id}:${best.window.key}:${best.window.resetsAt}`;
            if (this._notified.has(id))
                continue;
            this._notified.add(id);
            this._notify(`⚡ ${provider.name}: ${Math.round(best.spend.left)}% left to spend`,
                `${best.window.label} resets in ${durationText(best.spend.msLeft)}. Use it before it's gone!`);
        }
    }

    _notify(title, body) {
        try {
            if (!this._source) {
                this._source = new MessageTray.Source({
                    title: 'AI Usage Meter',
                    iconName: 'starred-symbolic',
                });
                this._source.connectObject('destroy', () => {
                    this._source = null;
                }, this);
                Main.messageTray.add(this._source);
            }
            this._source.addNotification(new MessageTray.Notification({
                source: this._source, title, body,
            }));
        } catch (e) {
            console.warn(`AI Usage Meter: notification failed: ${e.message}`);
        }
    }

    _buildMenu(providers, spendOpts) {
        this.menu.removeAll();
        providers.forEach(provider => this._addProviderSection(provider, spendOpts));
        this.menu.addMenuItem(this._footerItem());
    }

    _footerItem() {
        const item = staticItem('aiu-footer');
        item.add_child(new St.Widget({x_expand: true}));
        item.add_child(footerButton('view-refresh-symbolic', 'Refresh now', () => this._refresh()));
        item.add_child(footerButton('emblem-system-symbolic', 'Settings', () => {
            this.menu.close();
            this._ext.openPreferences();
        }));
        return item;
    }

    // The full error, what it means and a fix when one is known, and a way to
    // copy the error for a bug report.
    _addErrorItems(provider, error) {
        const fix = fixFor(provider.id, error, hasProgram);
        if (fix)
            this.menu.addMenuItem(noteItem(fix.hint, 'aiu-bad'));
        this.menu.addMenuItem(noteItem(`Error: ${error}`, fix ? '' : 'aiu-bad'));
        if (fix?.command) {
            this.menu.addMenuItem(actionItem('dialog-password-symbolic', fix.label, async () => {
                try {
                    await runInTerminal(fix.command);
                } catch (e) {
                    Main.notifyError(`AI Usage Meter: couldn't open a terminal`,
                        `Run this yourself: ${fix.command}\n${e.message}`);
                }
                if (!this._cancellable.is_cancelled())
                    this._refreshProvider(provider);
            }));
        }
        if (fix?.url) {
            this.menu.addMenuItem(actionItem('web-browser-symbolic', fix.urlLabel, () => {
                try {
                    Gio.AppInfo.launch_default_for_uri(fix.url, null);
                } catch (e) {
                    Main.notifyError(`AI Usage Meter: couldn't open the browser`,
                        `${fix.url}\n${e.message}`);
                }
            }));
        }
        this.menu.addMenuItem(actionItem('edit-copy-symbolic', 'Copy error', () => {
            const text = fix ? `${error}\nFix: ${fix.command ?? fix.url}` : error;
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        }));
    }

    _addProviderSection(provider, spendOpts) {
        const state = this._states[provider.id];
        this.menu.addMenuItem(headerItem(this._ext.dir, provider, state));

        if (!state) {
            this.menu.addMenuItem(noteItem('Loading…'));
            return;
        }
        if (state.error)
            this._addErrorItems(provider, state.error);
        if (!state.data)
            return;

        const windows = windowsOf(state.data);
        for (const window of windows) {
            this.menu.addMenuItem(windowItem(provider, window));
            const spend = spendOpts ? spendOf(window, windows, spendOpts) : null;
            if (spend)
                this.menu.addMenuItem(spendItem(this._ext.dir, spend));
        }
        if (windows.length === 0)
            this.menu.addMenuItem(noteItem(provider.emptyHint ?? 'No limits reported'));
    }

    destroy() {
        this._cancellable.cancel();
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        this._source?.disconnectObject(this);
        this._source?.destroy();
        this._source = null;
        this._settings.disconnectObject(this);
        this.menu.disconnectObject(this);
        this._panelItems.forEach(item => item.destroy());
        this._panelItems = null;
        super.destroy();
    }
});

export default class AiUsageExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new UsageIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
        this._placeIndicator();
        this._settings.connectObject(
            'changed::panel-position', () => this._placeIndicator(),
            'changed::panel-index', () => this._placeIndicator(),
            this);
    }

    // Moves the indicator to the top bar area and place the settings ask for,
    // without recreating it (which would fetch all usage again).
    _placeIndicator() {
        const boxes = {left: Main.panel._leftBox, center: Main.panel._centerBox, right: Main.panel._rightBox};
        const box = boxes[this._settings.get_string('panel-position')] ?? Main.panel._rightBox;
        const container = this._indicator.container;
        container.get_parent()?.remove_child(container);
        box.insert_child_at_index(container, this._boxIndex(box, this._settings.get_int('panel-index')));
    }

    // The panel boxes hold hidden indicators too (screen recording, screen
    // sharing, accessibility…), so a raw child index would land in the same
    // visible spot for several values. Count only the visible items instead.
    _boxIndex(box, wanted) {
        const children = box.get_children();
        const visible = children.filter(c => c.visible && (c.child?.visible ?? true));
        return wanted < visible.length ? children.indexOf(visible[wanted]) : children.length;
    }

    disable() {
        this._settings?.disconnectObject(this);
        this._settings = null;
        this._indicator?.destroy();
        this._indicator = null;
    }
}
