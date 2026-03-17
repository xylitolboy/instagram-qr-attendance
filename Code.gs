/**
 * ============================================================
 *  Instagram QR Attendance Collector — Generic Backend
 *  ============================================================
 *  Works with any Google Sheet.
 *
 *  SETUP (one time per user):
 *  1. Open your Google Sheet → Extensions → Apps Script
 *  2. Paste this entire file, replacing any existing code
 *  3. Edit the CONFIG block below (SPREADSHEET_ID is required;
 *     adjust sheet names to match your tabs)
 *  4. Deploy → New Deployment → Web App
 *       Execute as: Me
 *       Who has access: Anyone
 *  5. Copy the Web App URL → paste into admin.html config
 *
 *  HOW IT WORKS
 *  ------------
 *  POST { instagram, date, session } → records attendance in:
 *    - Monthly sheet  : marks "O" in the session-date column,
 *                       increments participation count
 *    - Summary sheet  : increments total count (or adds new row)
 *    - Log sheet      : appended automatically
 *
 *  POST { action:"inspect" } → returns sheet structure (for setup wizard)
 *  GET  ?action=inspect      → same
 *  GET  (no params)          → health check
 * ============================================================
 */

// ── USER CONFIGURATION ────────────────────────────────────────────────────────
const CONFIG = {
  // ✅ REQUIRED: Your Google Spreadsheet ID
  // Get it from the URL: docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
  SPREADSHEET_ID: "YOUR_SPREADSHEET_ID",

  // Name of the monthly attendance sheet tab
  // Columns expected: 순위/rank | 게스트ID/handle | 참가횟수/count | <date> ...
  MONTHLY_SHEET: "26년 3월",

  // Name of the overall summary sheet tab
  // Columns expected: 게스트ID | 참가횟수 | ... | 인스타그램
  SUMMARY_SHEET: "기간 총 참여 Summary",

  // Row where data starts in summary sheet (1 = header, 2 = first data row, etc.)
  // Use 3 if row 1 is a title and row 2 is blank/sub-header
  SUMMARY_DATA_START_ROW: 3,

  // Column indexes (0-based) in monthly sheet
  MONTHLY_COL_RANK:   0,  // A: rank/순위
  MONTHLY_COL_HANDLE: 1,  // B: instagram handle
  MONTHLY_COL_COUNT:  2,  // C: participation count
  // session date columns start at index 3 (D onwards)

  // Column indexes (0-based) in summary sheet
  SUMMARY_COL_HANDLE: 0,  // A: instagram handle
  SUMMARY_COL_COUNT:  1,  // B: participation count
  SUMMARY_COL_IG_URL: 6,  // G: https://instagram.com/handle

  // Fallback session date when no ?date= is sent (YYYY-MM-DD)
  FALLBACK_DATE: "",

  // Rate limiting: max submissions per 10-min window per user key
  RATE_LIMIT_MAX:       10,
  RATE_LIMIT_WINDOW_MS: 10 * 60 * 1000,

  // Log sheet name (created automatically if missing)
  LOG_SHEET: "Log",
};
// ──────────────────────────────────────────────────────────────────────────────


// ── ENTRY POINTS ──────────────────────────────────────────────────────────────

