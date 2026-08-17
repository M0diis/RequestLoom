# RequestLoom Frontend

React + TypeScript + Vite SPA for RequestLoom. See the [root README](../README.md) for full project documentation.

## Commands

```bash
npm install        # install dependencies
npm run dev        # start Vite dev server (proxies /api and /mock to the backend)
npm run build      # type-check and build to dist/
npm run lint       # run oxlint
npm run preview    # preview the production build
```

## Notes

- The dev server proxies `/api` and `/mock` to `http://localhost:5056` (see `vite.config.ts`).
- The production build is copied into `backend/wwwroot` by the packaging scripts and served by ASP.NET Core.

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
