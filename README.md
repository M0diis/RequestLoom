# RequestLoom

A self-hosted API testing and development tool. Build and organize HTTP/SOAP requests, manage environments and variables, run collections, spin up mock servers, and generate client code - all from a clean web UI backed by a lightweight .NET API.

RequestLoom runs three ways:

- **Web app** - React SPA served by the ASP.NET Core backend (also containerized with Docker)
- **Desktop app** - Electron wrapper that bundles the backend and frontend into a native Windows application
- **Dev mode** - Vite dev server with hot reload talking to the backend on a separate port

---

## Features

- Multipart uploads - multipart/form-data fields with server-backed file uploads
- Cookie/session jar - workspace-scoped cookies persisted across requests and backend restarts
- **Request builder** - HTTP methods, headers, query params, JSON/raw/form bodies, and response inspection
- **Collections** - organize requests and run them sequentially with the collection runner
- **Environments & variables** - scoped variables with `{{variable}}` interpolation, resolved at execution time
- **OAuth2 / OIDC** - PKCE authorization-code login, OIDC discovery, in-memory token caching, and automatic refresh
- **Workspaces** - separate workspaces with their own variables and data
- **Mock servers** - define routes and canned responses served from `/mock/*`
- **Scripting** - pre-request and test scripts written in JavaScript (Jint engine)
- **Import / export** - OpenAPI/Swagger, Postman collections, and full workspace export/import
- **Code generation** - generate client snippets in Go, C#, Java, PHP, and Ruby
- **History** - execution history for requests (with global clear, or disable recording entirely)
- **Settings** - storage backend, request timeout, TLS verification, response size limit, history toggle, response format
- **Services** - group related requests and share service-level variables

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, Monaco Editor, Zustand, React Router, Axios |
| Backend | .NET 10 (ASP.NET Core), SQLite + JSON storage via Entity Framework Core 10, Jint, YamlDotNet, OpenAPI Readers |
| Desktop | Electron 31, electron-packager |
| Linting | oxlint (frontend) |

## Project structure

```
.
├── backend/                  # ASP.NET Core Web API (net10.0)
│   ├── Controllers/          # REST endpoints
│   ├── Data/                 # EF Core DbContext, entities, migrations + repositories
│   ├── Middleware/           # Mock server middleware
│   ├── Models/               # Domain models
│   ├── Services/             # Execution, collection runner, import/export, tools
│   └── wwwroot/              # Built frontend (generated, gitignored)
├── frontend/                 # React SPA (Vite)
│   └── src/
│       ├── components/       # UI components
│       ├── layouts/          # App shell layouts
│       ├── services/         # API client
│       ├── stores/           # Zustand state
│       └── types/            # Shared TypeScript types
├── desktop/                  # Electron desktop wrapper
│   ├── main.js               # Main process (spawns backend, hosts UI)
│   ├── preload.js
│   └── scripts/package-win.js
├── scripts/                  # Dev / build / package scripts
├── Dockerfile                # Multi-stage container build
└── docker-compose.yml        # One-command Docker deployment
```

## Prerequisites

- **.NET SDK 10** - <https://dotnet.microsoft.com/download>
- **Node.js 22+** and npm - <https://nodejs.org>
- **Docker** (optional, for container deployment) - <https://www.docker.com>

## Quick start (development)

The dev launcher starts the backend (port `5056`) and the Vite dev server (port `5173`) together, and kills conflicting port holders automatically.

**Windows (PowerShell):**

```powershell
.\scripts\dev.ps1 start
```

**macOS / Linux:**

```bash
./scripts/dev.sh start
```

Then open <http://localhost:5173>.

| Command | Description |
| --- | --- |
| `start` | Start backend and frontend |
| `stop` | Stop both services |
| `restart` | Stop, then start both |
| `status` | Show PID/port status |

### Electron debug in VS Code

Open the repository in VS Code, select **Electron: Debug** in the Run and Debug panel, and press **F5**. The pre-launch task builds the frontend, publishes a Debug backend, stages it for Electron, and launches `desktop/main.js` with the Node inspector. Electron DevTools open automatically; set breakpoints in `desktop/main.js` and `desktop/preload.js`.

The debug build uses the framework-dependent .NET backend, so the .NET SDK/runtime must be installed locally. Generated files are kept in ignored `backend/wwwroot`, `.publish-debug-backend`, and `desktop/runtime/backend` directories.

The Vite dev server proxies `/api` and `/mock` to the backend, so no CORS issues in development.

## Docker deployment

### Quick start (docker compose)

```bash
docker compose up -d
```

Open <http://localhost:8080>. Data is persisted in the `requestloom-data` named volume.

### Manual build

```bash
./scripts/docker-build.sh
# or
docker build -t requestloom .
docker run -d -p 8080:8080 -v requestloom-data:/data --name requestloom requestloom
```

The image is multi-stage: the frontend is built with Node, the backend is published with the .NET SDK, and the runtime image is based on `aspnet:10.0`. The backend listens on port `8080` and stores its SQLite database at `/data/RequestLoom.db`.

## Building

### Web app (single deployable)

Builds the frontend, copies it into `backend/wwwroot`, and publishes the backend to `dist/`:

```bash
./scripts/package.sh
```

Run the result:

```bash
dotnet dist/RequestLoom.Api.dll
```

### Windows desktop app

Packages the frontend, backend, and Electron shell into a native Windows app with `.bat` launchers:

```powershell
.\scripts\package-windows-desktop.ps1
```

