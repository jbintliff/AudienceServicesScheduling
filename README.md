# Scheduling app

Open [index.html](index.html) in a browser to use the upgraded scheduling experience.

Features included:
- Add and remove agents
- Track weekly spend from pay rate and shift duration
- Drag and drop shifts across the week
- Save and reuse shift templates
- Create shifts manually with notes
- Generate recurring shifts from templates
- Search and filter agents and shifts
- Schedule shift colors use the assigned role, or the location when no role is assigned, matching the configured legend colors
- Import and export scheduler data as JSON
- Track agent availability, time off, and assigned hours
- Agent profiles do not display or collect locations; location selection remains available for scheduled shifts
- Set Employment Type to Full Time or Part Time when adding or editing agents; existing profiles show Not set until assigned
- Bulk edit selected agents' employment type alongside their team, manager, and access level
- The weekly schedule roster groups agents by Full Time, Part Time, then Not set, then by team alphabetically, with names alphabetical within each team
- Weekly in-person limits count scheduled shifts with location `In Person/ TP`, not agent profile locations or shift roles
- Request calendars show PTO first, then one-time availability, then repeating availability, including expanded daily request lists
- Select multiple weekdays for repeating availability in agent and manual admin forms; selected days share the date range and times and are saved as separate weekly series
- Review pending and completed availability/PTO requests together in collapsible sections on one agent page
- Submit and approve swap requests from one workspace
- Share admin-managed resource links with agents from their Resources page
- Create 1:1 meeting follow-ups, attach documents, and assign them to agents
- Agent Projects tab with project names, work details, and start/pause/resume/stop time tracking
- Project timers survive navigation and refresh, exclude paused time, and retain completed entries with editable details and total tracked time
- Shared persistence through backend API sync

## Project time tracking
Agent accounts can open **Projects**, enter a project name and optional work details, and select **Start timer**.
Only one timer can be active per agent. **Pause** excludes break time, **Resume** continues tracking, and **Stop and save** adds the entry to the history.
Use **Save details** to save notes while tracking or update notes on a completed entry.
Running timers continue until paused or stopped, including while the page or browser is closed.
Changes are saved on the current device and use the existing backend sync when available; both backend entry points support project time entries.
When using multiple devices, allow backend sync to complete before switching devices.
Concurrent agent saves preserve each other's entries, and older snapshots do not replace newer entry revisions.
Admins can open **Admin > Time Tracking Entries** to review all agents' project names, work details,
start/stop timestamps, statuses, and elapsed time, plus a total across all entries.
Running durations update live; paused time is excluded. This admin-only page is read-only and uses the existing backend sync.
Entries saved on the agent **Projects** page appear here after backend sync, including running and paused timers.
Project actions send the entries to `PUT /api/project-time-entries`; the backend validates and merges them
into its persistent data file before responding. Both the agent and admin pages read these same records
from `GET /api/project-time-entries`. Entries survive backend restarts when `DATA_DIR` uses the configured persistent disk.
Filter by **Agent**, **From date**, and **To date**, then select **Apply filters**; **Clear filters** restores all entries.
Dates use the entry's start date in Eastern time, inclusive of both endpoints. Counts and totals reflect only matching entries.
Filters remain applied through refresh and incoming synced entries.
Select **Export to Excel** to download the matching entries as an Excel-compatible CSV spreadsheet, including work details, status, Eastern timestamps, and tracked duration.

### Time tracking sync troubleshooting
Both pages show backend sync status. Agent Projects syncs automatically without a refresh button;
the admin Time Tracking Entries page retains its **Refresh / retry sync** button.
Agent saves remain pending on the device until a read-back confirms the backend retained the entries.
Failed or outdated-backend writes are retried instead of being marked successful by a general snapshot upload.
If the page reports an outdated backend, deploy the updated backend as well as the frontend.
Include [backend/project-time.js](backend/project-time.js), which is required by both server entry points.
Verify `/api/health` returns `"projectTimeTrackingVersion": 1`.
After deployment, reopen Projects in each browser containing unsynced agent entries to retry sync automatically.
Do not clear those browsers' storage before sync succeeds; device-only entries cannot be recovered from the admin page.

## Run with backend sync (recommended)
1. Install dependencies:
	- `npm install`
2. Start backend API:
	- `npm run start:backend`
	- Backend runs at `http://localhost:8787` by default.
3. Start the frontend:
	- `npm run dev` (or serve static files on your preferred port)

The frontend auto-detects a local backend at `http://localhost:8787/api` in localhost mode.
For deployed environments, set `window.__SCHEDULER_API_URL__` to your backend API base URL (example: `https://your-api.example.com/api`) before loading `app.js`.

## No local installs (Node/Python/Git not available)
You can still run this app for your team using hosted services only.

1. Create a GitHub account (if needed).
2. In the browser, create a new GitHub repository.
3. Upload this project folder contents using GitHub web upload (no Git CLI required).
4. Deploy frontend on Netlify:
	- Import the GitHub repo in Netlify.
	- Deploy site (static frontend URL).
5. Deploy backend on Render:
	- Create a new Blueprint service from the same GitHub repo.
	- Render will detect `render.yaml` and run `node backend/server.js`.
	- Copy backend URL (for example `https://scheduling-app-backend.onrender.com`).
6. In the app (Admin profile -> Backend sync), set backend URL to:
	- `https://YOUR-RENDER-URL/api`
7. Share the Netlify frontend URL with employees.

After step 6, admin updates and swap requests will sync across employee devices.

## Deploy to the web
This project is now structured as a static app that can be published directly.

### Netlify
1. Create a GitHub repository with this folder.
2. In Netlify, choose New site from Git.
3. Select the repository and deploy from the project root.
4. Deploy backend separately (for example on Render/Railway/Fly) and point the frontend to that backend URL.

### Render backend
1. Import this repo in Render.
2. Use the included `render.yaml` (Blueprint deploy).
3. Wait for deploy to complete.
4. Verify backend health at `https://YOUR-RENDER-URL/api/health`.

If Render build fails:
1. Confirm the latest repo includes the root `package.json` and `render.yaml` that uses root-level `npm install` and `npm start`.
2. In Render, open your service and click `Manual Deploy` -> `Deploy latest commit`.
3. In logs, confirm these lines appear:
	- `npm install` running at the repo root
	- `npm start`
	- `Scheduler backend running on http://localhost:<port>` from [server.js](server.js)
4. If logs still fail, recreate the Blueprint service from the same repo so Render re-reads `render.yaml`.

Render fallback (Docker, most reliable):
1. In Render, create `New` -> `Web Service` (not Blueprint).
2. Choose your repo.
3. Select `Environment: Docker`.
4. Set `Dockerfile path` to `backend/Dockerfile`.
5. Deploy.
6. Verify `https://YOUR-RENDER-URL/api/health` returns `{ "ok": true }`.

### Vercel
1. Create a GitHub repository with this folder.
2. In Vercel, import the repository.
3. Deploy with the default settings.
4. Deploy backend separately (or as serverless functions) and point the frontend to that backend URL.

The included [netlify.toml](netlify.toml) and [vercel.json](vercel.json) files help the app deploy cleanly.
