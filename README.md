# AI Usage Meter

GNOME Shell extension (GNOME 50) that shows Claude, Codex and Antigravity usage limits in the top bar, using the [codexbar](https://github.com/steipete/CodexBar) CLI.

- One bar per provider, in the provider's color, plus a menu listing every rate window and its reset countdown.
- **Use it before it resets:** a green ⚡ with the percentage still left to spend appears when a window is close to resetting with usage left over, with an optional notification. Thresholds are adjustable in the settings.

## Install

```sh
git clone https://github.com/poriol/gnome-ai-usage-meter ~/.local/share/gnome-shell/extensions/ai-usage@local
glib-compile-schemas ~/.local/share/gnome-shell/extensions/ai-usage@local/schemas
```

Log out and back in, then `gnome-extensions enable ai-usage@local`.

Requires `codexbar` on `PATH` (or at `/home/linuxbrew/.linuxbrew/bin/codexbar`).
