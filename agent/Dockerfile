# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS build
WORKDIR /app
ARG VERSION=dev
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w -X main.version=${VERSION}" -o mastermind-agent ./...

# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM alpine:3.19
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /app/mastermind-agent .
# Config and key storage mounted from host at runtime.
# Mount config to /etc/mastermind-agent/config.yaml
# Mount key storage to /var/lib/mastermind-agent/
VOLUME ["/etc/mastermind-agent", "/var/lib/mastermind-agent"]
CMD ["./mastermind-agent", "-config", "/etc/mastermind-agent/config.yaml"]
