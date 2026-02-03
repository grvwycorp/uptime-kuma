# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /build

# Install git for go mod download (some deps may need it)
RUN apk add --no-cache git

# Download dependencies first (cache layer)
COPY go.mod go.sum ./
RUN go mod download

# Copy source and build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o iris-sync ./cmd/iris-sync

# Runtime stage
FROM alpine:3.19

# Install ca-certificates for HTTPS and tzdata for timezone support
RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/iris-sync .

# Create data directory for ID mappings persistence
RUN mkdir -p /app/data/mappings

# Volume for persistent data (ID mappings)
VOLUME ["/app/data"]

# Default entrypoint
ENTRYPOINT ["./iris-sync"]

# Default command (can be overridden)
CMD ["--config", "/app/config.yaml"]
