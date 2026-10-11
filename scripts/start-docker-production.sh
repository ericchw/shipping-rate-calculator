#!/bin/sh
set -eu

node scripts/run-env.cjs production node scripts/runtime-migrate.cjs
node scripts/run-env.cjs production node scripts/runtime-create-user.cjs --if-missing --optional
exec node scripts/run-env.cjs production node server.js
