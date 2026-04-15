FROM golang:1.24-alpine AS build
WORKDIR /app
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot AS run
COPY --from=build /app/server /server
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/server"]