function doGet(e) {
  const action   = (e && e.parameter && e.parameter.action)   || "";
  const callback = (e && e.parameter && e.parameter.callback) || "";

  let output;
  if (action === "inspect") {
    output = inspectResponse();
  } else {
    output = json({
      status: "ok",
      message: "Instagram QR Attendance Collector is running.",
      fallback_date: CONFIG.FALLBACK_DATE,
    });
  }

  // JSONP support — wraps response in callback(…) for cross-origin browser calls
  if (callback) {
    const body = output.getContent();
    return ContentService
      .createTextOutput(callback + "(" + body + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return output;
}

function doPost(e) {
  try {
    // ── Parse ──────────────────────────────────────────────────
    let body;
    try { body = JSON.parse(e.postData.contents); }
    catch (_) { return json({ status: "error", message: "Invalid JSON body." }); }

    // ── Diagnostic ────────────────────────────────────────────
    if (body.action === "inspect") return inspectResponse();

    // ── Resolve session date ───────────────────────────────────
    const sessionDate = resolveDate(body.date);
    if (!sessionDate) {
      return json({ status: "error", message: "No session date provided and no fallback configured." });
    }
    const sessionNum = (body.session || "").toString().trim();

    // ── Validate handle ────────────────────────────────────────
    const handle = (body.instagram || "").toString().replace(/^@+/, "").trim();
    if (!handle)            return json({ status: "error", message: "Instagram handle is required." });
    if (handle.length < 3)  return json({ status: "error", message: "Handle too short (min 3 chars)." });
    if (handle.length > 30) return json({ status: "error", message: "Handle too long (max 30 chars)." });
    if (!/^[a-zA-Z0-9._]+$/.test(handle))
      return json({ status: "error", message: "Invalid characters in handle." });

    // ── Rate limit ─────────────────────────────────────────────
    const uid = getUid(e);
    if (isRateLimited(uid)) {
      writeLog("RATE_LIMIT", uid, handle);
      return json({ status: "error", message: "Too many submissions. Please wait a moment." });
    }

    // ── Write to sheets ────────────────────────────────────────
    const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const isNew = recordAttendance(ss, handle, sessionDate);

    const tag = sessionNum ? "[S#" + sessionNum + " " + sessionDate + "]" : "[" + sessionDate + "]";
    writeLog(isNew ? "NEW_GUEST" : "RETURNING", uid, handle + " " + tag);

    return json({ status: "success", message: "Attendance recorded.", isNew: isNew, session: sessionDate });

  } catch (err) {
    writeLog("ERROR", "unknown", err.toString());
    return json({ status: "error", message: "Server error: " + err.message });
  }
}


// ── CORE ──────────────────────────────────────────────────────────────────────

function recordAttendance(ss, handle, sessionDate) {
  const monthly = ss.getSheetByName(CONFIG.MONTHLY_SHEET);
  const summary = ss.getSheetByName(CONFIG.SUMMARY_SHEET);

  if (!monthly) throw new Error('Sheet not found: "' + CONFIG.MONTHLY_SHEET + '"');
  if (!summary) throw new Error('Sheet not found: "' + CONFIG.SUMMARY_SHEET + '"');

  const isNew = updateMonthlySheet(monthly, handle, sessionDate);
  updateSummarySheet(summary, handle);
  return isNew;
}

// ── Monthly sheet ─────────────────────────────────────────────────────────────

function updateMonthlySheet(sheet, handle, sessionDate) {
  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();

  // Find or create the session-date column
  const headerVals = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    : [];

  let sessionColIdx = -1;
  for (let i = 0; i < headerVals.length; i++) {
    if (cellToDateStr(headerVals[i]) === sessionDate) { sessionColIdx = i; break; }
  }
  if (sessionColIdx === -1) {
    sessionColIdx = lastCol;
    sheet.getRange(1, sessionColIdx + 1).setValue(sessionDate);
  }

  // Search for existing handle
  if (lastRow > 1) {
    const ids = sheet
      .getRange(2, CONFIG.MONTHLY_COL_HANDLE + 1, lastRow - 1, 1)
      .getValues().flat()
      .map(v => String(v).toLowerCase().trim());
    const idx = ids.findIndex(v => v === handle.toLowerCase());

    if (idx !== -1) {
      const row       = idx + 2;
      const countCell   = sheet.getRange(row, CONFIG.MONTHLY_COL_COUNT  + 1);
      const sessionCell = sheet.getRange(row, sessionColIdx + 1);
      if (String(sessionCell.getValue()).trim().toUpperCase() !== "O") {
        sessionCell.setValue("O");
        countCell.setValue((Number(countCell.getValue()) || 0) + 1);
      }
      return false;
    }
  }

  // New guest — append row
  const rank     = sheet.getLastRow(); // header = row 1, so lastRow = rank
  const totalCols = Math.max(sessionColIdx + 1, lastCol);
  const newRow   = new Array(totalCols).fill("");
  newRow[CONFIG.MONTHLY_COL_RANK]   = rank;
  newRow[CONFIG.MONTHLY_COL_HANDLE] = handle;
  newRow[CONFIG.MONTHLY_COL_COUNT]  = 1;
  newRow[sessionColIdx]             = "O";
  sheet.appendRow(newRow);
  return true;
}

// ── Summary sheet ─────────────────────────────────────────────────────────────

function updateSummarySheet(sheet, handle) {
  const startRow = CONFIG.SUMMARY_DATA_START_ROW;
  const lastRow  = sheet.getLastRow();

  if (lastRow >= startRow) {
    const ids = sheet
      .getRange(startRow, CONFIG.SUMMARY_COL_HANDLE + 1, lastRow - startRow + 1, 1)
      .getValues().flat()
      .map(v => String(v).toLowerCase().trim());
    const idx = ids.findIndex(v => v === handle.toLowerCase());

    if (idx !== -1) {
      const row       = idx + startRow;
      const countCell = sheet.getRange(row, CONFIG.SUMMARY_COL_COUNT + 1);
      countCell.setValue((Number(countCell.getValue()) || 0) + 1);
      return;
    }
  }

  // New — build row wide enough to include the Instagram URL column
  const totalCols = CONFIG.SUMMARY_COL_IG_URL + 1;
  const newRow    = new Array(totalCols).fill("");
  newRow[CONFIG.SUMMARY_COL_HANDLE] = handle;
  newRow[CONFIG.SUMMARY_COL_COUNT]  = 1;
  newRow[CONFIG.SUMMARY_COL_IG_URL] = "https://instagram.com/" + handle;
  sheet.appendRow(newRow);
}


// ── HELPERS ───────────────────────────────────────────────────────────────────

function resolveDate(raw) {
  const s = (raw || "").toString().trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (CONFIG.FALLBACK_DATE && /^\d{4}-\d{2}-\d{2}$/.test(CONFIG.FALLBACK_DATE))
    return CONFIG.FALLBACK_DATE;
  return null;
}

function cellToDateStr(val) {
  if (!val && val !== 0) return "";
  if (val instanceof Date) {
    const pad = n => String(n).padStart(2, "0");
    return val.getFullYear() + "-" + pad(val.getMonth() + 1) + "-" + pad(val.getDate());
  }
  return String(val).trim().slice(0, 10);
}

function inspectResponse() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheets = ss.getSheets().map(sheet => {
    const lastCol = sheet.getLastColumn();
    const lastRow = sheet.getLastRow();
    const rawHdrs = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    const headers = rawHdrs.map(h => h instanceof Date ? cellToDateStr(h) : String(h));
    const preview = [];
    if (lastRow > 1) {
      const n = Math.min(3, lastRow - 1);
      sheet.getRange(2, 1, n, lastCol).getValues()
        .forEach(r => preview.push(r.map(c => c instanceof Date ? cellToDateStr(c) : c)));
    }
    return { name: sheet.getName(), rows: lastRow, cols: lastCol, headers, preview };
  });
  return json({ status: "ok", sheets, config: { monthly: CONFIG.MONTHLY_SHEET, summary: CONFIG.SUMMARY_SHEET } });
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getUid(e) {
  try { return Session.getTemporaryActiveUserKey() || "anon"; }
  catch (_) { return "anon"; }
}

function isRateLimited(uid) {
  const cache = CacheService.getScriptCache();
  const key   = "rl_" + uid;
  const now   = Date.now();
  let rec;
  try { rec = JSON.parse(cache.get(key) || "null"); } catch (_) { rec = null; }
  if (!rec || now - rec.w > CONFIG.RATE_LIMIT_WINDOW_MS) {
    cache.put(key, JSON.stringify({ w: now, c: 1 }), 600);
    return false;
  }
  if (rec.c >= CONFIG.RATE_LIMIT_MAX) return true;
  rec.c++;
  cache.put(key, JSON.stringify(rec), 600);
  return false;
}

function writeLog(type, uid, detail) {
  try {
    const ss  = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    let log   = ss.getSheetByName(CONFIG.LOG_SHEET);
    if (!log) {
      log = ss.insertSheet(CONFIG.LOG_SHEET);
      log.appendRow(["Timestamp", "Event", "UID", "Detail"]);
      log.getRange(1, 1, 1, 4).setFontWeight("bold");
    }
    const d   = new Date();
    const pad = n => String(n).padStart(2, "0");
    const ts  = d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate())
              + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    log.appendRow([ts, type, uid, detail]);
  } catch (_) {}
}
