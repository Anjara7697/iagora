# Image de production de la console (Next.js, serveur autonome).
# NEXT_PUBLIC_* sont figés à la construction : une image par environnement.
#   docker build --build-arg NEXT_PUBLIC_API_URL=https://dev.iagora.neosolve.info/api/v1 \
#                --build-arg NEXT_PUBLIC_ENABLE_SIMULATOR=true ./frontend
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ENABLE_SIMULATOR=false
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_ENABLE_SIMULATOR=$NEXT_PUBLIC_ENABLE_SIMULATOR \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/login || exit 1
CMD ["node", "server.js"]
