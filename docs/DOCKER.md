# Running bdg in Docker

Two Dockerfiles are provided:

- `Dockerfile` installs the published `browser-debugger-cli` package from npm
- `Dockerfile.local` installs your local build (run `npm run build` first)

Both use `node:22-alpine` with Alpine's Chromium and run as the unprivileged `node` user.

## Build and run

```bash
npm run build
docker build -f Dockerfile.local -t bdg:local .

docker run --rm bdg:local sh -c '
  bdg https://example.com --headless --json
  bdg dom eval "document.title" --json
  bdg stop
'
```

Session files live in `/home/node/.bdg` inside the container.

## How Chrome is launched in containers

bdg detects containers (`/.dockerenv`, `/run/.containerenv`, or a docker/containerd cgroup) and adds:

| Flag | Why |
|------|-----|
| `--disable-gpu` | No GPU in the container |
| `--disable-dev-shm-usage` | `/dev/shm` is only 64 MB by default |
| `--disable-software-rasterizer` | Avoid software GL fallback |

`--no-sandbox` is added only where Chrome's sandbox cannot work:

- **Docker** (`/.dockerenv`): the default seccomp profile blocks the user namespaces the sandbox needs, for root and non-root users alike. Without the flag Chrome exits on start.
- **root on Linux**: Chrome refuses to start sandboxed as root.
- **`BDG_NO_SANDBOX=1`**: explicit opt-in for other restricted environments (e.g. a Podman container where the sandbox fails).

Podman-based dev containers (toolbox, distrobox) keep the sandbox on.

No extra capabilities (`SYS_ADMIN`) or `seccomp=unconfined` are needed.

Because the sandbox is off in Docker, only point bdg at sites you trust when running it in a container.

## docker-compose example

`docker-compose.yml` runs bdg against an `httpbin` service on a private network:

```bash
docker build -f Dockerfile.local -t bdg-test:local .
docker compose up
```
