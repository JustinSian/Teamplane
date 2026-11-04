# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY bin ./bin
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    TEAMPLANE_KEYS_DIR=/data/keys
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/bin ./bin
COPY web ./web
COPY LICENSE ./LICENSE
RUN apk add --no-cache git \
    && mkdir -p /data/keys /workspace/repo \
    && chown -R node:node /data /workspace
USER node
WORKDIR /workspace/repo
EXPOSE 7317
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7317/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "/app/bin/teamplane.js"]
CMD ["serve"]
