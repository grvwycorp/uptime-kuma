# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Install dependencies (always use npm ci, not npm install)
npm ci

# Development - runs both frontend (port 3000) and backend (port 3001)
npm run dev

# Or run frontend/backend separately
npm run start-frontend-dev
npm run start-server-dev

# Build frontend to dist/
npm run build

# Linting (required before commits)
npm run lint           # Both JS and style
npm run lint:prod      # Zero warnings allowed
npm run lint-fix:js    # Auto-fix JS issues
npm run fmt            # Format with Prettier

# Testing (requires build first)
npm run build && npm test          # Full test suite
npm run test-backend               # Backend tests only
npm run test-e2e                   # Playwright E2E tests
npm run test-e2e-ui                # E2E with interactive UI
```

## Architecture Overview

**Stack**: Vue 3 + Vite frontend, Node.js/Express backend, Socket.IO for real-time communication, SQLite primary database.

**Communication Pattern**: Most backend logic uses Socket.IO (`server/socket-handlers/`) rather than REST APIs. Express serves the built frontend, handles status page APIs, and entry point routing.

**Frontend Data Flow**: Single Page Application with Vue Router (`src/router.js`). Global state and socket logic centralized in `src/mixins/socket.js`, data stored at root level across all routes.

### Key Directories

- `server/` - Backend: `server.js` (entry), `uptime-kuma-server.js` (main class)
  - `socket-handlers/` - Socket.IO event handlers (bulk of backend logic)
  - `monitor-types/` - Monitor type implementations
  - `notification-providers/` - Notification integrations
  - `model/` - Database models (auto-mapped to tables)
  - `routers/` - Express routes
- `src/` - Frontend Vue 3 SPA
  - `pages/` - Page components
  - `components/` - Reusable components
  - `components/notifications/` - Notification provider UIs
  - `mixins/socket.js` - Socket.IO client + global state
  - `lang/` - i18n translations
- `db/knex_migrations/` - Database migrations (Knex.js)
- `config/` - Vite and Playwright configs

## Code Style Requirements

- **4 spaces** indentation, **double quotes**, Unix line endings (LF), semicolons required
- **JSDoc required** for all functions and methods
- **Naming**: JavaScript (camelCase), SQLite columns (snake_case), CSS/SCSS (kebab-case)
- Follow `.editorconfig` and `.eslintrc.js`

## Adding New Features

### New Notification Provider
1. `server/notification-providers/PROVIDER_NAME.js` - Backend logic with axios wrapped in try/catch
2. `server/notification.js` - Register provider
3. `src/components/notifications/PROVIDER_NAME.vue` - Frontend UI (use `HiddenInput` for secrets)
4. `src/components/notifications/index.js` - Register frontend
5. `src/lang/en.json` - Add translation keys (other languages handled by Weblate)

### New Monitor Type
1. `server/monitor-types/MONITORING_TYPE.js` - Implement `async check()` that sets `heartbeat.msg` and `heartbeat.status = UP` on success, or throws Error on failure (never set `status = DOWN` directly)
2. `server/uptime-kuma-server.js` - Register monitor type
3. `src/pages/EditMonitor.vue` - Add frontend UI
4. `src/lang/en.json` - Add translation keys

## Important Notes

- **npm ci required** - Always use `npm ci` instead of `npm install` for reproducible builds
- **Build before tests** - Frontend must be built before running tests
- **TypeScript errors** - `npm run tsc` shows 1400+ errors; these are expected and don't affect builds
- **First run** - "db-config.json not found" message is expected; triggers setup wizard
- **Ports** - Dev server uses 3000 (frontend) and 3001 (backend)
- **Git branches** - `master` for v2 development, `1.23.X` for v1 maintenance
- **Node.js** - Requires >= 20.4.0
- **Never commit** - `data/`, `dist/`, `tmp/`, `private/`, `node_modules/`
