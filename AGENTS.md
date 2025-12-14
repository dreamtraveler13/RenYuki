# Repository Guidelines

## Project Structure & Module Organization
- Next.js App Router entry is in `app/` (`layout.tsx`, `page.tsx`) with API routes under `app/api/*` for generate-image/script/voice/task endpoints.
- UI sits in `App.tsx` and `components/*` (wizard, console, player). Server helpers live in `lib/` and `services/*` for AI orchestration and task handling.
- Edge/longer-running jobs mirror HTTP APIs in `functions/api/*`. Static assets live in `public/`; payment art in `pay/`; sample outputs/logs in `job_results/`. Shared types stay in `types.ts`.
- Secrets and runtime settings load from `.env.local` only.

## Build, Test, and Development Commands
- `npm install` - install dependencies (Node 18+ recommended).
- `npm run dev` - start the Next.js app with API routes at `http://localhost:3000`.
- `npm run build` - production build; blocks on type or lint errors.
- `npm run start` - run the built app locally.
- `npm run lint` - Next.js ESLint checks; run before commits/PRs.
- Required env keys: `LINGYAAI_API_KEY` (or `API_KEY`); optional `NEXT_PUBLIC_API_BASE` for custom API hosts.

## Coding Style & Naming Conventions
- TypeScript-first; keep components functional and hook-driven. Use `PascalCase` for React components and files, `camelCase` for helpers, and hyphenated route filenames under `app/api/*`.
- Follow ESLint/Next defaults (2-space indentation, single quotes, trailing commas when autoformatted). Keep API handlers thin and move IO/model calls into `lib/` or `services/`.
- Prefer async/await, narrow types early, and keep server-only data off the client.

## Testing Guidelines
- No automated test suite yet. Minimum checks: `npm run lint` plus manual flows (upload heroine/protagonist, generate script and images, save/load progression).
- When adding features, include lightweight component or API tests where practical and document manual test steps in the PR.

## Commit & Pull Request Guidelines
- Use concise, conventional commits where possible (`feat:`, `fix:`, `chore:`; scopes like `pwa prompt` or `edge tasks`).
- PRs should state intent, list main changes, link issues/tasks, and include screenshots or short clips for UI updates. Note the commands run (`npm run lint`, `npm run build`) and any manual testing.
- Keep diffs small and focused; avoid bundling unrelated refactors.

## Security & Configuration Tips
- Store secrets only in `.env.local`; never commit API keys or user-uploaded data. Client-exposed values must be prefixed with `NEXT_PUBLIC_`.
- The app does not persist user data in a database; generated content flows from server-side handlers directly to the requesting client. Avoid logging sensitive payloads and ensure any temporary files are cleaned up.
