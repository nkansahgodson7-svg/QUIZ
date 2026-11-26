# Hosting Specification for Quiz Platform

**Goal:** Deploy the quiz platform (frontend + Node.js+Socket.IO backend) for free and make it live.

**Last updated:** 2026-11-25

---

## 1. Overview

This specification covers deploying the full quiz platform:
- **Frontend:** React + Vite + Tailwind (client/)
- **Backend:** Node.js + Express + Socket.IO (server/)
- **Database:** MongoDB (existing stack, cannot change)
- **Target:** Free hosting, support 300+ concurrent players
- **Current state:** Fresh clone, nothing deployed

---

## 2. Constraints & Requirements

| Constraint | Details |
|---|---|
| **Budget** | Completely free (free tiers only, no credit card) |
| **Database** | MongoDB is required (existing MERN stack) |
| **Concurrent players** | 300+ players per room (load-test target from SPEC.md §6) |
| **Real-time features** | Socket.IO required for real-time game flow |
| **Domain** | No custom domain needed; free subdomain acceptable |
| **Platform** | Vercel preferred (per user preference) |
| **Hosting scope** | Full stack (frontend + Node.js backend) |

---

## 3. Architecture Decision

### 3.1 Full Stack on Vercel

Since the user chose:
- Full stack (frontend + Node.js backend)
- Vercel as preferred platform
- MongoDB required (existing stack)
- Completely free budget

**Recommendation:** Use Vercel with PlanetSQL/MongoDB Atlas free tier, or Vercel + MongoDB Atlas combination.

**Vercel Free Tier Limitations:**
- Serverless functions have cold start (~seconds delay)
- Maximum execution time: 10 seconds per function (may affect Socket.IO)
- No persistent Node processes (Socket.IO server needs workarounds)
- 100GB bandwidth/month on free tier
- 1 project per account (or unlimited with git integration)

### 3.2 Alternative: Frontend on Vercel + Backend on Render

If Vercel's serverless limitations are dealbreakers for Socket.IO:

| Component | Hosting |
|---|---|
| **Frontend** | Vercel (free, easy React deploy) |
| **Backend** | Render (free tier with always-on Node process) |
| **Database** | MongoDB Atlas (free tier) |

**Render Free Tier:**
- Always-on dyno available on free tier (sleeps after inactivity, ~50-100ms cold start)
- 750 hours/month always-on time
- Custom domain free
- HTTPS included

---

## 4. MongoDB Setup

**Required:** MongoDB Atlas (free tier) or self-hosted MongoDB.

### 4.1 MongoDB Atlas (Recommended for free)

