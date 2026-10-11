#!/bin/sh
set -eu

pnpm db:migrate
pnpm user:create --if-missing
exec pnpm dev:app --hostname 0.0.0.0
