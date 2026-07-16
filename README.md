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
- Import and export scheduler data as JSON
- Track agent availability, time off, and assigned hours
- Submit and approve swap requests from one workspace
- Shared persistence through backend API sync

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
1. Confirm the latest repo includes `backend/package.json` and `render.yaml` with `rootDir: backend`.
2. In Render, open your service and click `Manual Deploy` -> `Deploy latest commit`.
3. In logs, confirm these lines appear:
	- `npm install` running inside `/opt/render/project/src/backend`
	- `npm start`
	- `Scheduler backend running on http://localhost:<port>`
4. If logs still fail, recreate the Blueprint service from the same repo so Render re-reads `render.yaml`.

### Vercel
1. Create a GitHub repository with this folder.
2. In Vercel, import the repository.
3. Deploy with the default settings.
4. Deploy backend separately (or as serverless functions) and point the frontend to that backend URL.

The included [netlify.toml](netlify.toml) and [vercel.json](vercel.json) files help the app deploy cleanly.
