# RequestLoom Frontend

React + TypeScript + Vite SPA for RequestLoom. See the [root README](../README.md) for full project documentation.

## Commands

```bash
npm install        # install dependencies
npm run dev        # start Vite dev server (proxies /api and /mock to the backend)
npm run build      # type-check and build to dist/
npm run lint       # run oxlint
npm test           # store and variable regression tests
npm run preview    # preview the production build
```

## Notes

- The dev server proxies `/api` and `/mock` to `http://localhost:5056` (see `vite.config.ts`).
- The production build is copied into `backend/wwwroot` by the packaging scripts and served by ASP.NET Core.

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Request editing

Select text in the URL field and right-click **Extract to variable…**. Choose request, service, or global (workspace) scope and an optional environment. Review matching URLs by service and folder, select individual occurrences or all matches, then extract. Existing variable names in the chosen scope are rejected.

Variables use `{{name}}` or `${name}`. Single braces, including GUIDs in URLs, remain literal.

**+ Ephemeral** opens an in-memory request tab. Its fields, settings, attachments, and response are discarded on close; sends do not enter history. App shortcuts, including Ctrl+K, work while Monaco editors have focus.

## End-to-end checks

From the repository root, build the backend and frontend, install Chromium once, and run:

```bash
dotnet build backend
npm --prefix frontend run build
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend run test:e2e
python -m unittest discover -s tests/backend -v
```

The UI checks start an isolated backend with temporary storage and a local static frontend server. They cover extraction scopes, URL replacement, literal braces, ephemeral cleanup, editor shortcuts, and tab dragging. Use `REQUESTLOOM_TEST_DLL` to test a separately built backend DLL, or `CHROMIUM_PATH` to use an existing Chromium executable. Native Tauri drag behavior additionally requires a Windows shell build and a manual drag check.
