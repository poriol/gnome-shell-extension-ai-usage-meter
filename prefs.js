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

function metricRow(settings) {
    const row = new Adw.ComboRow({
        title: 'Top bar shows',
        subtitle: 'Falls back to the highest window when a provider lacks this one',
        model: Gtk.StringList.new(METRICS.map(([, label]) => label)),
        selected: Math.max(0, METRICS.findIndex(([id]) => id === settings.get_string('panel-metric'))),
    });
    row.connect('notify::selected', () => settings.set_string('panel-metric', METRICS[row.selected][0]));
    return row;
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

        const display = new Adw.PreferencesGroup({title: 'Top bar'});
        addPage('Display', 'video-display-symbolic').add(display);
        display.add(metricRow(settings));
        display.add(spinRow(settings, 'percent-min', 'Show percentage from (% used)',
            'Hide the top-bar number below this usage. 0 = always show', 0, 100));
        display.add(spinRow(settings, 'refresh-minutes', 'Refresh every (minutes)', '', 1, 60));

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

        const providers = new Adw.PreferencesGroup({
            title: 'Providers',
            description: 'Choose which services appear in the top bar',
        });
        addPage('Providers', 'view-grid-symbolic').add(providers);
        for (const {id, name} of PROVIDERS)
            providers.add(switchRow(`show-${id}`, name));
    }
}
