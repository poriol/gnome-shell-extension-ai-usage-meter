# AI Usage Meter — GNOME Shell Extension

**Your Claude, Codex and Antigravity limits, always in sight in the GNOME top bar.**

> 🚧 **Work in progress.** It works well on my machine every day, but it is young: expect rough edges, missing providers and changes between releases. Feedback, issues and pull requests are very welcome.

<p align="center">
  <img src="docs/screenshot.png" alt="The AI Usage Meter in the GNOME top bar, with its menu open showing Claude, Codex and Antigravity rate windows, usage percentages and reset countdowns" width="640">
</p>

## Why

I use several AI coding assistants every day, and each one has its own rate limits: a session window that resets every few hours, a weekly cap, sometimes a separate one per model. I kept getting cut off in the middle of work, or noticing too late that a window was about to reset with a big part of it still unused.

I looked for a GNOME extension that showed all of this at a glance and couldn't find one I liked, so I built it.

## What it does

- **One small bar per provider** in the top bar, in the provider's color, so you can see how much you've used without opening anything. The percentage appears once you pass a threshold, turning yellow, then red, as you get close to the limit.
- **A menu with every rate window** (session, weekly, per model) and the countdown to its reset.
- **Use it before it resets:** a green ⚡ with the percentage still left appears when a window is about to reset with usage left over, with an optional notification. No more wasted quota.
- **Locked:** a red lock and the time to reset replace the bar when a weekly window is used up.
- **Honest when it doesn't know:** a sleeping moon instead of a misleading empty bar when a provider can't be read (for example when the Antigravity app is closed).
- **Configurable:** pick the providers, which window the bar follows, the refresh interval and the ⚡ thresholds.

The extension never reads or stores your API keys or logins: it only runs [`codexbar`](https://github.com/steipete/CodexBar), which uses the sign-ins of the apps themselves.

## Requirements

- GNOME Shell 50
- [`codexbar`](https://github.com/steipete/CodexBar) on `PATH` (or at `/home/linuxbrew/.linuxbrew/bin/codexbar`), signed in to the providers you use

## Install the latest version

```sh
wget -O /tmp/ai-usage-meter.zip https://github.com/poriol/gnome-shell-extension-ai-usage-meter/releases/latest/download/ai-usage-meter.zip
gnome-extensions install --force /tmp/ai-usage-meter.zip
```

Log out and back in, then:

```sh
gnome-extensions enable ai-usage@local
```

Run the same commands again to update. You can also download the zip by hand from the [Releases page](https://github.com/poriol/gnome-shell-extension-ai-usage-meter/releases/latest).

### From source

```sh
git clone https://github.com/poriol/gnome-shell-extension-ai-usage-meter ~/.local/share/gnome-shell/extensions/ai-usage@local
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

## Contributing

This is a personal project in progress. If something breaks, a provider is missing or you have an idea, open an issue or a pull request.

## License

[GPL-2.0-or-later](LICENSE)
