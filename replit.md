# /fpeds — Link Intelligence & OSINT

## Overview
fpeds is a Node.js/Express web app with user authentication and three main tools:
- **Check** — Bulk URL checker (clearnet + .onion via Tor SOCKS5)
- **Search** — Chatroom/stranger-chat link discovery with Google Dork queries + infinite mode
- **OSN | SEARCH** — OSINT engine: email/username/phone/IP/name lookup across breach DBs, social platforms, and paste sites

## Stack
- **Runtime:** Node.js (CommonJS)
- **Server:** Express 5 + express-session + bcrypt auth
- **Frontend:** Vanilla JS (single-page, SSE-based live streaming)
- **Data:** Flat-file JSON (`data/users.json`)

## How to Run
Workflow `fpeds` runs `node server.js` — starts on port 5000.

Access at: `/fpeds` (redirects to login if not authenticated)

## Environment
- `SESSION_SECRET` — required for session signing (configured in Replit Secrets)
- `.onion` link checking requires Tor running locally on SOCKS5 port 9050

## User Preferences
- Show full unmasked breach data in OSN | SEARCH (used for self-testing)
- Link Search uses Google Dork queries + truly infinite dynamic query generation in ∞ mode
- IP addresses are fully shown in breach/OSINT records (not masked)
