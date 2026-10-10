# QA Team Hub – handoff / architecture overview

Multi-project QA tool. A project has a checklist (tasks). Each "test round" snapshots all tasks as
"Not tested"; testers set results, bugs are tracked, automatic checks run, and a final report is emailed.

## Run

```
npm install
npm run build          # builds client/dist (served by Express)
npm start              # http://127.0.0.1:4400  (first visit = create admin)
npm run dev:server     # API only, with watch
npm run dev:client     # Vite dev server (proxy to API)
npm test               # node --test tests/*.test.js  (9 API tests)
npm run create-admin
npm run run-checks -- --project 1 --name v1.4.0 --env staging --url https://site [--browser]
```

Node 22 required (uses built-in `node:sqlite`, started with `--disable-warning=ExperimentalWarning`).
Config via `.env` (see `.env.example`): PORT, COOKIE_SECURE, DATABASE_FILE, SMTP_*, REPORT_FROM.

## Stack

- Backend: Express 4, `node:sqlite` (file DB `data/qa-hub.db`), nodemailer, optional Playwright.
- Frontend: React 18, react-router-dom 6, Vite 5 (plain CSS, no UI library).
- No ORM: raw SQL in `server/app.js` and `server/services/*`.

## Backend layout (`server/`)

| File | Role |
|---|---|
| `index.js` | Boots DB + app, listens on PORT |
| `db.js` | `openDb`, schema/migrations, `tx()` transaction helper |
| `http.js` | `wrap` async handler, error helpers |
| `auth.js` | scrypt password hashing, sessions (hashed token in HttpOnly SameSite=Lax cookie), CSRF guard (JSON + same-origin), login throttle, `projectRole` / `requireProjectRole` |
| `app.js` | `createApp(db)` – all routes below, serves `client/dist` |
| `services/templates.js` | seed built-in templates, create project tasks from a template, save project as template |
| `services/runView.js` | build run/round view, stats, history, regressions |
| `services/report.js` | verdict (GO / GO WITH RISKS / NO-GO), issues grouped by page/module/CMS, HTML + text report |
| `services/autochecks.js` | AUTO-01..05 HTTP checks, AUTO-06..08 Playwright checks, writes results + opens bugs |
| `services/mailer.js` | SMTP config, build/send report email (does nothing without SMTP settings) |
| `services/csv.js` | CSV parse/serialise for task import/export |
| `cli/create-admin.js`, `cli/run-checks.js` | CLI for admin creation and CI/deploy hook |

### Database tables
`users, sessions, projects, project_members, templates, template_items, tasks, runs, run_items,
result_history, bugs, bug_events, run_item_bugs`

Key idea: `tasks` = live checklist; `runs` + `run_items` = per-round **copy** of tasks with their own
status. Editing a task changes only the next round. Closed rounds are never altered.

### API (all under `/api`, JSON, cookie auth, CSRF-guarded)

- Auth: `GET auth/state`, `POST auth/setup` (only while no user exists), `auth/login`, `auth/logout`, `auth/password`
- Users (admin): `GET/POST users`, `PATCH users/:id`
- Templates: `GET templates`, `DELETE templates/:id`
- Projects: `GET/POST projects`, `GET/PATCH/DELETE projects/:pid`, `PUT projects/:pid/members`, `POST projects/:pid/save-as-template`
- Tasks: `GET/POST projects/:pid/tasks`, `PATCH/DELETE tasks/:id`, `POST projects/:pid/tasks/import`, `GET projects/:pid/tasks.csv`
- Rounds: `GET/POST projects/:pid/runs` (POST = "start new round, all tasks again"), `GET runs/:rid`, `PUT runs/:rid/items/:code`, `POST runs/:rid/close`
- Bugs: `GET/POST projects/:pid/bugs`, `PATCH bugs/:id`, `GET bugs/:id/events`
- Auto + report: `POST runs/:rid/auto-checks`, `GET runs/:rid/report.html|txt`, `GET runs/:rid/mail` (preview), `POST runs/:rid/finish` (close + email)

### Roles
Global admin (acts as admin on every project) · per project: admin / tester / viewer.
Viewer = read only; tester = results, bugs, tasks; project admin = members, settings, recipients.

## Frontend layout (`client/src/`)

- `main.jsx`, `App.jsx` – router and auth gate; `auth.js` – current-user context; `api.js` – fetch wrapper (CSRF, errors); `ui.jsx` – shared components; `styles.css`.
- Pages: `Login` (also first-run setup), `Projects`, `NewProject` (template choice), `ProjectLayout` (tabs),
  `Rounds`, `Round` (checklist grid, filters, status buttons, bug dialog, auto-checks, finish + email),
  `Tasks` (add/edit/import/export), `Bugs`, `Settings` (URL, recipients, members, save as template), `Users`.

## Data seeds
`seed/lokalnyt-website-cms.json` – 592 tasks (public pages + CMS modules). Regenerate from the Lokalnyt repo
with `tools/build_checklist.py` + `tools/public_data.py`. `config/urls.json` – key pages for HTTP checks.

## Status
Done and tested: everything above. Not tested: real SMTP sending. Not built: server deployment/https,
email password reset, Slack/Teams notifications, "copy results from previous round".
Security notes are in README.md (session cookie, CSRF, throttle; set COOKIE_SECURE=true behind https).

## Good next tasks for Cursor
1. Deploy (Docker or small VPS, reverse proxy with https, COOKIE_SECURE=true, backup of `data/`).
2. Send a test email with real SMTP; confirm recipients (pm@abovestandard.dk, mg@, mk@).
3. "Copy results from previous round" option when starting a round.
4. Per-store / per-company checklists via extra task groups.
5. Slack/Teams notification on round finish; password reset flow.
6. Add API tests for CSV import and auto-checks failure → bug creation.
