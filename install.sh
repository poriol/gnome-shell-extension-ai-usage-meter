#!/usr/bin/env bash
# Installs or updates AI Usage Meter from the latest GitHub release.
#   curl -fsSL https://raw.githubusercontent.com/poriol/gnome-shell-extension-ai-usage-meter/main/install.sh | bash
set -euo pipefail

UUID='ai-usage-meter@poriol.github.io'
ZIP_URL='https://github.com/poriol/gnome-shell-extension-ai-usage-meter/releases/latest/download/ai-usage-meter.zip'

if ! command -v gnome-extensions >/dev/null; then
    echo 'gnome-extensions not found: this needs GNOME Shell.' >&2
    exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo 'Downloading the latest release…'
curl -fsSL -o "$tmp/ai-usage-meter.zip" "$ZIP_URL"

echo 'Installing…'
gnome-extensions install --force "$tmp/ai-usage-meter.zip"

# GNOME only sees a newly installed extension after you log in again, so also
# mark it as enabled in the settings: it then starts on the next login.
gnome-extensions enable "$UUID" 2>/dev/null || {
    enabled=$(gsettings get org.gnome.shell enabled-extensions)
    if [[ "$enabled" != *"'$UUID'"* ]]; then
        if [[ "$enabled" == '@as []' || "$enabled" == '[]' ]]; then
            gsettings set org.gnome.shell enabled-extensions "['$UUID']"
        else
            gsettings set org.gnome.shell enabled-extensions "${enabled%]}, '$UUID']"
        fi
    fi
}

echo
echo '✓ AI Usage Meter is installed.'
if ! command -v codexbar >/dev/null && [[ ! -x /home/linuxbrew/.linuxbrew/bin/codexbar ]]; then
    echo '! codexbar was not found. Install it so the extension can read your usage:'
    echo '    brew install steipete/tap/codexbar'
fi
echo 'Log out and back in to start it (or restart GNOME Shell on X11 with Alt+F2, r).'
