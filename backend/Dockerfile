# Build on the host's native platform and use Go's built-in cross-compilation
# (GOOS/GOARCH env vars) to produce a linux/amd64 static binary. This avoids
# a known Go 1.25 segfault when the compiler itself runs under QEMU emulation
# on arm64 hosts targeting amd64.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -o server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot AS run
COPY --from=build /app/server /server
COPY --from=build /app/migrations /migrations
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/server"]
