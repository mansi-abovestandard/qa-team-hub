# QA Team Hub

A team tool for QA across **several projects**: checklists from templates, test rounds ("start again" in one click),
bugs, and a final report that is emailed to the team. React front end, Node API, SQLite database, sign-in with roles.

## Run it

```bash
npm install
npm run dev          # React dev server http://127.0.0.1:5174  (API stays on :4411)
```

`npm run dev` is the frontend to use while working. It is the React app with hot reload. The API is the server already running on port 4411, so the Lokalnyt data is the same.

`npm run build` then `npm start` serves the built files on port 4400. That copy does not reload when the React code changes. Tests: `npm test`.

## How it works

| Thing | Meaning |
|---|---|
| **Project** | One product (website, app...). Has its own tasks, rounds, bugs, team, report recipients. |
| **Template** | A starting checklist. Built in: *Website + CMS (Lokalnyt full checklist)* with 592 tasks, and *Blank*. Any project can be saved as a template. |
| **Task** | One thing to check (title, steps, "you pass if...", priority, area, page/module). Add, edit, remove or import CSV per project. |
| **Test round** | One full pass over every task. **Start new test round** copies ALL tasks again, all "Not tested". Old rounds keep their results and their own copy of the tasks. |
| **Automatic checks** | Website responds, sitemap, key pages, 404 page, health (+ browser checks with Playwright). Results are written by the tool; a failure opens a bug. |
| **Bug** | Severity, status (open > in progress > fixed > verified), assignee, history. Linked to the task and the round. |
| **Report** | Verdict GO / GO WITH RISKS / NO-GO, every page and module with problems, open bugs, regressions since the previous round. |

### Roles
- **Global admin**: everything, every project, all people.
- **Project admin**: tasks, team, settings of that project.
- **Tester**: start rounds, set statuses, report bugs.
- **Viewer**: read only.

## Email

Copy `.env.example` to `.env`, fill in the SMTP settings, restart. Recipients are set **per project** (Settings and team).
Nothing is emailed until someone clicks **Finish round and email report** (a confirmation shows the recipients).

## On every deployment

```bash
npm run run-checks -- --project 1 --name v1.4.0 --env staging --url https://staging.example.dk --commit "$SHA" [--browser]
```

Creates a new round with all tasks, runs the automatic checks, prints the verdict (exit code 2 if an automatic check failed).
Testers then finish the manual tasks in the app and click **Finish round and email report**.

Browser checks (optional): `npm i playwright && npx playwright install chromium`, then add `--browser`.

## Security notes

- Passwords are hashed with scrypt; sessions are random tokens stored hashed; the cookie is HttpOnly + SameSite=Lax (add `COOKIE_SECURE=true` behind https).
- Writes must be JSON from the same origin (CSRF guard); logins are rate limited; every route checks the user's role in that project.
- The server listens on 127.0.0.1. To share it with the team put it on a server behind https (reverse proxy) and set `HOST`/`COOKIE_SECURE`.
- Back up `data/qa-hub.db` (one SQLite file, WAL mode: copy the `.db-wal` file along with it, or use `sqlite3 .backup`).

## Rebuild the Lokalnyt template from code

`python3 tools/build_checklist.py /path/to/Lokalnyt` writes `seed/full-checklist.json`; copy it to `seed/lokalnyt-website-cms.json`
and delete the template in the database (or add a new one) to refresh it.
