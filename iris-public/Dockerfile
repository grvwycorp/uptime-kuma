FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV NUXT_TELEMETRY_DISABLED=1
# nuxt build hangs after completion due to open handles (socket.io, timers).
# timeout kills the process, then we verify the output was actually produced.
RUN timeout -s KILL 120 npm run build; \
    if [ -f .output/server/index.mjs ]; then \
      echo "Build verified OK"; \
    else \
      echo "Build failed — output not produced"; exit 1; \
    fi

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/.output .output

ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
