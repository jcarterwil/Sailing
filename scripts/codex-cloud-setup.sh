#!/usr/bin/env bash
set -euo pipefail

npm ci --prefer-offline --no-audit
npm run typecheck
