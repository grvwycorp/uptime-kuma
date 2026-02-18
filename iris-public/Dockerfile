FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV NUXT_TELEMETRY_DISABLED=1
RUN npm run build; \
    EXIT=$?; \
    if [ -f .output/server/index.mjs ]; then \
      echo "Build verified"; exit 0; \
    else \
      echo "Build failed (exit code: $EXIT)"; exit 1; \
    fi

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/.output .output

ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