1. Go to: [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
2. Create free account
3. Create new cluster → "Free M0" (shared, forever free)
4. Choose AWS region (closest to target audience)
5. Set up database user with read/write permissions
6. Whitelist IP addresses (0.0.0.0/0 for development, restrict later)
7. Get connection string: `mongodb+srv://<username>:<password>@cluster0.xxx.mongodb.net/quiz_platform`

### 4.2 Update Environment Variables

Add to project `.env` or Vercel/Render dashboard:

```
MONGODB_URI=mongodb+srv://username:password@cluster0.xxx.mongodb.net/quiz_platform
```

The existing server already expects `MONGO_URI` in `.env` (see `server/.env.example`).

---

## 5. Deployment Plan

### Option A: Vercel Full Stack (Recommended based on user preferences)

**Step-by-step:**

1. **MongoDB Atlas setup** (see Section 4)
2. **Set up Vercel project:**
   - Connect GitHub repo to Vercel
   - Import the project
3. **Configure Vercel Environment Variables:**
   - `PORT=4000`
   - `MONGODB_URI=<from Atlas>`
   - `JWT_SECRET=<long-random-value>`
   - `JWT_EXPIRES_IN=7d`
   - `CORS_ORIGIN=https://your-app.vercel.app`
   - `REVEAL_MS=5000`
   - `MAX_PLAYERS_PER_ROOM=1000`
   - `ROOM_TTL_MS=3600000`
   - `LOBBY_TTL_MS=43200000`
4. **Build and deploy:**
   - Vercel will detect `package.json` scripts
   - `npm run build` for client
   - `npm start` for server (serverless function)
5. **Note on Socket.IO with Vercel Serverless:**
   - Vercel serverless functions don't maintain persistent WebSocket connections
   - Socket.IO will need **long-polling fallback** or **Vercel Edge Config**
   - Alternative: Use [Vercel Socket.IO example](https://vercel.com/examples/basics/socket-io) pattern
   - Or accept cold starts (~2-5 second delay on first connection)

### Option B: Vercel Frontend + Render Backend

**Better for Socket.IO persistent connections:**

1. **Frontend on Vercel** (same as Option A)
2. **Backend on Render:**
   - New Web Service → Connect GitHub repo
   - Build command: `npm install`
   - Start command: `npm run dev` (or `node src/index.js`)
   - Free tier selected
   - Add environment variables same as above
   - Set up custom domain if desired (free on Render)
3. **Update CORS_ORIGIN** to include both Vercel and Render URLs
4. **MongoDB Atlas** as shared database

**Advantages:**
- Render free tier keeps Node process always-on (no cold starts for Socket.IO)
- Better WebSocket persistence
- Combined free tier still within budget

### Option C: GitHub Pages + Render Backend (Most Free)

1. **Frontend on GitHub Pages** (free, no cost)
2. **Backend on Render** (free tier with always-on option)
3. **MongoDB Atlas** (free tier)
4. **CORS config** allows both origins

**Disadvantages:**
- GitHub Pages doesn't support server-side code
- Requires separate domain setup for API calls
- More complex CORS configuration

---

## 6. Environment Configuration

### 6.1 Backend `.env` (server/)

```
PORT=4000
HOST=0.0.0.0
MONGODB_URI=mongodb+srv://username:password@cluster0.xxx.mongodb.net/quiz_platform
JWT_SECRET=replace-with-long-random-secret
JWT_EXPIRES_IN=7d
CORS_ORIGIN=https://your-app.vercel.app  # or Render URL
REVEAL_MS=5000
MAX_PLAYERS_PER_ROOM=1000
ROOM_TTL_MS=3600000
LOBBY_TTL_MS=43200000
```

### 6.2 Frontend `.env` (client/)

```
VITE_SERVER_URL=https://your-backend-url.com  # Vercel serverless URL or Render URL
```

The existing `client/src/lib/socket.ts` reads `VITE_SERVER_URL` and defaults to `http://localhost:4000`.

---

## 7. Load Testing (300+ Players)

After deployment, verify with:

```bash
# From server directory
npm run loadtest -- --players 300 --questions 3 --duration 5
```

Or manually:

```bash
node scripts/fake-players.js --players 300 --questions 3 --duration 5
```

This should confirm:
- 300+ players can join a room
- Players can answer questions
- Scoring works correctly
- Session is saved to MongoDB
- Host sees full leaderboard

---

## 8. DNS & Custom Domain (Optional)

If desired later:

- **Vercel:** Automatic `*.vercel.app` subdomain
- **Render:** Free custom domain via dashboard
- **Both:** Point DNS A/CNAME records to hosting provider

No custom domain required per user preference, but path is clear if needed.

---

## 9. Post-Deployment Checklist

- [ ] MongoDB Atlas cluster created and accessible
- [ ] Backend environment variables set (Vercel/Render dashboard)
- [ ] Frontend `VITE_SERVER_URL` configured
- [ ] CORS_ORIGIN matches deployed URLs
- [ ] Basic functionality test: host creates room, players join
- [ ] Load test with 300+ fake players
- [ ] Signup/Login flow works end-to-end
- [ ] Quiz creation and room creation works
- [ ] Game flow: lobby → start → questions → reveal → leaderboard
- [ ] Past results viewable
- [ ] Mobile responsiveness verified

---

## 10. Known Free-Tier Limitations

| Feature | Limitation | Workaround |
|---|---|---|
| **Vercel serverless** | Cold starts (2-5s delay) | Accept delay, or use Option B (Render) |
| **MongoDB M0** | Shared resources, 500MB storage | Stay within limits for quiz data |
| **Render free tier** | Dyno sleeps after inactivity | First request has ~50ms delay |
| **Bandwidth** | 100GB/month on Vercel | Should be fine for quiz traffic |
| **Concurrent connections** | Socket.IO limited by server capacity | 300 players should be fine on free tiers |

---

## 11. Next Steps

1. **User choice:** Confirm Option A (Vercel full stack) or Option B (Vercel + Render)
2. **MongoDB Atlas:** Create free cluster and provide connection string
3. **Deploy:** Follow chosen option's steps
4. **Test:** Run load test, verify all game flows
5. **Iterate:** Address any issues from load test or user feedback

---