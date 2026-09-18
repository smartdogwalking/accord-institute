#!/bin/zsh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd -P "$(dirname "$0")"
node "$PWD/scripts/stop.mjs"
