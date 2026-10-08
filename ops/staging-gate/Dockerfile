FROM golang:1.26-alpine AS build
RUN apk add --no-cache gcc musl-dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN go test -race ./... && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /gate .
FROM scratch
COPY --from=build /gate /gate
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/gate"]
