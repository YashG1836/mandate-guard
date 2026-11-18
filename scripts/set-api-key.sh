#!/bin/sh
# Saves an Anthropic API key to mandate-guard/.env (git-ignored) for the real-model benchmark.
# The key is not shown while you type or paste it, and it is not stored in your shell history.
cd "$(dirname "$0")/.." || exit 1
printf 'Paste your Anthropic API key, then press Enter (it will not be shown): '
stty -echo 2>/dev/null
IFS= read -r key
stty echo 2>/dev/null
printf '\n'
if [ -z "$key" ]; then
  echo "No key entered. Nothing was saved."
  exit 1
fi
printf 'ANTHROPIC_API_KEY=%s\n' "$key" > .env
chmod 600 .env
key=''
echo "Saved to mandate-guard/.env (git-ignored). You can now run: npm run bench:claude"
