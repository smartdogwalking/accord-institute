#!/bin/zsh
set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd -P "$(dirname "$0")"
if ! command -v node >/dev/null; then
  echo 'Install Node.js 24 LTS from https://nodejs.org, then reopen setup.'
  read '?Press Return to close.'
  exit 1
fi
node -e 'if(Number(process.versions.node.split(".")[0])<24){console.error("Node.js 24 or newer is required.");process.exit(1)}'
export NEXT_TELEMETRY_DISABLED=1
npm ci
if [[ ! -f .env.local ]]; then cp .env.example .env.local; chmod 600 .env.local; fi
npm test
npm run build
echo 'Setup complete. No local model was downloaded. Open Start Accord Institute.command.'
read '?Press Return to close.'
