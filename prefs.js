import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {PROVIDERS} from './usage.js';

const METRICS = [
    ['session', 'Session (5-hour window)'],
    ['weekly', 'Weekly'],
    ['highest', 'Highest of all windows'],
];

const POSITIONS = [
    ['left', 'Left'],
    ['center', 'Middle'],
    ['right', 'Right'],
];

const REPO_URL = 'https://github.com/poriol/gnome-shell-extension-ai-usage-meter';

function comboRow(settings, key, title, subtitle, options, signalIds) {
    const indexOf = value => Math.max(0, options.findIndex(([id]) => id === value));
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(options.map(([, label]) => label)),
        selected: indexOf(settings.get_string(key)),
    });
    row.connect('notify::selected', () => {
        const id = options[row.selected]?.[0];
        if (id && settings.get_string(key) !== id)
            settings.set_string(key, id);
    });
    signalIds.push(settings.connect(`changed::${key}`, () => {
        const idx = indexOf(settings.get_string(key));
        if (row.selected !== idx)
            row.selected = idx;
    }));
    return row;
}

// A row that opens a web page in the browser.
function linkRow(window, title, subtitle, url) {
    const row = new Adw.ActionRow({title, subtitle, activatable: true});
    row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
    row.connect('activated', () => new Gtk.UriLauncher({uri: url}).launch(window, null, null));
    return row;
}

// Name, version and what it is, centred at the top of the About page.
function aboutHeader(metadata, dir) {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        halign: Gtk.Align.CENTER,
        margin_bottom: 12,
    });
    box.append(new Gtk.Image({
        gicon: Gio.FileIcon.new(dir.get_child('icons').get_child('logo.svg')),
        pixel_size: 96,
        margin_bottom: 6,
    }));
    box.append(new Gtk.Label({label: metadata.name, css_classes: ['title-1']}));
    box.append(new Gtk.Label({
        label: metadata['version-name'] ? `Version ${metadata['version-name']}` : 'Development version',
        css_classes: ['dim-label'],
    }));
    box.append(new Gtk.Label({
        label: 'Your Claude, Codex and Antigravity limits, always in sight in the top bar.',
        wrap: true,
        justify: Gtk.Justification.CENTER,
        margin_top: 6,
    }));
    box.append(new Gtk.Label({
        label: '🚧 Work in progress: expect rough edges and changes between releases.',
        wrap: true,
        justify: Gtk.Justification.CENTER,
        css_classes: ['dim-label', 'caption'],
    }));
    return box;
}

function spinRow(settings, key, title, subtitle, min, max) {
    const row = Adw.SpinRow.new_with_range(min, max, 1);
    row.title = title;
    row.subtitle = subtitle;
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export default class AiUsagePrefs extends ExtensionPreferences {
    // One page per tab; Adw shows a tab switcher once a window has several.
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const signalIds = [];
        window.connect('destroy', () => {
            for (const id of signalIds)
                settings.disconnect(id);
            signalIds.length = 0;
        });

        const addPage = (title, iconName) => {
            const page = new Adw.PreferencesPage({title, icon_name: iconName});
            window.add(page);
            return page;
        };
        const switchRow = (key, title, subtitle = '') => {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            return row;
        };

        const displayPage = addPage('Display', 'video-display-symbolic');
        const display = new Adw.PreferencesGroup({title: 'Top bar'});
        displayPage.add(display);
        display.add(comboRow(settings, 'panel-metric', 'Top bar shows',
            'Falls back to the highest window when a provider lacks this one', METRICS, signalIds));
        display.add(spinRow(settings, 'percent-min', 'Show percentage from (% used)',
            'Hide the top-bar number below this usage. 0 = always show', 0, 100));
        display.add(spinRow(settings, 'refresh-minutes', 'Refresh every (minutes)', '', 1, 60));

        const position = new Adw.PreferencesGroup({title: 'Position'});
        displayPage.add(position);
        position.add(comboRow(settings, 'panel-position', 'Area',
            'Which part of the top bar it sits in', POSITIONS, signalIds));
        position.add(spinRow(settings, 'panel-index', 'Place in that area',
            '0 = leftmost; higher moves it further right', 0, 20));

        const spendPage = addPage('Use it', 'starred-symbolic');
        const spend = new Adw.PreferencesGroup({
            title: 'Use it before it resets',
            description: 'Shows a green ⚡ with the usage left to spend when a window is about to reset with usage left over',
        });
        spendPage.add(spend);
        spend.add(switchRow('spend-highlight', 'Show ⚡ in the top bar and menu'));
        spend.add(switchRow('spend-notify', 'Send a notification',
            'Once per window, when it starts showing ⚡'));

        const when = new Adw.PreferencesGroup({title: 'When to show it'});
        spendPage.add(when);
        when.add(spinRow(settings, 'spend-min-left', 'Usage left at least (%)',
            'Ignore windows with less than this left', 1, 100));
        when.add(spinRow(settings, 'spend-session-minutes', 'Session: final minutes',
            'Start showing ⚡ this long before a session resets', 5, 300));
        when.add(spinRow(settings, 'spend-weekly-hours', 'Weekly: final hours',
            'Start showing ⚡ this long before a weekly window resets', 1, 168));

        const syncSpendSensitive = () => {
            when.sensitive = settings.get_boolean('spend-highlight') || settings.get_boolean('spend-notify');
        };
        syncSpendSensitive();
        signalIds.push(settings.connect('changed::spend-highlight', syncSpendSensitive));
        signalIds.push(settings.connect('changed::spend-notify', syncSpendSensitive));

        const providers = new Adw.PreferencesGroup({
            title: 'Providers',
            description: 'Choose which services appear in the top bar',
        });
        addPage('Providers', 'view-grid-symbolic').add(providers);
        for (const {id, name} of PROVIDERS)
            providers.add(switchRow(`show-${id}`, name));

        const aboutPage = addPage('About', 'help-about-symbolic');
        const header = new Adw.PreferencesGroup();
        header.add(aboutHeader(this.metadata, this.dir));
        aboutPage.add(header);

        const links = new Adw.PreferencesGroup();
        aboutPage.add(links);
        links.add(linkRow(window, 'Source code', 'GitHub', REPO_URL));
        links.add(linkRow(window, 'Report an issue', 'Bugs, missing providers and ideas are welcome', `${REPO_URL}/issues`));
        links.add(linkRow(window, 'codexbar', 'The tool this extension reads your usage from',
            'https://github.com/steipete/CodexBar'));

        const credits = new Adw.PreferencesGroup();
        aboutPage.add(credits);
        credits.add(linkRow(window, 'Made by poriol', 'Built because nothing else did it the way I wanted',
            'https://github.com/poriol'));
        credits.add(linkRow(window, 'License', 'GPL-2.0-or-later', `${REPO_URL}/blob/main/LICENSE`));
    }
}
