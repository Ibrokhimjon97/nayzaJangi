## Deploy + Supabase + APK (Free)

### 1) Supabase database setup
- Create project at [supabase.com](https://supabase.com).
- Open SQL Editor and run `supabase/leaderboard.sql`.
- In Project Settings -> API, copy:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

### 2) Render deploy (Socket.IO compatible)
- Push this repo to GitHub.
- Open [render.com](https://render.com) -> New -> Blueprint.
- Select repo (Render detects `render.yaml`).
- Add environment variables:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Deploy.

Notes:
- Netlify alone is not suitable for this project backend because Socket.IO server requires a long-running Node process.
- You can still host static front-end on Netlify, but backend must be on Render/Railway/Fly.io.

### 3) Verify production
- Open `https://YOUR_RENDER_URL/api/leaderboard`
- It should return JSON with `source: "supabase"` after env vars are set.

### 4) Build Android APK (Capacitor)
From project root:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Nayza Jangi" "uz.nayzajangi.app" --web-dir=public
```

Edit `capacitor.config.ts` (or json) and set:
- `server.url` to your Render URL, e.g. `https://nayza-jangi.onrender.com`
- `android.allowMixedContent` if needed

Then:

```bash
npx cap add android
npx cap sync android
npx cap open android
```

In Android Studio:
- Build -> Build Bundle(s)/APK(s) -> Build APK(s)
- For Play Store later: Build signed AAB.

### 5) Important production settings
- Keep `SUPABASE_SERVICE_ROLE_KEY` only on server side.
- Do not expose service role key in client files.
- Keep `ratings.json` only as fallback; Supabase is primary in production.
