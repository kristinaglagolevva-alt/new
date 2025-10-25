#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${VITE_BACKEND_HOST:-}" ]]; then
  export VITE_BACKEND_URL="https://${VITE_BACKEND_HOST}"
fi

npm install
npm run build
