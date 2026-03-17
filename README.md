# Instagram QR Attendance Collector

Collect Instagram handles at events with a QR code.  
Serverless — runs on Google Apps Script + Google Sheets + GitHub Pages.  
**Free. No database. No monthly fees.**

---

## Live demo

| Page | URL |
|------|-----|
| Landing | `index.html` |
| Setup wizard | `setup.html` |
| Admin panel | `admin.html` |
| Check-in form | `instagram.html` |

---

## How it works

```
Admin generates QR  →  Attendee scans  →  Enters Instagram ID
        ↓                                         ↓
  admin.html                              instagram.html
  builds URL with                         reads ?date + ?session
  ?date=2026-03-24                        POSTs to Google Apps Script
  &session=30                                      ↓
  &backend=<GAS_URL>               Google Sheet updated instantly
```

**Two sheets are updated per submission:**

| Sheet | What happens |
|-------|-------------|
| Monthly (e.g. `26년 3월`) | New row added OR existing row gets `O` in session column + count incremented |
| Summary (`기간 총 참여 Summary`) | New row added OR total count incremented |

---

## Quick start (5 minutes)

### 1. Fork / download this repo

Upload the `dist/` folder to GitHub Pages, Netlify, or any static host.

### 2. Open your Google Sheet

Go to **Extensions → Apps Script**.  
Paste the contents of `Code.gs` (replacing all existing code).

### 3. Edit the CONFIG block in Code.gs

```javascript
const CONFIG = {
  SPREADSHEET_ID: "YOUR_SPREADSHEET_ID",  // from the sheet URL
  MONTHLY_SHEET:  "26년 3월",              // your monthly tab name
  SUMMARY_SHEET:  "기간 총 참여 Summary",  // your summary tab name
  SUMMARY_DATA_START_ROW: 3,              // row where data starts (skip title rows)
  // ... column indexes (0-based)
};
```

### 4. Deploy as Web App

**Deploy → New Deployment → Web App**

| Setting | Value |
|---------|-------|
| Execute as | **Me** |
| Who has access | **Anyone** |

Copy the Web App URL (looks like `https://script.google.com/macros/s/.../exec`).

### 5. Run the setup wizard

Open `setup.html` on your hosted site.  
Paste the Web App URL → test the connection → map your sheets → done.

---

## Using the admin panel

Open `admin.html` before each event:

1. Enter **Session #** and **Date**
2. Click **Generate QR Code**
3. **Download PNG** → print or display on screen

The QR encodes:
```
https://yoursite.com/instagram.html?date=2026-03-24&session=30&backend=<GAS_URL>
```

Session history is saved locally — re-generate past QRs from the **History** tab.

---

## File structure

```
dist/
├── index.html        Landing / marketing page
├── setup.html        One-time setup wizard
├── admin.html        Per-event QR generator (admin only)
├── instagram.html    Attendee check-in form (public, linked from QR)
├── Code.gs           Google Apps Script backend
└── README.md         This file
```

---

## Deploying to GitHub Pages

```bash
# 1. Create a new GitHub repo
# 2. Push the dist/ contents to the repo root
git init
git add .
git commit -m "Initial deploy"
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main

# 3. Enable GitHub Pages
# Settings → Pages → Branch: main → / (root) → Save

# Your URLs:
# https://YOUR_USER.github.io/YOUR_REPO/          ← landing
# https://YOUR_USER.github.io/YOUR_REPO/setup     ← setup wizard
# https://YOUR_USER.github.io/YOUR_REPO/admin     ← admin panel
# https://YOUR_USER.github.io/YOUR_REPO/instagram ← check-in form
```

---

## Expected sheet structure

### Monthly sheet (e.g. `26년 3월`)

| A: 순위 | B: 게스트 ID | C: 참가횟수 | D: 2026-03-02 | E: 2026-03-17 | … |
|---------|------------|------------|--------------|--------------|---|
| 1 | gangminlee | 2 | O | O | |
| 2 | newuser | 1 | | O | |

- Date columns are **auto-created** when a new session date is first submitted.
- Existing guests get `O` added and their count incremented.
- New guests get a full row appended.

### Summary sheet

| A: 게스트 ID | B: 참가 횟수 | C: 가능성 | D: 추천 여부 | E: 연령대 | F: 특이사항 | G: 인스타그램 |
|------------|------------|---------|-----------|---------|-----------|-------------|
| gangminlee | 7 | 있음 | | | | https://instagram.com/gangminlee |
| newuser | 1 | | | | | https://instagram.com/newuser |

- Row 1 = title row (skipped)
- Row 2 = blank (skipped)  
- Row 3+ = data

---

## API reference

### `GET /exec`
Health check.
```json
{ "status": "ok", "message": "Instagram QR Attendance Collector is running." }
```

### `POST /exec` — submit attendance
```json
{ "instagram": "username", "date": "2026-03-24", "session": "30" }
```
Response:
```json
{ "status": "success", "isNew": true, "session": "2026-03-24" }
```

### `POST /exec` — inspect sheets
```json
{ "action": "inspect" }
```
Returns all sheet names, column counts, headers, and a 3-row preview.

---

## Updating for a new month

When a new month starts (e.g. April):

1. Create a new sheet tab named `26년 4월`
2. Set up the header row: `순위 | 게스트 ID | 참가횟수`
3. In Apps Script editor, update `CONFIG.MONTHLY_SHEET = "26년 4월"` and redeploy
4. Or: use the setup wizard to re-map the sheets

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `"Sheet not found"` error | Check `MONTHLY_SHEET` / `SUMMARY_SHEET` names match exactly (case-sensitive) |
| Connection test fails | Ensure Web App is deployed with **Who has access: Anyone** |
| QR doesn't show | CDN may be blocked — the Google Charts API fallback requires internet |
| Date column not created | Ensure `?date=YYYY-MM-DD` is in the QR URL |
| Count not incrementing | Handle comparison is case-insensitive — check for leading/trailing spaces in the sheet |

---

## License

MIT — free to use, modify, and distribute.
