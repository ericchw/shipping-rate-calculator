FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
WORKDIR /app
FROM base AS dependencies
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
FROM dependencies AS development
COPY . .
CMD ["sh","scripts/start-docker-dev.sh"]
FROM dependencies AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build
FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN groupadd --gid 1001 shipping && useradd --uid 1001 --gid shipping shipping && mkdir /app/data && chown shipping:shipping /app/data
COPY --from=build --chown=shipping:shipping /app/.next/standalone ./
COPY --from=build --chown=shipping:shipping /app/.next/static ./.next/static
COPY --from=build --chown=shipping:shipping /app/migrations ./migrations
COPY --from=build --chown=shipping:shipping /app/scripts/runtime-migrate.cjs ./scripts/runtime-migrate.cjs
COPY --from=build --chown=shipping:shipping /app/scripts/run-env.cjs ./scripts/run-env.cjs
COPY --from=build --chown=shipping:shipping /app/scripts/runtime-create-user.cjs ./scripts/runtime-create-user.cjs
COPY --from=build --chown=shipping:shipping /app/scripts/start-docker-production.sh ./scripts/start-docker-production.sh
USER shipping
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["sh","scripts/start-docker-production.sh"]