```bash
./scripts/package-windows-desktop.sh
```

Useful options (PowerShell):

```powershell
.\scripts\package-windows-desktop.ps1 -Runtime win-arm64   # other RID
.\scripts\package-windows-desktop.ps1 -SingleFile          # single-file backend exe
```

## Configuration

The backend reads configuration from `appsettings.json` and environment variables (which take precedence).

| Variable | Default | Description |
| --- | --- | --- |
| `Database__Path` | `RequestLoom.db` | SQLite database file path |
| `Storage__Mode` / `STORAGE_MODE` | `sqlite` | Storage mode: `sqlite` (database file) or `json` (JSON file) |
| `Storage__JsonPath` | `requestloom-data.json` | JSON storage file path |
| `Settings__RequestTimeoutMs` | `120000` | Default request timeout in ms (`0` = no timeout) |
| `Settings__IgnoreSslErrors` | `false` | Ignore TLS/SSL certificate errors globally |
| `Settings__MaxResponseBodySizeMb` | `0` | Response body size limit in MB (`0` = unlimited) |
| `Settings__SaveHistory` | `true` | Record executed requests in history |
| `Settings__ResponseFormat` | `pretty` | Default response view: `pretty` or `raw` |
| `ASPNETCORE_URLS` | `http://localhost:5056` | Backend listen address |
| `ASPNETCORE_ENVIRONMENT` | `Development` | ASP.NET environment |
| `BACKEND_PORT` | `5056` | Dev launcher backend port |
| `FRONTEND_PORT` | `5173` | Dev launcher Vite port |
| `DOTNET_ROOT` | `~/.dotnet` | .NET install location (dev launcher) |
| `REQUESTLOOM_APP_URL` | `http://127.0.0.1:5056` | Backend URL used by the Electron shell |

In Docker, `Database__Path` is set to `/data/RequestLoom.db` so data survives container restarts via the named volume.

## Storage

Uploaded multipart files are stored in the request-uploads/ directory beside the configured data file. Include this directory in deployment backups when requests reference uploaded files.
RequestLoom supports two storage backends, switchable from the gear icon in the top bar (Settings):

- **SQLite (default)** - all data lives in a single `RequestLoom.db` database file
- **JSON** - all data lives in a single human-readable `requestloom-data.json` file

Mode precedence: environment variable (`STORAGE_MODE`) > `requestloom.settings.json` (written by the Settings UI) > `appsettings.json` (`Storage:Mode`) > `sqlite`. Changing the mode takes effect after the app is restarted; the settings file is created next to the database/JSON file on first change.

The SQLite schema is managed by Entity Framework Core migrations (`backend/Migrations/`) and applied automatically at startup. Adding a table or column later is a standard EF migration: create the entity, run `dotnet ef migrations add <Name> --project backend --output-dir Migrations`, and it will be applied on the next start.

## Settings

Open the gear icon in the top bar to adjust application settings; they are persisted to `requestloom.settings.json` and take effect immediately, except storage mode which requires a restart:

- **Storage** - SQLite database file or human-readable JSON file (see above)
- **Timeout (seconds)** - per-request timeout; `0` disables it
- **Max response size (MB)** - responses larger than this are truncated in the UI; `0` is unlimited. Truncated responses show a banner and report the full size from the `Content-Length` header
- **Ignore TLS/SSL errors** - skips certificate validation for all requests
- **Response format** - default view (pretty/raw) for response bodies
- **History** - toggle history recording on/off, and clear all history across workspaces

## API overview

### OAuth2 / OIDC setup

Choose **OAuth2 / OIDC** in request authorization or service default authorization. Use **Discover OIDC** with an issuer, or enter the authorization and token endpoints manually. Register the redirect URI shown in the editor with the identity provider; by default it is `<app-origin>/oauth/callback` (for example `http://localhost:5173/oauth/callback` in development or `http://127.0.0.1:5056/oauth/callback` in the desktop/web app).

RequestLoom uses the authorization-code flow with S256 PKCE. Access and refresh tokens remain in the backend process memory, and access tokens are refreshed automatically before expiry. Restarting the backend or disconnecting the authorization requires signing in again.

The backend exposes a REST API under `/api`:

| Area | Endpoints |
| --- | --- |
| Cookies | GET/DELETE /api/workspaces/{workspaceId}/cookies |
| Request uploads | POST /api/requests/{requestId}/uploads |
| Requests | `GET/POST/PUT/DELETE /api/requests` |
| Execution | `POST /api/execute` |
| Collections | `POST /api/collections/run` |
| Environments | `GET/POST/PUT/DELETE /api/environments` |
| Workspaces | `GET/POST/PUT/DELETE /api/workspaces` |
| Variables | `/api/workspace-variables`, `/api/service-variables` |
| Mock servers | `GET/POST/PUT/DELETE /api/mockservers` |
| Import/Export | `POST /api/import`, `GET /api/export` |
| History | `GET /api/history` |
| Settings | `GET/PUT /api/settings`, `DELETE /api/settings/history` |
| OAuth2 / OIDC | `GET /api/oauth/discover`, `POST /api/oauth/exchange`, `GET /api/oauth/status`, `DELETE /api/oauth/token` |
| Tools | `POST /api/tools/generate` (Go, C#, Java, PHP, Ruby) |

Mock server routes are served from `/mock/*` before static files, so they work in both dev and production.

## Disclaimer (LLMs)

This project was developed with assistance from LLM-based tools. AI was used as a coding aid for tasks such as scaffolding, cleanup, and documentation.
