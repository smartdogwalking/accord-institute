#!/bin/zsh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd -P "$(dirname "$0")"
if ! command -v node >/dev/null; then
  echo 'Install Node.js 24 LTS from https://nodejs.org, then reopen this launcher.'
  read '?Press Return to close.'
  exit 1
fi
node "$PWD/scripts/launch.mjs"
