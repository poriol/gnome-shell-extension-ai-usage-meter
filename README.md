# AI Usage Meter

GNOME Shell extension (GNOME 50) that shows Claude, Codex and Antigravity usage limits in the top bar, using the [codexbar](https://github.com/steipete/CodexBar) CLI.

- One bar per provider, in the provider's color, plus a menu listing every rate window and its reset countdown.
- **Use it before it resets:** a green ⚡ with the percentage still left to spend appears when a window is close to resetting with usage left over, with an optional notification. Thresholds are adjustable in the settings.
- **Locked:** a red lock and the time to reset replace the bar when a weekly window is used up.

The extension never reads or stores your API keys or logins: it only runs `codexbar`, which uses the sign-ins of the apps themselves.

## Requirements

- GNOME Shell 50
- [`codexbar`](https://github.com/steipete/CodexBar) on `PATH` (or at `/home/linuxbrew/.linuxbrew/bin/codexbar`), signed in to the providers you use

## Install the latest version

```sh
wget -O /tmp/ai-usage-meter.zip https://github.com/poriol/gnome-ai-usage-meter/releases/latest/download/ai-usage-meter.zip
gnome-extensions install --force /tmp/ai-usage-meter.zip
```

Log out and back in, then:

```sh
gnome-extensions enable ai-usage@local
```

Run the same commands again to update. You can also download the zip by hand from the [Releases page](https://github.com/poriol/gnome-ai-usage-meter/releases/latest).

### From source

```sh
git clone https://github.com/poriol/gnome-ai-usage-meter ~/.local/share/gnome-shell/extensions/ai-usage@local
glib-compile-schemas ~/.local/share/gnome-shell/extensions/ai-usage@local/schemas
```

Then log out and back in and enable it as above.

## Settings

```sh
gnome-extensions prefs ai-usage@local
```

## Releasing

Push a tag and GitHub Actions builds `ai-usage-meter.zip` and publishes it as a release:

```sh
git tag v1 && git push origin v1
```

## License

[GPL-2.0-or-later](LICENSE)
