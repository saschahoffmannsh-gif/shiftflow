/* ShiftFlow – Schichtplan, Schlaf-Hinweise, Familien-Ansicht */
(() => {
"use strict";
const C = window.SF_CONFIG || {};
const DEMO = !C.supabaseUrl;
const L = window.SF_LOGIC;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const app = $("#app");

// ---------- Backend (live = Supabase, sonst Demo im Browser) ----------
function liveBackend() {
  const sb = supabase.createClient(C.supabaseUrl, C.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "sf-auth" } });
  const chk = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
  const B = {
    demo: false,
    async session() { const { data: { session } } = await sb.auth.getSession(); return session ? { uid: session.user.id } : null; },
    async signIn(username, password) {
      const { error } = await sb.auth.signInWithPassword({ email: `${username}@${C.emailDomain}`, password });
      if (error) throw new Error(/invalid/i.test(error.message) ? "Benutzername oder Passwort stimmt nicht" : /fetch|network/i.test(error.message) ? "Keine Verbindung – bitte Internet prüfen" : error.message);
    },
    async signOut() { await sb.auth.signOut().catch(() => {}); },
    async fn(action, body = {}) {
      const { data: { session } } = await sb.auth.getSession();
      let r;
      try {
        r = await fetch(`${C.supabaseUrl}/functions/v1/${C.functionName}`, {
          method: "POST",
          headers: { "content-type": "application/json", apikey: C.anonKey, authorization: `Bearer ${session?.access_token ?? C.anonKey}` },
          body: JSON.stringify({ action, ...body }),
        });
      } catch { const e = new Error("Keine Verbindung – bitte Internet prüfen"); e.offline = true; throw e; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Fehler ${r.status}`);
      return j;
    },
    async me(uid) { return chk(await sb.from("sf_profiles").select("id,username,display_name").eq("id", uid).maybeSingle()); },
    async load(uid) {
      const since = addDays(today(), -100);
      const [prefs, services, rotations, days, shares, cycle, sleep] = await Promise.all([
        sb.from("sf_prefs").select("*").eq("user_id", uid).maybeSingle(),
        sb.from("sf_services").select("*").eq("user_id", uid).limit(100),
        sb.from("sf_rotations").select("*").eq("user_id", uid).order("start_date").limit(200),
        sb.from("sf_days").select("*").eq("user_id", uid).gte("day", since).limit(3000),
        sb.from("sf_shares").select("*").eq("user_id", uid).order("created_at").limit(20),
        sb.from("sf_cycle_days").select("*").eq("user_id", uid).limit(10000),
        sb.from("sf_sleep_log").select("*").eq("user_id", uid).gte("day", addDays(today(), -60)).order("day").limit(100),
      ]);
      for (const r of [prefs, services, rotations, days, shares, cycle, sleep]) if (r.error) { const e = new Error(r.error.message); if (/fetch|network/i.test(r.error.message)) e.offline = true; throw e; }
      return { prefs: prefs.data || null, services: chk(services), rotations: chk(rotations), days: chk(days), shares: chk(shares), cycle: chk(cycle), sleep: chk(sleep) };
    },
    realtime(uid, cb) {
      const ch = sb.channel("sf-" + uid);
      for (const t of ["sf_services", "sf_rotations", "sf_cycle_days", "sf_days", "sf_prefs", "sf_sleep_log"]) ch.on("postgres_changes", { event: "*", schema: "public", table: t, filter: `user_id=eq.${uid}` }, cb);
      ch.subscribe();
      return () => sb.removeChannel(ch);
    },
    async shareView(token) { return B.fn("share_view", { token }); },
  };
  return B;
}
const API = DEMO ? window.SF_DEMO_BACKEND(C) : liveBackend();

// ---------- Helfer ----------
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const addDays = L.addDays;
const parseD = (s) => new Date(s + "T12:00:00");
const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
function dayLabel(s, long = false) {
  const t = today();
  if (s === t) return "Heute"; if (s === addDays(t, 1)) return "Morgen"; if (s === addDays(t, -1)) return "Gestern";
  return parseD(s).toLocaleDateString("de-DE", long ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short", day: "numeric", month: "short" });
}
const fullDay = (s) => parseD(s).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
const hm = (d) => (d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "");
const dayOf = (d) => ymd(d);
function whenText(d) {
  // "heute 22:00", "morgen 06:00", "Do 22:00"
  const ds = dayOf(d), t = today();
  const p = ds === t ? "heute" : ds === addDays(t, 1) ? "morgen" : ds === addDays(t, -1) ? "gestern" : parseD(ds).toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "");
  return `${p} ${hm(d)}`;
}
function inText(d) {
  const m = Math.round((+d - Date.now()) / 60000);
  if (m < 0) return "";
  if (m < 60) return `in ${m} Min.`;
  if (m < 48 * 60) { const h = Math.floor(m / 60), r = m % 60; return `in ${h} Std.${r && h < 10 ? ` ${r} Min.` : ""}`; }
  return `in ${Math.round(m / 1440)} Tagen`;
}
function toast(msg, ms = 3000) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; $("#toasts").appendChild(t); setTimeout(() => t.remove(), ms); }
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));
// Farben der eigenen Dienste: --c = Füllung, --ci = lesbare Schrift
const sty = (r) => (r && !r.free ? `style="--c:${r.color};--ci:${r.ink}"` : "");
const svSty = (sv) => `style="--c:${sv.color};--ci:${L.ink(sv.color)}"`;
// Ähnliche Dienstfarben erkennen (gewichteter RGB-Abstand „redmean“) – nur als Hinweis, es wird nie etwas automatisch geändert
const rgbOf = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
function colDist(a, b) { const x = rgbOf(a), y = rgbOf(b); if (!x || !y) return 999; const r = (x[0] + y[0]) / 2; return Math.sqrt((2 + r / 256) * (x[0] - y[0]) ** 2 + 4 * (x[1] - y[1]) ** 2 + (2 + (255 - r) / 256) * (x[2] - y[2]) ** 2); }
const SIM_COL = 90;
function similarGroups(list) {
  const g = list.map((_, i) => i), f = (i) => (g[i] === i ? i : (g[i] = f(g[i])));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (colDist(list[i].color, list[j].color) < SIM_COL) g[f(i)] = f(j);
  const m = new Map(); list.forEach((x, i) => m.set(f(i), (m.get(f(i)) || []).concat(x)));
  return [...m.values()].filter((x) => x.length > 1);
}
const svTimes = (sv) => (sv.kind === "off" ? "ganztägig" : `${sv.start_time}–${sv.end_time}`);
const services = () => (S.D?.services || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
const svById = (id) => (S.D?.services || []).find((x) => x.id === id);
const fmtD = (d, o = { day: "numeric", month: "short" }) => parseD(d).toLocaleDateString("de-DE", o);
const rangeText = (a, b) => `${fmtD(a, { weekday: "short", day: "numeric", month: "short" })} – ${fmtD(b, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}`;
const marks = (r, tr = true) => `${tr && calc && trData().m.has(r.day) ? '<i class="mk-tr" title="Wechsel-Vorbereitung"></i>' : ""}${r.custom ? '<i class="mk-time" title="abweichende Zeit"></i>' : ""}${r.note ? '<i class="mk-note"></i>' : ""}${r.override ? '<i class="mk-ovr" title="einzeln geändert"></i>' : ""}`;
const ICON = {
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  rep: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/></svg>',
  fam: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.6c2.6.1 4.4 1.7 5 4.4"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  auto: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  dots: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
};

// ---------- Theme (hell / dunkel / automatisch) ----------
const THEME_KEY = "sf-theme";
function applyTheme() {
  const t = localStorage.getItem(THEME_KEY) || "auto";
  if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.dataset.theme = t;
  const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  $('meta[name="theme-color"]').setAttribute("content", dark ? "#111114" : "#F5F5F7");
}
function cycleTheme() { const order = ["auto", "light", "dark"], cur = localStorage.getItem(THEME_KEY) || "auto"; const n = order[(order.indexOf(cur) + 1) % 3]; localStorage.setItem(THEME_KEY, n); applyTheme(); toast(n === "auto" ? "Design: automatisch (wie Gerät)" : n === "dark" ? "Design: dunkel" : "Design: hell", 1600); render(); }
const themeIcon = () => ({ auto: ICON.auto, light: ICON.sun, dark: ICON.moon })[localStorage.getItem(THEME_KEY) || "auto"];
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
applyTheme();

// ---------- Zustand + Offline-Cache ----------
const S = { uid: null, me: null, D: null, offline: false, calMode: localStorage.getItem("sf-calmode") || "month", calMonth: null, weekStart: null, unsub: null, pollT: null };
const cacheKey = () => `sf-cache3-${S.uid}`, outKey = () => `sf-outbox3-${S.uid}`; // v3: Rotation = Rhythmus
const readJ = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJ = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const outbox = () => readJ(outKey(), []);
const dismissed = () => readJ("sf-dismissed", []);
const follows = () => readJ("sf-follows", []);
let calc = null;
function rebuild() { calc = S.D ? L.create(S.D) : null; }

// Änderungen am eigenen Kalender: sofort lokal anwenden (offline-fähig), dann an den Server; ohne Netz in die Warteschlange
function applyLocal(a, b) {
  const D = S.D; if (!D) return;
  if (a === "prefs_save") D.prefs = { ...(D.prefs || {}), ...b.prefs };
  if (a === "service_save") { const ex = D.services.find((x) => x.id === b.id); D.services = D.services.filter((x) => x.id !== b.id).concat({ ...b, user_id: S.uid, short: b.short || L.autoShort(b.label), start_time: b.kind === "off" ? null : b.start_time, end_time: b.kind === "off" ? null : b.end_time, created_at: ex?.created_at || new Date().toISOString() }); }
  D.cycle = D.cycle || [];
  if (a === "service_delete") { D.services = D.services.filter((x) => x.id !== b.id); D.days = D.days.map((d) => (d.service_id === b.id ? { ...d, service_id: null, start_time: null, end_time: null } : d)); D.cycle = D.cycle.filter((x) => x.service_id !== b.id); }
  if (a === "rotation_save") {
    const ex = D.rotations.find((x) => x.id === b.id);
    D.rotations = D.rotations.filter((x) => x.id !== b.id).concat({ id: b.id, user_id: S.uid, name: b.name, start_date: b.start_date, end_date: b.end_date || null, cycle_len: b.cycle_len, created_at: ex?.created_at || new Date().toISOString() });
    D.cycle = D.cycle.filter((x) => x.rotation_id !== b.id).concat(b.cycle.map((x) => ({ ...x, rotation_id: b.id, user_id: S.uid })));
  }
  if (a === "rotation_delete") { D.rotations = D.rotations.filter((x) => x.id !== b.id); D.cycle = D.cycle.filter((x) => x.rotation_id !== b.id); }
  if (a === "day_set") {
    D.days = D.days.filter((d) => d.day !== b.day);
    D.days.push({ user_id: S.uid, day: b.day, rotation_id: null, service_id: b.service_id || null, start_time: b.start_time || null, end_time: b.end_time || null, note: b.note || null });
  }
  if (a === "day_clear") D.days = D.days.filter((d) => d.day !== b.day);
  D.sleep = D.sleep || [];
  if (a === "sleep_log_save") {
    const bd = [b.day, addDays(b.day, -1)].includes(b.bed_day) ? b.bed_day : L.diaryBedDay(b.day, b.bed, b.wake);
    D.sleep = D.sleep.filter((x) => x.day !== b.day).concat({ user_id: S.uid, day: b.day, bed_at: new Date(`${bd}T${b.bed}:00`).toISOString(), wake_at: new Date(`${b.day}T${b.wake}:00`).toISOString(), quality: Number(b.quality), naps_min: Number(b.naps_min) || 0 });
  }
  if (a === "sleep_log_delete") D.sleep = D.sleep.filter((x) => x.day !== b.day);
  if (a === "chrono_save") { const r = L.chronotype(b.answers); if (r) D.prefs = { ...(D.prefs || {}), chronotype: r.type, chrono_score: r.score, chrono_msf: r.msf, chrono_answers: b.answers, chrono_at: new Date().toISOString() }; }
  if (a === "chrono_clear") D.prefs = { ...(D.prefs || {}), chronotype: null, chrono_score: null, chrono_msf: null, chrono_answers: null, chrono_at: null };
  writeJ(cacheKey(), { D, me: S.me });
  rebuild();
}
const OFFLINE_OK = new Set(["prefs_save", "service_save", "service_delete", "rotation_save", "rotation_delete", "day_set", "day_clear", "sleep_log_save", "sleep_log_delete", "chrono_save", "chrono_clear"]);
async function write(a, b) {
  S.wseq = (S.wseq || 0) + 1;
  if (OFFLINE_OK.has(a)) applyLocal(a, b);
  try {
    if (outbox().length) await flush();
    const r = await API.fn(a, b);
    S.wseq++; // Ladevorgänge, die während des Schreibens liefen, gelten als veraltet
    return r;
  } catch (e) {
    if (e.offline && OFFLINE_OK.has(a)) { writeJ(outKey(), outbox().concat({ a, b })); S.offline = true; toast("Offline gespeichert – wird synchronisiert, sobald du wieder Netz hast", 3500); return { ok: true, queued: true }; }
    toast(e.message, 4200); reload().catch(() => {}); throw e;
  }
}
let flushing = null;
async function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    let q = outbox();
    while (q.length) {
      try { await API.fn(q[0].a, q[0].b); } catch (e) { if (e.offline) throw e; toast("Eine Offline-Änderung wurde abgelehnt: " + e.message, 4500); }
      q = q.slice(1); writeJ(outKey(), q);
    }
  })();
  try { await flushing; } finally { flushing = null; }
}

async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.dataset.l = btn.innerHTML; btn.innerHTML = '<span class="spin"></span>'; }
  try { return await fn(); }
  catch (e) { if (!e._shown) toast(e.message || String(e), 4200); throw e; }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.l; } }
}
const fd = (form) => Object.fromEntries(new FormData(form).entries());
function openSheet(html, cls = "") {
  const bd = document.createElement("div"); bd.className = "backdrop";
  const sh = document.createElement("div"); sh.className = "sheet " + cls; sh.setAttribute("role", "dialog"); sh.setAttribute("aria-modal", "true");
  sh.innerHTML = `<div class="grab"></div>${html}`;
  document.body.append(bd, sh); document.body.classList.add("noscroll");
  requestAnimationFrame(() => { bd.classList.add("in"); sh.classList.add("in"); });
  const close = () => { bd.remove(); sh.remove(); if (!$(".sheet")) document.body.classList.remove("noscroll"); };
  bd.onclick = close; sh.querySelectorAll("[data-close]").forEach((b) => (b.onclick = close));
  const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  return { sh, close };
}
function confirmSheet(title, text, okLabel = "Löschen", danger = true) {
  return new Promise((res) => {
    const { sh, close } = openSheet(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p><div class="btns"><button class="btn ghost" data-close>Abbrechen</button><button class="btn ${danger ? "danger" : ""}" id="cf-ok">${esc(okLabel)}</button></div>`);
    $("#cf-ok", sh).onclick = () => { close(); res(true); };
    sh.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => res(false)));
  });
}
async function copy(t) { try { await navigator.clipboard.writeText(t); toast("Link kopiert"); } catch { prompt("Zum Kopieren:", t); } }

// ---------- Start / Auth ----------
function route() { const h = location.hash.replace(/^#\/?/, "").split("/"); return { page: h[0] || "home", id: h[1] || null }; }
async function boot() {
  if (route().page === "f") return renderFamilyView(route().id);
  try {
    const s = await API.session();
    if (!s) return renderAuth();
    S.uid = s.uid;
    const cached = readJ(cacheKey(), null);
    try { S.me = await API.me(s.uid); } catch (e) { S.me = cached?.me || null; if (!S.me) throw e; }
    if (!S.me) { await API.signOut(); return renderAuth("Kein ShiftFlow-Profil gefunden – bitte neu registrieren."); }
    window.SF_SPLASH_NAME?.(S.me.display_name);
    await afterLogin();
  } catch (e) { console.error(e); app.innerHTML = `<div class="boot"><img src="icons/icon-192.png?v=1793522017" alt="" width="72" height="72"><p>ShiftFlow konnte nicht laden.</p><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Neu laden</button></div>`; }
}
async function afterLogin() {
  try { if (S.me?.display_name) localStorage.setItem("sf-splash-name", S.me.display_name); } catch {}
  await reload(true);
  S.unsub?.(); S.unsub = API.realtime(S.uid, debounce(() => reload().catch(() => {}), 400));
  clearInterval(S.pollT); S.pollT = setInterval(() => { if (document.visibilityState === "visible") reload().catch(() => {}); }, 60000);
  registerSW();
  if (!S.D.services.length && !S.D.rotations.length && !localStorage.getItem("sf-skip-onboarding-" + S.uid)) return renderOnboarding();
  if (!location.hash || route().page === "f") location.hash = "#/";
  render();
}
function debounce(f, ms) { let t; return () => { clearTimeout(t); t = setTimeout(f, ms); }; }
async function reload(first = false) {
  if (!S.uid) return;
  try {
    if (outbox().length) await flush();
    const seq = S.wseq || 0;
    const D = await API.load(S.uid);
    // Während des Ladens geändert? Dann wäre der Stand veraltet → nochmal laden statt lokale Änderung zu überschreiben
    if ((S.wseq || 0) !== seq && !first) { setTimeout(() => reload().catch(() => {}), 800); return; }
    S.D = D; S.offline = false;
    writeJ(cacheKey(), { D, me: S.me });
  } catch (e) {
    const c = readJ(cacheKey(), null);
    if (!c) throw e;
    if (first || !S.D) S.D = c.D;
    S.offline = true;
  }
  rebuild();
  if (first || $(".sheet")) return;
  if ($("#onb")) renderOnboarding(); else if (route().page !== "rotation") render(true);
}

function renderAuth(err = "") {
  registerSW(); // Offline-Kaltstart (Splash + Login) auch ohne Anmeldung
  let mode = localStorage.getItem("sf-known") ? "login" : "register";
  const fl = follows();
  const draw = () => {
    app.innerHTML = `<main class="auth">
      <div class="brand"><img src="icons/icon-192.png?v=1793522017" alt="" width="56" height="56"><div><h1>ShiftFlow</h1><p class="muted">Dein Schichtplan – klar, auch nach der Nacht</p></div></div>
      <h2 class="hero">Schichten im Blick.<br>Schlaf im Plan.</h2>
      <p class="muted lead">Rotation einmal anlegen, Erholungs-Hinweise bekommen und deiner Familie zeigen, wann du arbeitest, schläfst oder frei hast.</p>
      ${fl.length ? `<div class="card follows"><h3>Geteilte Pläne</h3>${fl.map((f) => `<a class="row-link" href="#/f/${esc(f.token)}"><span>👀 ${esc(f.name || "Schichtplan")}</span>${ICON.right}</a>`).join("")}</div>` : ""}
      ${DEMO ? `<div class="banner demo">Demo-Modus: Alles bleibt nur in diesem Browser. <button class="link" id="demo-fill">Mit Beispielplan ansehen</button></div>` : ""}
      <div class="seg" role="tablist"><button data-m="register" class="${mode === "register" ? "on" : ""}">Neu hier</button><button data-m="login" class="${mode === "login" ? "on" : ""}">Anmelden</button></div>
      <form id="authf" class="card form" autocomplete="on">
        ${mode === "register" ? `<label class="f" for="a-display">Dein Name</label><input class="inp" id="a-display" name="display" placeholder="z. B. Sascha" required maxlength="40" autocomplete="name">` : ""}
        <label class="f" for="a-user">Benutzername</label>
        <input class="inp" id="a-user" name="username" placeholder="z. B. sascha" required autocapitalize="none" autocomplete="username" minlength="3" maxlength="24">
        <label class="f" for="a-pw">Passwort</label>
        <input class="inp" id="a-pw" name="password" type="password" required minlength="${mode === "register" ? 8 : 1}" autocomplete="${mode === "register" ? "new-password" : "current-password"}" placeholder="${mode === "register" ? "mindestens 8 Zeichen" : ""}">
        ${mode === "register" ? `<label class="cbx"><input type="checkbox" name="consent" required><span>Ich bin einverstanden, dass mein Schichtplan gespeichert wird. Sehen kann ihn nur, wem ich selbst einen Freigabe-Link gebe.</span></label>` : ""}
        <p class="err">${esc(err)}</p>
        <button class="btn block big" type="submit">${mode === "register" ? "Konto erstellen" : "Anmelden"}</button>
      </form>
      <p class="muted small center">Keine E-Mail nötig – nur Benutzername und Passwort.</p>
    </main>`;
    $$(".seg button").forEach((b) => (b.onclick = () => { mode = b.dataset.m; err = ""; draw(); }));
    if ($("#demo-fill")) $("#demo-fill").onclick = async () => { await API.seedDemo(); location.hash = "#/"; location.reload(); };
    $("#authf").onsubmit = async (e) => {
      e.preventDefault();
      const v = fd(e.target), username = String(v.username).trim().toLowerCase(), btn = e.target.querySelector("button[type=submit]");
      try {
        await busy(btn, async () => {
          if (mode === "register") await API.fn("signup", { username, password: v.password, display_name: v.display, consent: !!v.consent });
          await API.signIn(username, v.password);
        });
        localStorage.setItem("sf-known", "1");
        const s = await API.session(); S.uid = s.uid; S.me = await API.me(s.uid);
        await afterLogin();
      } catch (ex) { const el = $(".err"); if (el) el.textContent = ex.message; }
    };
  };
  draw();
}

// ---------- Onboarding: erst Dienste, dann Rotation ----------
// Vorlauf (Aufstehen → Dienstbeginn) und Arbeitsweg – Auswahlfelder für Onboarding und Einstellungen
const LEAD_OPTS = Array.from({ length: 16 }, (_, i) => 15 + i * 15); // 15 … 240 Min.
const WAY_OPTS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 90, 105, 120];
const durTxt = (m) => (m < 60 ? `${m} Min.` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} Std.`);
function wayFields(p, pre = "p") {
  const lead = +p.lead_min || L.RULES.leadDefault, way = p.commute_min ?? L.RULES.commuteDefault;
  return `<label class="f" for="${pre}-lead">Vorlauf vor Dienstbeginn <small class="muted">(Aufstehen bis Dienstbeginn, inkl. Fertigmachen und Arbeitsweg)</small></label>
      <select class="inp" id="${pre}-lead" data-pref="lead_min">${LEAD_OPTS.map((m) => `<option value="${m}" ${lead === m ? "selected" : ""}>${durTxt(m)}${m === L.RULES.leadDefault ? " (Standard)" : ""}</option>`).join("")}</select>
      <label class="f" for="${pre}-way">Davon Arbeitsweg <small class="muted">(gilt auch als Heimweg nach Dienstende)</small></label>
      <select class="inp" id="${pre}-way" data-pref="commute_min">${WAY_OPTS.map((m) => `<option value="${m}" ${+way === m ? "selected" : ""}>${m ? durTxt(m) : "kein Weg (Homeoffice)"}${m === L.RULES.commuteDefault ? " (Standard)" : ""}</option>`).join("")}</select>
      <p class="muted small note">Beispiel: Dienst 06:00, Vorlauf 1:30 Std. → <b>Wecker 04:30</b>. Schlafzeiten, Runterfahren, Kaffee-Cutoff und Vorschlaf richten sich nach der Weckzeit. Einzelne Dienste können unter <b>Mehr › Plan</b> einen eigenen Vorlauf haben.</p>`;
}
function bindPrefSelects(root) {
  $$("[data-pref]", root).forEach((el) => (el.onchange = () => { const v = el.type === "checkbox" ? el.checked : Number(el.value); write("prefs_save", { prefs: { [el.dataset.pref]: v } }).then(() => toast("Gespeichert", 1200)).catch(() => {}); }));
}
function renderOnboarding() {
  window.scrollTo(0, 0);
  const n = services().length;
  app.innerHTML = `<main class="auth" id="onb">
    <p class="step">Fast geschafft</p>
    <h2 class="hero sm">Hallo ${esc(S.me?.display_name || "")}!<br>So legst du deinen Plan an:</h2>
    <div class="card steps">
      <div class="st ${n ? "done" : ""}"><span class="num">${n ? "✓" : "1"}</span><div><b>Deine Dienste festlegen</b><p class="muted small">Bezeichnung, Farbe und Zeit – z. B. „Früh 06:00–14:00“. Einmal anlegen, überall wiederverwenden.</p></div></div>
      <div class="st"><span class="num">2</span><div><b>Weg zur Arbeit</b><p class="muted small">Wie lange vor Dienstbeginn stehst du auf? Daraus rechnet ShiftFlow deinen Wecker.</p></div></div>
      <div class="st"><span class="num">3</span><div><b>Rotation anlegen</b><p class="muted small">Starttag wählen und einen Durchgang (z. B. 5 Wochen) Tag für Tag eintragen – er wiederholt sich automatisch.</p></div></div>
    </div>
    <div class="card" id="onb-way"><h3>⏰ Weg zur Arbeit</h3>${wayFields(S.D?.prefs || {}, "o")}</div>
    <button class="btn block big" id="onb-go">${n ? "Rotation anlegen" : `${ICON.plus} Ersten Dienst anlegen`}</button>
    ${n ? `<div class="chips onb-svcs">${services().map((sv) => `<span class="chip svc on" ${svSty(sv)}>${esc(sv.label)} · ${esc(svTimes(sv))}</span>`).join("")}<button class="chip" id="onb-more">${ICON.plus} Weiterer Dienst</button></div>` : ""}
    <p class="center"><button class="link" id="skip">Später einrichten</button> · <button class="link" id="lo">Abmelden</button></p>
  </main>`;
  bindPrefSelects($("#onb-way"));
  $("#onb-go").onclick = () => (n ? newRotation() : serviceEditor(null, () => renderOnboarding()));
  if ($("#onb-more")) $("#onb-more").onclick = () => serviceEditor(null, () => renderOnboarding());
  $("#skip").onclick = () => { localStorage.setItem("sf-skip-onboarding-" + S.uid, "1"); location.hash = "#/"; render(); };
  $("#lo").onclick = logout;
}
async function logout() { S.unsub?.(); S.unsub = null; clearInterval(S.pollT); await unsubscribePush(true); await API.signOut(); S.uid = S.me = S.D = null; S.draft = undefined; try { localStorage.removeItem("sf-splash-name"); } catch {} calc = null; history.replaceState(null, "", location.pathname); renderAuth(); }

// ---------- Layout ----------
// 4 Punkte wie im Entwurf: Plan, Familie und Quellen liegen unter „Mehr“, der Chronotyp unter „Schlaf“
const NAV = [["home", "#/", "Heute", ICON.home], ["kalender", "#/kalender", "Kalender", ICON.cal], ["schlaf", "#/schlaf", "Schlaf", ICON.moon], ["mehr", "#/mehr", "Mehr", ICON.dots]];
const NAV_OF = { quellen: "mehr", plan: "mehr", familie: "mehr", chronotyp: "schlaf" };
const pageCtx = (pg) => ({ home: fullDay(today()), kalender: "Dienstplan", schlaf: "Schlaf-Tagebuch", chronotyp: "Schlaf", plan: "Mehr", familie: "Mehr", mehr: "Profil & Einstellungen", quellen: "Wissen" })[pg] || "";
function render(soft = false) {
  if (!S.D || !S.uid) return;
  const r = route();
  if (r.page === "f") return renderFamilyView(r.id);
  if (S.draft === undefined) S.draft = readJ(draftKey(), null);
  if (r.page === "rotation") return renderRotationEditor(r.id);
  document.body.classList.remove("has-palette");
  if (S.draft && !S.draft.dirty) S.draft = null;
  const pages = { home: pageHome, kalender: pageCal, plan: pagePlan, familie: pageFamily, mehr: pageMore, quellen: pageSources, schlaf: pageSleep, chronotyp: pageChrono };
  const pg = pages[r.page] ? r.page : "home";
  const y = window.scrollY;
  app.innerHTML = `<header class="top"><img src="icons/icon-192.png?v=1793522017" alt="ShiftFlow" width="30" height="30"><span class="ctx">${esc(pageCtx(pg))}</span>
      ${S.offline ? `<span class="pill off" title="Änderungen werden später synchronisiert">Offline${outbox().length ? ` · ${outbox().length}` : ""}</span>` : ""}
      <span class="sp"></span><button class="iconbtn" id="theme" aria-label="Hell/Dunkel umschalten">${themeIcon()}</button></header>
    <main id="page" class="page">${pages[pg]()}</main>
    <nav class="nav">${NAV.map(([k, h, l, i]) => `<a href="${h}" class="${k === (NAV_OF[pg] || pg) ? "on" : ""}" data-nav="${k}" ${k === (NAV_OF[pg] || pg) ? 'aria-current="page"' : ""}>${i}<span>${l}</span></a>`).join("")}</nav>`;
  $("#theme").onclick = cycleTheme;
  bindPage(pg);
  if (soft) window.scrollTo(0, y); else window.scrollTo(0, 0);
}
function bindPage(pg) {
  const root = $("#page");
  $$("[data-day]", root).forEach((el) => (el.onclick = () => daySheet(el.dataset.day)));
  $$("[data-act]", root).forEach((el) => (el.onclick = (e) => { e.preventDefault(); act(el.dataset.act, el); }));
  $$("details.fold[id]", root).forEach((d) => (d.ontoggle = () => { const f = readJ("sf-folds", {}); f[d.id] = d.open; writeJ("sf-folds", f); }));
  if (pg === "mehr") bindMore(root);
  if (pg === "schlaf") bindPrefSelects(root);
  if (pg === "chronotyp") bindChrono(root);
  if (pg === "quellen") { const f = $(".rule.focus", root); if (f) setTimeout(() => f.scrollIntoView({ block: "center" }), 50); }
  if (pg === "familie") bindFamily(root);
  if (pg === "plan") {
    $$("[data-rot]", root).forEach((el) => (el.onclick = () => openRotation(el.dataset.rot)));
    $$("[data-svc]", root).forEach((el) => (el.onclick = () => serviceEditor(svById(el.dataset.svc))));
  }
}
async function act(a, el) {
  switch (a) {
    case "dismiss": { writeJ("sf-dismissed", dismissed().concat(el.dataset.id).slice(-200)); el.closest(".hint")?.classList.add("gone"); setTimeout(() => render(true), 220); return; }
    case "src": { const t = document.getElementById("src-" + el.dataset.id); if (t) { t.scrollIntoView({ behavior: "smooth", block: "center" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 1500); } return; }
    case "undismiss": writeJ("sf-dismissed", []); return render(true);
    case "cal-mode": S.calMode = el.dataset.m; localStorage.setItem("sf-calmode", S.calMode); return render(true);
    case "cal-prev": case "cal-next": {
      const k = a === "cal-prev" ? -1 : 1;
      if (S.calMode === "month") { const [y, m] = (S.calMonth || today().slice(0, 7)).split("-").map(Number); const d = new Date(y, m - 1 + k, 1); S.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
      else S.weekStart = addDays(S.weekStart || mondayOf(today()), 7 * k);
      return render(true);
    }
    case "cal-today": S.calMonth = null; S.weekStart = null; return render(true);
    case "new-rotation": return newRotation();
    case "new-service": return serviceEditor(null);
    case "resume-draft": location.hash = "#/rotation/" + S.draft.id; return;
    case "go": location.hash = el.dataset.href; return;
    case "fp-day": S.fpDay = Number(el.dataset.d); { const y = window.scrollY; $("#fahrplan").outerHTML = fahrplanCard(); bindPage("home"); window.scrollTo(0, y); } return;
    case "diary": return diarySheet(el.dataset.d);
    case "simhint-x": writeJ("sf-simhint", el.dataset.k); return render(true);
  }
}

// ---------- Bausteine ----------
const rotTag = (r) => (r.custom ? `<span class="tagx">⏱ abweichend</span>` : r.override ? `<span class="tagx">✎ geändert</span>` : "");
function shiftTile(r, opts = {}) {
  const now = new Date(), live = r.start && +r.start <= +now && +now < +r.end;
  const sub = r.start ? `${hm(r.start)} – ${hm(r.end)}` : r.off ? "ganztägig" : r.rotation ? "Kein Dienst" : services().length ? "Kein Dienst eingetragen" : "Noch kein Plan";
  return `<button class="tile big ${r.free ? "free" : "svc"} ${opts.cls || ""}" ${sty(r)} data-day="${r.day}">
    <div class="tile-top"><span class="lbl">${esc(opts.label || dayLabel(r.day))}</span>${rotTag(r)}</div>
    <div class="tile-main"><span class="badge">${r.free ? "🌿" : esc(r.short)}</span><div><b>${esc(r.label)}</b><span class="times">${sub}</span></div></div>
    ${live ? `<div class="tile-foot">Läuft – noch bis ${hm(r.end)}</div>` : opts.foot ? `<div class="tile-foot">${opts.foot}</div>` : ""}
    ${r.custom ? `<div class="tile-note">${ICON.clock} Abweichende Zeit (sonst ${esc(r.def.s)}–${esc(r.def.e)})</div>` : ""}
    ${r.note ? `<div class="tile-note">📝 ${esc(r.note)}</div>` : ""}
  </button>`;
}
function weekStrip(from, n = 7) {
  return `<div class="strip">${calc.range(from, addDays(from, n - 1)).map((r) => `<button class="sday ${r.free ? "free" : "svc"} ${r.day === today() ? "today" : ""}" ${sty(r)} data-day="${r.day}"><span>${WD[(parseD(r.day).getDay() + 6) % 7]}</span><b>${r.free ? "–" : esc(r.short)}</b><small>${parseD(r.day).getDate()}.</small>${marks(r)}</button>`).join("")}</div>`;
}
const mondayOf = (d) => addDays(d, -((parseD(d).getDay() + 6) % 7));
const hintHtml = (h) => `<div class="hint ${h.level}"><span class="hi">${h.icon}</span><div class="hb"><b>${esc(h.title)}</b><p>${esc(h.text)}</p>${h.src ? `<a class="srcl" href="#/quellen/${esc(h.src)}">Quelle</a>` : ""}</div><button class="iconbtn sm" data-act="dismiss" data-id="${esc(h.id)}" aria-label="Erledigt">${ICON.check}</button></div>`;
const DISCLAIMER = `<p class="muted small center disclaimer">Hinweise sind allgemeine Tipps zur Schlafhygiene – keine medizinische Beratung. <a href="#/quellen">Quellen</a></p>`;
// Faustregeln der App in Klartext + Quellen (RULES/SOURCES aus logic.js)
function pageSources() {
  const R = L.RULES, src = new Map(L.SOURCES.map((x) => [x.id, x])), focus = route().id;
  const rule = (icon, title, text, ids) => `<div class="card rule ${focus && (L.HINT_SRC[focus] || [])[0] && ids.includes(L.HINT_SRC[focus][0]) ? "focus" : ""}"><h3>${icon} ${esc(title)}</h3><p>${esc(text)}</p><p class="small refs">${ids.map((i) => `<button class="link small" data-act="src" data-id="${i}">${esc(src.get(i).org)}${src.get(i).year ? " " + src.get(i).year : ""}</button>`).join("")}</p></div>`;
  return `<button class="link back" data-act="go" data-href="#/mehr">‹ Mehr</button><section class="hello"><h1>Quellen</h1><p class="muted">Woher die Faustregeln in ShiftFlow kommen. Allgemeine Tipps – keine medizinische Beratung. Bei anhaltenden Schlafproblemen ärztlich abklären lassen.</p></section>
    ${rule("😴", "Schlafmenge", `Mind. ${R.sleepMin} Std. Schlaf; bei Schichtarbeit 7–9 Std. pro 24 Std., auch aufgeteilt in Haupt- und Kurzschlaf.`, ["duration", "shift-hygiene"])}
    ${rule("⚠️", "Ruhezeit zwischen Diensten", `Mind. ${R.restMin} Std. (§ 5 ArbZG). Kürzere Wechsel („Quick Returns“) gehen mit deutlich weniger Schlaf und mehr Müdigkeit einher.`, ["rest", "quick-returns", "quick-returns-diary"])}
    ${rule("🌙", "Nachtdienste am Stück", `Möglichst höchstens ${R.nightsMax} Nächte hintereinander; Schichtfolge möglichst vorwärts (Früh → Spät → Nacht).`, ["rkw", "baua", "s2k"])}
    ${rule("🛌", "Erholung nach Nächten", `Nach einer Nachtphase mind. ${R.afterNightsMin} Std. frei, besser ${R.afterNightsGood} Std.`, ["baua"])}
    ${rule("💤", "Vorschlaf vor der Nacht", `Vor der ersten Nacht ca. 90 Min. schlafen (sonst 20 Min.). Danach braucht man 15–30 Min., um richtig wach zu werden – ShiftFlow legt den Vorschlaf deshalb so, dass er vor deinem Vorlauf endet (mind. Arbeitsweg + 30 Min. vor Dienstbeginn).`, ["dgsm", "niosh-nap", "shift-hygiene"])}
    ${rule("🌗", "Licht & Essen in der Nacht", "Helles Licht in der ersten Schichthälfte, gegen Ende gedämpfter. Hauptmahlzeit vor dem Dienst, zwischen 0 und 6 Uhr nur leicht essen. Am müdesten ist man zwischen 2 und 5 Uhr.", ["niosh-light", "niosh-food", "dgsm"])}
    ${rule("⏰", "Weckzeit, Arbeitsweg & Heimweg", "Wer um 6 Uhr anfängt, steht oft schon um 4:30 auf. ShiftFlow rechnet mit deiner Weckzeit (Dienstbeginn minus Vorlauf) statt mit dem Dienstbeginn und zieht nach Dienstende den Heimweg ab. Die gesetzliche Ruhezeit (11 Std.) zählt dagegen von Dienstende bis Dienstbeginn – die echte Schlafgelegenheit ist also kürzer.", ["rest", "quick-returns", "niosh-nap"])}
    ${rule("🚗", "Heimweg nach der Nacht", "Nach Nachtdiensten ist Müdigkeit am Steuer deutlich häufiger. Sehr müde: nicht selbst fahren. Ist es schon hell, hilft eine Sonnenbrille (zum Fahren nur Kategorie 1–2), das Morgenlicht zu dämpfen.", ["drive", "niosh-light"])}
    ${rule("🏠", "Tagschlaf", "Direkt nach Hause und ins Bett; Zimmer dunkel, ruhig und kühl (ca. 16–20 °C).", ["niosh-sleep", "shift-hygiene", "dgsm"])}
    ${rule("🔄", "Zurück in den Tag-Rhythmus", `Nach der letzten Nacht nur kurz schlafen (ShiftFlow: ca. ${L.hours(R.recoverMin / 60)}), tagsüber ans Licht, abends früher ins Bett.`, ["shift-hygiene"])}
    ${rule("☕", "Koffein", `Kaffee wirkt lange nach: Standard in ShiftFlow ist der letzte Kaffee ${R.cafDefault} Std. vor dem Schlafen. Wer empfindlich ist, wählt eher 8–9 Std. (Gardiner 2023) – einstellbar unter „Mehr“.`, ["caffeine", "caffeine-6h"])}
    <h2 class="sec">Schlaf-Strategien (Fahrplan)</h2>
    ${rule("🕶️", "Licht gezielt steuern", "Licht ist der stärkste Taktgeber der inneren Uhr. In der Nacht: helles Licht in der ersten Schichthälfte. Auf dem Heimweg nach der Nacht morgendliches Tageslicht meiden – mit (straßentauglicher, Kat. 1–2) Sonnenbrille, wenn es schon hell ist; danach Zimmer verdunkeln. Vor Frühdiensten: morgens Licht, abends dimmen.", ["eastman-1994", "burgess-2002", "smith-2009", "niosh-light"])}
    ${rule("🪜", "Schrittweise umstellen", `Die innere Uhr verschiebt sich nur ca. 1 Std. pro Tag. ShiftFlow plant daher an freien Tagen vor Nächten bzw. Frühdiensten schrittweise ${L.RULES.stepMin} Min. pro Tag – wie viele Tage, hängt vom Chronotyp ab.`, ["eastman-burgess-2009", "burgess-2002", "juda-2013"])}
    ${rule("⚡", "Powernap", `Kurzschlaf von 10–${L.RULES.powerNapMin} Min. (spätestens ${L.RULES.powerNapLatest} Uhr) steigert Wachheit, ohne den Nachtschlaf zu stören. Längere Naps führen zu Schlaftrunkenheit.`, ["brooks-lack-2006", "ruggiero-2014", "niosh-nap"])}
    ${rule("🍽️", "Essen nach der Uhr (Chrononutrition)", `Hauptmahlzeiten in die Wachphase am Tag legen; nachts nur Kleinigkeiten. Letzte größere Mahlzeit ca. ${L.RULES.mealGapH} Std. vor dem Schlaf. Nächtliches Essen verschlechtert die Glukosetoleranz.`, ["chellappa-2021", "niosh-food"])}
    ${rule("🧬", "Chronotyp", "Lerchen kommen mit Frühdiensten besser klar, Eulen mit Nächten. Die Passung von Chronotyp und Schicht verbessert Schlafdauer und -qualität. Der Test ist eine Kurzform (rMEQ + MCTQ-Fragen) – keine Diagnose.", ["rmeq", "mctq", "juda-2013", "vetter-2015"])}
    ${rule("📉", "Schlafschuld", "Zu wenig Schlaf summiert sich über Tage; die Leistung sinkt weiter, während man sich subjektiv an die Müdigkeit gewöhnt. Das Tagebuch rechnet die Differenz zu deinem Schlafbedarf über 7 und 14 Tage.", ["van-dongen-2003", "duration"])}
    <h2 class="sec">Alle Quellen</h2>
    <div class="card srclist"><ol>${L.SOURCES.map((x) => `<li id="src-${x.id}"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a><br><span class="muted small">${esc(x.org)}${x.year ? ` (${x.year})` : ""} – ${esc(x.use)}</span></li>`).join("")}</ol></div>
    <button class="btn block soft" data-act="go" data-href="#/mehr">Zurück</button>
    ${DISCLAIMER}`;
}

// ---------- v8: Schlaf & Gesundheit ----------
const PUSH_TYPES = [
  ["push_shift", "⏰ Aufstehen & Abfahrt", "Zur Weckzeit: Dienstbeginn und Abfahrt (ersetzt keinen Wecker)."],
  ["push_nap", "😴 Vorschlaf & Powernap", "15 Min. vor dem Vorschlaf vor der ersten Nacht und zum Powernap nach dem Frühdienst."],
  ["push_winddown", "🕯️ Runterfahren", "1 Std. vor dem Schlafen: Licht dimmen, Bildschirm weg."],
  ["push_bed30", "🛏️ In 30 Min. ins Bett", "Kurz vor deinem geplanten Schlaf."],
  ["push_caffeine", "☕ Letzter Kaffee", "Zu deinem Koffein-Stopp (Standard 6 Std. vor dem Schlaf)."],
  ["push_light", "🕶️ Heimweg nach der Nacht", "15 Min. vor Dienstende: Sonnenbrille (wenn es schon hell ist) bzw. Licht klein halten."],
  ["push_diary", "📓 Tagebuch am Morgen", "30 Min. nach dem Aufwachen – nur, wenn noch nichts eingetragen ist."],
];
const PREF_DEF = { sleep_need: 7.5, caffeine_h: L.RULES.cafDefault, lead_min: L.RULES.leadDefault, commute_min: L.RULES.commuteDefault, hint_caffeine: true, hint_light: true, push_winddown: true, push_caffeine: false, push_light: true, push_shift: false, push_nap: true, push_bed30: false, push_diary: false };
const prefs = () => ({ ...PREF_DEF, ...(S.D?.prefs || {}) });
const srcLink = (k, label = "Quelle") => (k && L.HINT_SRC[k] ? `<a class="srcl" href="#/quellen/${esc(k)}">${label}</a>` : "");
const hrs = (h) => (h === null || h === undefined ? "–" : `${(Math.round(h * 10) / 10).toLocaleString("de-DE")} Std.`);
// Wechsel-Strategien: sichtbar ab dem ersten Vorbereitungstag
let trCache = { k: null, m: null, list: [] };
function trData() {
  const k = today() + "|" + (S.wseq || 0) + "|" + JSON.stringify(S.D?.prefs?.chronotype || "") + (calc ? calc.need : "");
  if (trCache.k !== k || trCache.c !== calc) {
    const list = calc ? calc.transitions(today(), 45) : [], m = new Map();
    for (const t of list) for (const s of t.steps) { if (!m.has(s.day)) m.set(s.day, []); m.get(s.day).push({ ...s, tr: t }); }
    trCache = { k, c: calc, m, list };
  }
  return trCache;
}
function transHtml(tr) {
  const t = today();
  return `<div class="hint trcard ${tr.level}" id="${esc(tr.id)}"><span class="hi">${tr.icon}</span><div class="hb"><b>${esc(tr.title)}</b><p>${esc(tr.text)}</p>
    <ol class="steps">${tr.steps.map((s) => `<li class="${s.day === t ? "now" : s.day < t ? "past" : ""}"><span class="sd">${esc(dayLabel(s.day))}</span><div><b>${esc(s.title)}</b><small>${esc(s.text)}</small></div></li>`).join("")}</ol>
    ${srcLink(tr.src)}</div><button class="iconbtn sm" data-act="dismiss" data-id="${esc(tr.id)}" aria-label="Erledigt">${ICON.check}</button></div>`;
}
// Tagesfahrplan: 24-Std.-Band + Liste
const FP_LANE = { sleep: 0, nap: 0, powernap: 0, shift: 1, light: 2, dark: 2, meal: 3, fast: 3 };
function planHtml(day) {
  const P = calc.dayPlan(day), d0 = +P.d0, span = +P.d1 - d0, now = Date.now();
  const pos = (t) => Math.max(0, Math.min(100, ((+t - d0) / span) * 100));
  const segs = P.items.filter((x) => x.end && FP_LANE[x.type] !== undefined).map((x) => `<i class="fseg s-${x.type}" style="left:${pos(x.start).toFixed(2)}%;width:${Math.max(0.8, pos(x.end) - pos(x.start)).toFixed(2)}%;top:${FP_LANE[x.type] * 14 + 4}px;${x.type === "shift" && x.color ? `--c:${x.color}` : ""}" title="${esc(x.title)}"></i>`).join("");
  const pts = P.items.filter((x) => !x.end).map((x) => `<span class="pt" style="left:${pos(x.start).toFixed(2)}%" title="${esc(x.title)}">${x.icon}</span>`).join("");
  const nowL = now >= d0 && now < d0 + span ? `<i class="nowl" style="left:${pos(now).toFixed(2)}%"></i>` : "";
  const tm = (x) => { const a = hm(x.start), b = x.end ? hm(x.end) : ""; const sd = dayOf(x.start) !== day ? (dayOf(x.start) < day ? "Vortag " : "") : ""; return x.end ? `${sd}${a}–${b}` : a; };
  return `<div class="fp-band" aria-hidden="true">${segs}${pts}${nowL}<div class="fp-hours"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div></div>
    <div class="fp-leg"><span><i class="s-sleep"></i>Schlaf</span><span><i class="s-shift"></i>Dienst</span><span><i class="s-light"></i>Licht suchen</span><span><i class="s-dark"></i>Licht meiden</span><span><i class="s-meal"></i>Essen</span></div>
    <ul class="fp-list">${P.items.filter((x) => x.type !== "shift" || true).map((x) => `<li class="fp-${x.type} ${x.end && +x.end < now ? "done" : !x.end && +x.start < now - 15 * 60e3 ? "done" : ""}"><span class="ft">${tm(x)}</span><span class="fi">${x.icon}</span><div><b>${esc(x.title)}${x.optional ? ' <em class="optb">optional</em>' : ""}</b><small>${esc(x.text)}</small>${srcLink(x.src)}</div></li>`).join("")}</ul>`;
}
function fahrplanCard() {
  const t = today(), sel = S.fpDay === 1 ? addDays(t, 1) : t;
  return `<section class="card fp" id="fahrplan"><div class="fp-head"><h3>🧭 Dein Fahrplan</h3><div class="seg small"><button data-act="fp-day" data-d="0" class="${S.fpDay === 1 ? "" : "on"}">Heute</button><button data-act="fp-day" data-d="1" class="${S.fpDay === 1 ? "on" : ""}">Morgen</button></div></div>
    <p class="muted small">${esc(fullDay(sel))}${calc.chrono ? ` · ${calc.chrono.icon} ${esc(calc.chrono.label)}` : ""} – Schlaf, Licht, Koffein und Essen passend zu deinen Diensten, Vorlauf und Arbeitsweg.</p>
    ${planHtml(sel)}</section>`;
}
// Tagebuch
const sleepLog = () => (S.D?.sleep || []).slice().sort((a, b) => a.day.localeCompare(b.day));
const logFor = (day) => sleepLog().find((x) => x.day === day);
const QUAL = [[1, "😫", "sehr schlecht"], [2, "😕", "schlecht"], [3, "😐", "okay"], [4, "🙂", "gut"], [5, "😴", "sehr gut"]];
function diaryPrompt() {
  const t = today(), d = calc.diaryDefaults(t), wake = new Date(`${t}T${d.wake}:00`);
  if (logFor(t) || Date.now() < +wake) return "";
  return `<button class="diaryrow" data-act="diary" data-d="${t}" id="diary-prompt"><span>📓</span><span class="sb">Wie hast du geschlafen? <b>Kurz eintragen</b></span><span class="chev" aria-hidden="true">›</span></button>`;
}
function diarySheet(day) {
  day = day || today();
  const ex = logFor(day), d = calc.diaryDefaults(day);
  const st = ex ? { bed: hm(new Date(ex.bed_at)), wake: hm(new Date(ex.wake_at)), q: Number(ex.quality), naps: Number(ex.naps_min) || 0, bedDay: dayOf(new Date(ex.bed_at)) } : { bed: d.bed, wake: d.wake, q: 0, naps: 0, bedDay: d.bedDay };
  const { sh, close } = openSheet(`<div class="sheet-head"><h2>📓 Schlaf-Tagebuch</h2><p class="muted">Aufgewacht am</p></div>
    <form id="dlf" class="form">
      <input class="inp" type="date" name="day" id="dl-day" value="${day}" max="${today()}" min="${addDays(today(), -60)}" required>
      <div class="row2"><div><label class="f" for="dl-bed">Ins Bett</label><input class="inp" type="time" id="dl-bed" name="bed" value="${esc(st.bed)}" required></div>
        <div><label class="f" for="dl-wake">Aufgewacht</label><input class="inp" type="time" id="dl-wake" name="wake" value="${esc(st.wake)}" required></div></div>
      <p class="muted small" id="dl-dur"></p>
      <p class="f">Wie gut war der Schlaf?</p>
      <div class="qpick">${QUAL.map(([v, e, l]) => `<button type="button" class="qb ${st.q === v ? "on" : ""}" data-q="${v}" aria-label="${l}"><span>${e}</span><small>${v}</small></button>`).join("")}</div>
      <label class="f" for="dl-nap">Nickerchen tagsüber <span class="muted small">(optional)</span></label>
      <select class="inp" id="dl-nap" name="naps">${[0, 10, 15, 20, 30, 45, 60, 90, 120].map((m) => `<option value="${m}" ${st.naps === m ? "selected" : ""}>${m ? m + " Min." : "keins"}</option>`).join("")}</select>
      <div class="btns">${ex ? `<button type="button" class="btn ghost danger-t" id="dl-del">Löschen</button>` : `<button type="button" class="btn ghost" data-close>Abbrechen</button>`}<button class="btn" type="submit">Speichern</button></div>
    </form>`);
  const upd = () => {
    const dd = $("#dl-day", sh).value, b = $("#dl-bed", sh).value, w = $("#dl-wake", sh).value;
    if (!dd || !b || !w) return;
    const bd = L.diaryBedDay(dd, b, w), h = (new Date(`${dd}T${w}:00`) - new Date(`${bd}T${b}:00`)) / 36e5;
    $("#dl-dur", sh).textContent = `${bd === dd ? "Gleicher Tag" : "Ins Bett am Vortag"} · ${hrs(h)} Schlaf`;
  };
  ["#dl-day", "#dl-bed", "#dl-wake"].forEach((s) => ($(s, sh).oninput = upd)); upd();
  $("#dl-day", sh).onchange = () => { const v = $("#dl-day", sh).value; if (v && v !== day) { close(); diarySheet(v); } };
  $$("[data-q]", sh).forEach((b) => (b.onclick = () => { st.q = Number(b.dataset.q); $$("[data-q]", sh).forEach((x) => x.classList.toggle("on", x === b)); }));
  if ($("#dl-del", sh)) $("#dl-del", sh).onclick = async (e) => { const r = await busy(e.currentTarget, () => write("sleep_log_delete", { day })).catch(() => null); if (r) { close(); render(true); toast("Eintrag gelöscht"); } };
  $("#dlf", sh).onsubmit = async (e) => {
    e.preventDefault();
    if (!st.q) return toast("Bitte Schlafqualität 1–5 wählen");
    const f = fd(e.target), body = { day: f.day, bed: f.bed, wake: f.wake, quality: st.q, naps_min: Number(f.naps) || 0 };
    const r = await busy(e.target.querySelector("[type=submit]"), () => write("sleep_log_save", body)).catch(() => null);
    if (!r) return; close(); render(true); toast(r.queued ? "Gespeichert (offline)" : "Eingetragen 👍");
  };
}
function chartHtml(st) {
  const W = 340, Hh = 150, top = 10, bot = 30, max = 12, bw = W / 14;
  const y = (h) => top + (Hh - top - bot) * (1 - Math.min(max, h) / max);
  const bars = st.series.map((x, i) => {
    const cx = i * bw + bw / 2, lbl = WD[(parseD(x.day).getDay() + 6) % 7].slice(0, 2);
    const bar = x.total === null ? `<circle cx="${cx}" cy="${Hh - bot - 3}" r="2.5" class="ch-miss"/>`
      : `<rect x="${(cx - bw * 0.32).toFixed(1)}" y="${y(x.total).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${(Hh - bot - y(x.total)).toFixed(1)}" rx="3" class="ch-bar ${x.total < st.need - 0.25 ? "low" : "ok"}${i === st.series.length - 1 ? " last" : ""}"><title>${esc(fullDay(x.day))}: ${hrs(x.total)}, Qualität ${x.quality}/5</title></rect>`;
    return `${bar}<text x="${cx}" y="${Hh - bot + 13}" class="ch-x">${lbl}</text><text x="${cx}" y="${Hh - bot + 25}" class="ch-s">${esc(x.label || "")}</text>`;
  }).join("");
  const grid = [0, 4, 8, 12].map((h) => `<line x1="0" x2="${W}" y1="${y(h)}" y2="${y(h)}" class="ch-grid"/><text x="2" y="${y(h) - 2}" class="ch-y">${h}</text>`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Schlafdauer der letzten 14 Tage">${grid}${bars}<line x1="0" x2="${W}" y1="${y(st.need)}" y2="${y(st.need)}" class="ch-need"/><text x="${W - 2}" y="${y(st.need) - 3}" class="ch-nl">Bedarf ${String(st.need).replace(".", ",")}</text></svg>`;
}
function statBox(w, label) {
  const debt = w.debt, cls = !w.count ? "" : debt > 3 ? "bad" : debt > 0.5 ? "warn" : "good";
  return `<div class="stat ${cls}"><span class="lbl">${label}</span><b>${w.count ? (debt > 0.05 ? `−${hrs(debt)}` : debt < -0.05 ? `+${hrs(-debt)}` : "± 0").replace(" Std.", "<em> Std.</em>") : "–"}</b><small>${w.count ? `Ø ${hrs(w.avg)} · ${w.count} von ${w.days} Tagen` : "noch keine Einträge"}</small></div>`;
}
function pageSleep() {
  const st = calc.sleepStats(sleepLog(), today()), p = prefs(), ch = calc.chrono, t = today(), ex = logFor(t);
  const recent = sleepLog().filter((x) => x.day >= addDays(t, -13)).reverse();
  const worst = st.byType.slice().sort((a, b) => a.avg - b.avg)[0];
  return `<section class="hello"><h1>Schlaf</h1><p class="muted">Tagebuch, Schlafschuld und dein Chronotyp.</p></section>
    <button class="card diary-cta ${ex ? "done" : ""}" data-act="diary" data-d="${t}" id="diary-today"><span class="ic">📓</span><div class="sb"><b>${ex ? `Heute eingetragen: ${hrs(calc.sleepEntry(ex).total)}` : "Wie hast du heute geschlafen?"}</b><small>${ex ? `${hm(new Date(ex.bed_at))}–${hm(new Date(ex.wake_at))} · Qualität ${ex.quality}/5 – tippen zum Ändern` : "Bettzeit, Aufwachen, Qualität – 10 Sekunden"}</small></div><span class="chev" aria-hidden="true">›</span></button>
    <div id="sleep-stats">
      <div class="stats-h"><span class="lbl">Schlafschuld</span><small>${srcLink("debt")}</small></div>
      <div class="stats">${statBox(st.w7, "7 Tage")}${statBox(st.w14, "14 Tage")}</div>
      <div class="card chcard"><div class="tlhead"><span class="lbl">Letzte 14 Tage</span><small class="muted">Stunden pro Nacht</small></div>
        ${chartHtml(st)}
        <p class="muted small">Schlafschuld = Summe aus (Bedarf − Schlaf inkl. Nickerchen) über die eingetragenen Tage. Sie summiert sich – man merkt sie selbst oft nicht (Van Dongen 2003).</p>
        <label class="f" for="s-need">Dein Schlafbedarf</label><select class="inp" id="s-need" data-pref="sleep_need">${[5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((h) => `<option value="${h}" ${+p.sleep_need === h ? "selected" : ""}>${String(h).replace(".", ",")} Stunden${h === 7.5 ? " (Standard)" : ""}</option>`).join("")}</select>
      </div>
    </div>
    ${fold("fold-bytype", `📊 Nach Dienstart <small>· ${worst ? `am wenigsten nach ${esc(worst.label)}: ${hrs(worst.avg)}` : "noch zu wenig Daten"}</small>`, `<div class="card" id="by-type"><p class="muted small">Letzte 4 Wochen, nach Aufwach-Tag.</p>
      ${st.byType.length ? `<table class="bt"><thead><tr><th>Tag</th><th>Ø Schlaf</th><th>Qualität</th><th>n</th></tr></thead><tbody>${st.byType.map((g) => `<tr><td><span class="tchip" ${g.color ? `style="--c:${g.color};--ci:${L.ink(g.color)}"` : ""}>${esc(g.label)}</span></td><td class="${g.avg < st.need - 0.25 ? "low" : ""}">${hrs(g.avg)}</td><td>${"●".repeat(Math.round(g.quality))}<span class="dim">${"●".repeat(5 - Math.round(g.quality))}</span></td><td>${g.count}</td></tr>`).join("")}</tbody></table>` : `<p class="muted small">Sobald du ein paar Tage einträgst, siehst du hier, nach welchen Diensten du am wenigsten schläfst.</p>`}
    </div>`)}
    ${fold("fold-chrono", `${ch ? ch.icon : "🧬"} Chronotyp <small>· ${ch ? esc(ch.label) : "noch nicht getestet"}</small>`, `<div class="card" id="chrono-card">
      ${ch ? `<div class="chres"><span class="big">${ch.icon}</span><div><b>${esc(ch.label)}</b><small class="muted">${p.chrono_score ? `rMEQ ${p.chrono_score}/25` : ""}${p.chrono_msf !== null && p.chrono_msf !== undefined ? ` · Schlafmitte frei ${pad(Math.floor(p.chrono_msf / 60))}:${pad(p.chrono_msf % 60)}` : ""}</small></div></div><p class="small">${esc(ch.text)} ${srcLink("chrono")}</p><button class="btn block soft" data-act="go" data-href="#/chronotyp">Test wiederholen</button>`
        : `<p class="muted small">7 kurze Fragen (ca. 2 Min.). Danach passt ShiftFlow freie Aufwachzeiten und die Vorbereitung auf Nächte bzw. Frühdienste an dich an. ${srcLink("chrono")}</p><button class="btn block" data-act="go" data-href="#/chronotyp">🧬 Chronotyp-Test starten</button>`}
    </div>`, ch ? "" : "")}
    <h2 class="sec">Letzte Einträge</h2>
    ${recent.length ? `<div class="card list">${recent.map((x) => { const e = calc.sleepEntry(x); return `<button class="lrow" data-act="diary" data-d="${x.day}"><span class="ld">${esc(dayLabel(x.day))}</span><span>${hm(new Date(x.bed_at))}–${hm(new Date(x.wake_at))}${e.naps ? ` +${Math.round(e.naps * 60)} Min.` : ""}</span><b class="${e.total < st.need - 0.25 ? "low" : ""}">${hrs(e.total)}</b><span>${QUAL[Math.max(0, Number(x.quality) - 1)][1]}</span></button>`; }).join("")}</div>` : `<div class="card empty slim"><p class="muted">Noch keine Einträge.</p></div>`}
    ${DISCLAIMER}`;
}
// Chronotyp-Test
function pageChrono() {
  const p = prefs(), A = (S.chronoAns = S.chronoAns || { ...(p.chrono_answers || {}) });
  for (const q of L.CHRONO_Q) if (q.time && !A[q.id]) A[q.id] = q.def;
  const done = L.CHRONO_Q.filter((q) => (q.time ? A[q.id] : A[q.id] !== undefined)).length;
  return `<button class="link back" data-act="go" data-href="#/schlaf">‹ Schlaf</button><section class="hello"><h1>Chronotyp-Test</h1><p class="muted">Bist du eher Lerche oder Eule? 5 Fragen aus dem reduzierten Morningness-Eveningness-Fragebogen (rMEQ, Adan & Almirall 1991) + 2 Fragen zu freien Tagen (MCTQ, Roenneberg 2003). Denk an Zeiten, in denen du frei planen kannst.</p></section>
    <form id="chf" class="chq">${L.CHRONO_Q.map((q, i) => `<div class="card q" id="q-${q.id}"><p class="qn">Frage ${i + 1} von ${L.CHRONO_Q.length}</p><h3>${esc(q.q)}</h3>
      ${q.time ? `<input class="inp" type="time" data-qt="${q.id}" value="${esc(A[q.id])}">` : `<div class="opts">${q.a.map(([l, v]) => `<button type="button" class="opt ${Number(A[q.id]) === v && A[q.id] !== undefined ? "on" : ""}" data-q="${q.id}" data-v="${v}">${esc(l)}</button>`).join("")}</div>`}</div>`).join("")}
      <button class="btn block big" type="submit" id="ch-save">Auswerten & speichern</button>
      <p class="muted small center">${done} von ${L.CHRONO_Q.length} beantwortet · ${srcLink("chrono", "Quellen")}</p></form>
    ${p.chronotype ? `<button class="btn block ghost" id="ch-clear">Chronotyp zurücksetzen</button>` : ""}
    <button class="btn block soft" data-act="go" data-href="#/schlaf">Zurück</button>
    ${DISCLAIMER}`;
}
function bindChrono(root) {
  const A = S.chronoAns;
  $$("[data-q]", root).forEach((b) => (b.onclick = () => { A[b.dataset.q] = Number(b.dataset.v); $$(`[data-q="${b.dataset.q}"]`, root).forEach((x) => x.classList.toggle("on", x === b)); }));
  $$("[data-qt]", root).forEach((el) => (el.onchange = () => (A[el.dataset.qt] = el.value)));
  $("#chf", root).onsubmit = async (e) => {
    e.preventDefault();
    const miss = L.CHRONO_Q.find((q) => !q.time && A[q.id] === undefined);
    if (miss) { $("#q-" + miss.id, root).scrollIntoView({ behavior: "smooth", block: "center" }); return toast("Bitte alle Fragen beantworten"); }
    const r = L.chronotype(A); if (!r) return toast("Bitte alle Fragen beantworten");
    const ok = await busy($("#ch-save", root), () => write("chrono_save", { answers: A })).catch(() => null);
    if (!ok) return;
    S.chronoAns = null; chronoResult(r);
  };
  if ($("#ch-clear", root)) $("#ch-clear", root).onclick = async (e) => { const ok = await busy(e.currentTarget, () => write("chrono_clear", {})).catch(() => null); if (ok) { S.chronoAns = null; toast("Chronotyp zurückgesetzt"); location.hash = "#/schlaf"; } };
}
function chronoResult(r) {
  const c = L.CHRONO[r.type];
  const { sh, close } = openSheet(`<div class="chres big"><span class="big">${c.icon}</span><div><p class="muted small">Dein Chronotyp</p><h2>${esc(c.label)}</h2><small class="muted">rMEQ ${r.score}/25${r.msf !== null ? ` · Schlafmitte frei ${pad(Math.floor(r.msf / 60))}:${pad(r.msf % 60)}` : ""}</small></div></div>
    <p>${esc(c.text)}</p>
    <div class="card soft small"><b>Das ändert sich in ShiftFlow:</b><ul class="small"><li>Freie Tage: Aufstehen ca. ${pad(Math.floor((420 + c.wake) / 60))}:${pad((420 + c.wake) % 60)} statt 07:00</li><li>Vor Nächten: ${c.nightDays} ${c.nightDays > 1 ? "Tage" : "Tag"} schrittweise später ins Bett</li><li>Vor Frühdiensten: ${c.earlyDays > 1 ? `${c.earlyDays - 1} ${c.earlyDays > 2 ? "Tage" : "Tag"} vorher schrittweise früher` : "kein Vorlauf nötig"}</li>${c.hard ? `<li>Extra-Hinweise bei ${c.hard === "N" ? "Nachtdiensten" : "Frühdiensten"}</li>` : ""}</ul></div>
    <p class="muted small">Kurzfragebogen, keine Diagnose. Quellen: Adan & Almirall 1991, Roenneberg 2003, Juda 2013, Vetter 2015.</p>
    <div class="btns"><button class="btn" id="chr-ok">Fertig</button></div>`);
  $("#chr-ok", sh).onclick = () => { close(); location.hash = "#/schlaf"; };
}

// ---------- Seiten ----------
function greet() { const h = new Date().getHours(); return h < 5 ? "Gute Nacht" : h < 11 ? "Guten Morgen" : h < 18 ? "Hallo" : "Guten Abend"; }
const foldOpen = (id, def = false) => { const f = readJ("sf-folds", {}); return f[id] === undefined ? def : !!f[id]; };
const fold = (id, sum, body, cls = "") => `<details class="fold ${cls}" id="${id}" ${foldOpen(id) ? "open" : ""}><summary><span>${sum}</span><span class="chev" aria-hidden="true">›</span></summary><div class="fold-body">${body}</div></details>`;
// Nächste Aktionen aus dem Fahrplan (gestern/heute/morgen): Zeitpunkte, an denen man etwas tun sollte
function nextActions(now, t) {
  const ev = [], idx = new Map(), lim = +now + 30 * 3600e3;
  const add = (at, kind, label, icon, text) => {
    if (!at || +at <= +now || +at > lim) return;
    const k = (kind === "alarm" ? "wake" : kind) + "|" + +at;
    if (idx.has(k)) { if (kind === "alarm") Object.assign(idx.get(k), { label, icon, text, kind }); return; }
    const e = { at, kind, label, icon, text }; idx.set(k, e); ev.push(e);
  };
  for (const d of [addDays(t, -1), t, addDays(t, 1)]) {
    const r = calc.resolve(d);
    for (const x of calc.dayPlan(d).items) {
      if (x.type === "sleep") { add(x.start, "sleep", x.kind === "recover" ? "Kurz schlafen" : x.kind === "night" ? "Schlafen" : "Tagschlaf", "🛏️", `${x.title}. ${x.text}`); add(x.end, "wake", "Aufstehen", "☀️", x.title); }
      else if (x.type === "nap") { add(x.start, "nap", "Vorschlaf", "😴", `${x.title}. ${x.text}`); add(x.end, "wake", "Aufstehen", "⏰", x.title); }
      else if (x.type === "alarm") add(x.start, "alarm", "Wecker", "⏰", x.text);
      else if (x.type === "caffeine") add(x.start, "caf", "Kaffee-Stopp", "☕", x.text);
      else if (x.type === "dark" && /Licht dimmen/.test(x.title)) add(x.start, "dark", "Licht dimmen", "🕯️", x.text);
      else if (x.type === "meal" && /Hauptmahlzeit/.test(x.title)) add(x.start, "meal", "Hauptmahlzeit", "🍲", x.text);
      else if (x.type === "powernap") add(x.start, "pnap", "Powernap", "💤", x.title);
      else if (x.type === "shift") {
        if (r.start && +r.start === +x.start) add(calc.leaveAt(r), "leave", "Abfahrt", "🚗", `${r.label} beginnt um ${hm(r.start)}.`);
        add(x.start, "shift", `${r.label || "Dienst"} beginnt`, x.icon, x.text); add(x.end, "end", "Feierabend", "🏠", x.text);
      }
    }
  }
  return ev.sort((a, b) => +a.at - +b.at);
}
const SLEEPK = new Set(["sleep", "nap"]);
// 24-Std.-Leiste ab der aktuellen Stunde: Schlaf, Vorschlaf, Dienst, Kaffee-Stopp
function tl24(now, t) {
  const a = new Date(now); a.setMinutes(0, 0, 0); const A = +a, B = A + 24 * 3600e3;
  const pos = (x) => Math.max(0, Math.min(100, ((+x - A) / (B - A)) * 100));
  const seen = new Set(), segs = [], leg = new Map();
  for (const d of [addDays(t, -1), t, addDays(t, 1)]) for (const x of calc.dayPlan(d).items) {
    const k = x.type + +x.start; if (seen.has(k)) continue; seen.add(k);
    if (x.type === "caffeine") { if (+x.start >= A && +x.start < B) { segs.push(`<i class="tls t-caf" style="left:${pos(x.start).toFixed(2)}%" title="${esc(x.title)}"></i>`); leg.set("caf", `<span><i class="t-caf"></i>Kaffee bis ${hm(x.start)}</span>`); } continue; }
    const cls = { sleep: "t-sleep", nap: "t-nap", shift: "t-shift" }[x.type];
    if (!cls || !x.end || +x.end <= A || +x.start >= B) continue;
    const l = pos(x.start), w = Math.max(0.6, pos(x.end) - l);
    segs.unshift(`<i class="tls ${cls}" style="left:${l.toFixed(2)}%;width:${w.toFixed(2)}%;${x.type === "shift" && x.color ? `--c:${x.color}` : ""}" title="${esc(x.title)}"></i>`);
    if (x.type === "sleep") leg.set("sleep", `<span><i class="t-sleep"></i>Schlaf</span>`);
    if (x.type === "nap") leg.set("nap", `<span><i class="t-nap"></i>Vorschlaf ${hm(x.start)}–${hm(x.end)}</span>`);
    if (x.type === "shift") leg.set("shift" + x.title, `<span><i class="t-shift" style="--c:${x.color || "var(--muted)"}"></i>${esc(x.title)}</span>`);
  }
  const h0 = a.getHours(), lab = [0, 6, 12, 18, 24].map((h) => `<span>${pad((h0 + h) % 24)}</span>`).join("");
  return `<section class="card tlcard" id="tl24"><div class="tlhead"><span class="lbl">Nächste 24 Std.</span><small>${pad(h0)}–${pad(h0)} Uhr</small></div>
    <div class="tl" aria-hidden="true">${segs.join("")}<i class="tlnow" style="left:${pos(now).toFixed(2)}%"></i></div><div class="tlx">${lab}</div>
    ${leg.size ? `<div class="tleg">${[...leg.values()].join("")}</div>` : ""}</section>`;
}
function pageHome() {
  const t = today(), now = new Date();
  const hasPlan = S.D.rotations.length || S.D.days.length;
  const cur = calc.currentShift(now, t), td = calc.resolve(t);
  const firstTile = cur && cur.day !== t ? cur : td;
  const nx = calc.nextShift(now, t, true, cur ? cur.end : null);
  const sl = calc.nextSleep(now, t);
  const rec = calc.recovery(now, t);
  const hints = calc.hints(now, t, dismissed());
  const sleeping = sl && +sl.start <= +now;
  const al = nx ? calc.alarmFor(nx) : null, ready = nx ? calc.wakeAt(nx) : null;
  // „Was jetzt?“: nächste Aktion groß, die drei folgenden klein
  const ev = hasPlan ? nextActions(now, t) : [];
  const main = ev[0], minis = ev.slice(1, 4);
  let sleepIn = [main, ...minis].findIndex((e) => e && SLEEPK.has(e.kind));
  const dayWord = (d) => (dayOf(d) === t ? "" : dayOf(d) === addDays(t, 1) ? "morgen" : parseD(dayOf(d)).toLocaleDateString("de-DE", { weekday: "short" }).replace(".", ""));
  let prevDay = main ? dayOf(main.at) : t; // Tageswechsel nur einmal markieren („ab morgen“)
  const mt = (e, id = "") => { const ch = dayOf(e.at) !== prevDay; prevDay = dayOf(e.at); return `<div class="mt" ${id}><b>${hm(e.at)}</b><span>${esc(e.label)}${ch && dayWord(e.at) ? ` · ${dayWord(e.at)}` : ""}</span></div>`; };
  let miniHtml = minis.map((e, i) => mt(e, sleepIn === i + 1 ? 'id="sleep-tile"' : "")).join("");
  if (sleepIn < 0) {
    const fb = sl ? `<div class="mt ${sleeping ? "now" : ""}" id="sleep-tile"><b>${sleeping ? hm(sl.end) : hm(sl.start)}</b><span>${sleeping ? "Schlaf bis" : esc(calc.SLEEP_LABEL[sl.kind])}</span></div>` : `<div class="mt" id="sleep-tile"><b>–</b><span>Schlaf</span></div>`;
    miniHtml = minis.slice(0, 2).map((e) => mt(e)).join("") + fb;
  }
  const ctx = cur ? `<p class="now-ctx"><span class="dot" ${sty(cur)}></span>Gerade im Dienst: ${esc(cur.label)} bis ${hm(cur.end)}</p>`
    : sleeping ? `<p class="now-ctx"><span class="dot" style="--c:var(--acc)"></span>Gerade: ${esc(calc.SLEEP_LABEL[sl.kind])} bis ${hm(sl.end)}</p>` : "";
  const sub = (e) => `<p class="now-sub"><b>${e.icon} ${esc(e.label)}.</b> ${esc(e.text || "")}</p>`;
  // Dienst-Zeilen: heute + nächster Dienst (zusammengefasst, wenn der nächste Dienst heute ist)
  const merged = nx && !cur && nx.day === firstTile.day && firstTile.start && +nx.start === +firstTile.start;
  const wakeTxt = nx ? `${al ? `Wecker ${hm(al)}` : `Fertig machen ab ${hm(ready)}`} · Abfahrt ${hm(calc.leaveAt(nx))}` : "";
  const live = firstTile.start && +firstTile.start <= +now && +now < +firstTile.end;
  const todaySub = firstTile.start ? `${hm(firstTile.start)}–${hm(firstTile.end)}` : firstTile.off ? "ganztägig" : firstTile.rotation ? "Kein Dienst" : services().length ? "Kein Dienst eingetragen" : "Noch kein Plan";
  const extra = (r) => `${r.custom ? ` <span class="tagx">⏱ abweichend, sonst ${esc(r.def.s)}–${esc(r.def.e)}</span>` : r.override ? ` <span class="tagx">✎ geändert</span>` : ""}${r.note ? `<span class="ss">📝 ${esc(r.note)}</span>` : ""}`;
  const rowToday = `<button class="srow tile today ${merged ? "next" : ""} ${firstTile.free ? "free" : "svc"}" ${sty(firstTile)} data-day="${firstTile.day}"><span class="dot"></span><span class="sb"><span class="st">${firstTile.day === t ? "Heute" : "Jetzt"} · ${esc(firstTile.label)}</span><span class="ss">${todaySub}${merged ? ` · ${wakeTxt}` : ""}</span>${extra(firstTile)}</span><span class="sr">${live ? `<span class="live">läuft bis ${hm(firstTile.end)}</span>` : merged ? esc(inText(nx.start)) : ""}</span></button>`;
  const rowNext = merged ? "" : nx ? `<button class="srow tile next svc" ${sty(nx)} data-day="${nx.day}"><span class="dot"></span><span class="sb"><span class="st">${esc(nx.label)} · ${esc(parseD(nx.day).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" }))}</span><span class="ss">${hm(nx.start)}–${hm(nx.end)}${nx.custom ? " ⏱" : ""} · ${wakeTxt}</span></span><span class="sr">${esc(inText(nx.start))}</span></button>`
    : `<div class="srow tile next free"><span class="dot free"></span><span class="sb"><span class="st">Nächster Dienst</span><span class="ss">keiner in Sicht 🌿</span></span></div>`;
  const tr = hasPlan ? calc.activeTransitions(t, 14).filter((x) => !dismissed().includes(x.id)) : [];
  const warnN = hints.filter((h) => h.level === "warn").length;
  return `<section class="hello"><h1>Was jetzt?</h1><p class="muted">${greet()}, ${esc(S.me.display_name)}</p></section>
    ${S.draft?.dirty ? `<button class="banner draftb" data-act="resume-draft">✏️ Rotation „${esc(S.draft.name)}“ ist noch nicht gespeichert – <b>weiter bearbeiten</b></button>` : ""}
    ${hasPlan ? "" : `<div class="card empty"><h3>Noch kein Dienstplan</h3><p class="muted">Lege deine Dienste und eine Rotation an – dann siehst du hier, was als Nächstes ansteht.</p><button class="btn" data-act="go" data-href="#/plan">Plan anlegen</button></div>`}
    <section class="card now-card" id="now-card">
      ${ctx}
      ${main ? `<div class="lbl acc">Nächste Aktion</div>
      <div class="now-row"><div class="bignum" ${sleepIn === 0 ? 'id="sleep-tile"' : ""}>${hm(main.at)}</div><div class="now-in">${dayWord(main.at) ? esc(dayWord(main.at)) + "<br>" : ""}${esc(inText(main.at))}</div></div>
      ${sub(main)}
      <div class="mini3">${miniHtml}</div>
      <div class="hr"></div>` : `<div class="mini3" hidden><div class="mt" id="sleep-tile"><b>–</b><span>Schlaf</span></div></div>`}
      ${rowToday}${rowNext}
      <div class="rec rec-${rec.level}"><span class="dot"></span><div><b>${esc(rec.label)}</b><p>${esc(rec.text)}</p></div></div>
    </section>
    ${hasPlan ? tl24(now, t) : ""}
    ${hasPlan ? diaryPrompt() : ""}
    ${tr.length ? fold("fold-tr", tr.length === 1 ? `${tr[0].icon} ${esc(tr[0].title)} <small>· ${tr[0].steps.length} ${tr[0].steps.length === 1 ? "Schritt" : "Schritte"}</small>` : `🔄 Dienstwechsel <small>· ${tr.length}</small>`, tr.map(transHtml).join("")) : ""}
    ${hasPlan ? fold("fold-plan", `🧭 Ganzer Tagesplan <small>· Schlaf, Licht, Essen</small>`, fahrplanCard()) : ""}
    ${fold("fold-hints", `💡 Hinweise <small>· ${hints.length ? `${hints.length} offen${warnN ? `, ${warnN} wichtig` : ""}` : "alles erledigt"}</small>`, hints.length ? hints.map(hintHtml).join("") : `<div class="card empty slim"><p>Alles erledigt 👍</p>${dismissed().length ? `<button class="link small" data-act="undismiss">Ausgeblendete wieder zeigen</button>` : ""}</div>`, warnN ? "warn" : "")}
    ${fold("fold-week", `📅 Nächste 7 Tage`, weekStrip(t))}
    ${DISCLAIMER}`;
}

function legendHtml(withCustom = true, editor = false) {
  const sv = services();
  return `<div class="legend">${sv.map((x) => `<span><i ${svSty(x)}></i>${esc(x.label)}</span>`).join("")}<span><i class="free"></i>Frei</span>${withCustom ? `<span><i class="lg-time"></i>abweichende Zeit</span>` : ""}${editor ? `<span><i class="lg-rep"></i>Wiederholung</span>` : `<span><i class="lg-ovr"></i>einzeln geändert</span><span><i class="lg-tr"></i>Wechsel-Vorbereitung</span>`}</div>`;
}
function monthCells(ym, c, opts = {}) {
  const [y, m] = ym.split("-").map(Number);
  const first = `${ym}-01`, startD = mondayOf(first), last = ymd(new Date(y, m, 0));
  const cells = []; for (let d = startD; d <= last || cells.length % 7; d = addDays(d, 1)) cells.push(d);
  return `<div class="mh">${WD.map((w) => `<span>${w}</span>`).join("")}</div>
    <div class="mg">${cells.map((d) => {
      const out = d.slice(0, 7) !== ym || (opts.from && (d < opts.from || d > opts.to));
      if (out && opts.from) return `<span class="mcell out blank">${d.slice(0, 7) === ym ? `<span class="dn">${parseD(d).getDate()}</span>` : ""}</span>`;
      const r = c.resolve(d);
      return `<button class="mcell ${r.free ? "free" : "svc"} ${out ? "out" : ""} ${d === today() ? "today" : ""} ${r.custom ? "custom" : ""} ${opts.attr === "ed" && r.rep > 0 ? "rep" : ""} ${opts.attr === "ed" && r.rep === 0 && r.cycle_idx === r.cycle_len - 1 ? "cyc-end" : ""}" ${sty(r)} data-${opts.attr || "day"}="${d}" aria-label="${esc(fullDay(d))}: ${esc(r.label)}${r.custom ? " (abweichende Zeit)" : ""}${r.override ? " (einzeln geändert)" : ""}${opts.attr === "ed" && r.rep > 0 ? " (Wiederholung)" : ""}"><span class="dn">${parseD(d).getDate()}</span><b>${r.free ? "" : esc(r.short)}</b>${marks(r, opts.attr !== "ed")}</button>`;
    }).join("")}</div>`;
}
// Tageskarte unter dem Kalender: Dienst + die wichtigsten Punkte aus dem Tagesplan
function dayCard(d) {
  const r = calc.resolve(d), A = +new Date(`${d}T04:00:00`), B = A + 864e5, seen = new Set();
  const its = [...calc.dayPlan(d).items, ...calc.dayPlan(addDays(d, 1)).items]
    .filter((x) => ["sleep", "nap", "alarm", "caffeine", "powernap"].includes(x.type) || (x.type === "dark" && /Licht dimmen/.test(x.title)))
    .filter((x) => +x.start >= A && +x.start < B && !seen.has(x.type + +x.start) && seen.add(x.type + +x.start))
    .sort((a, b) => +a.start - +b.start).slice(0, 5);
  const sub = r.start ? `${hm(r.start)}–${hm(r.end)}` : r.off ? "ganztägig" : "";
  return `<button class="card dayc" data-day="${d}"><span class="lbl">${esc(dayLabel(d))} · ${esc(parseD(d).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }))}</span>
    <span class="dch"><span class="dot ${r.free ? "free" : ""}" ${sty(r)}></span>${esc(r.label)}${sub ? ` <span class="muted">${sub}</span>` : ""}${rotTag(r)}</span>
    ${r.note ? `<span class="li"><span class="ft">📝</span><span>${esc(r.note)}</span></span>` : ""}
    ${its.map((x) => `<span class="li"><span class="ft">${hm(x.start)}</span><span>${x.icon} ${esc(x.title)}${dayOf(x.start) !== d ? ` <small>(Nacht auf ${esc(parseD(addDays(d, 1)).toLocaleDateString("de-DE", { weekday: "short" }))})</small>` : ""}</span></span>`).join("")}
    <span class="li"><span class="ft"></span><span class="more">Tag ansehen & ändern ›</span></span></button>`;
}
function pageCal() {
  const mode = S.calMode;
  const seg = `<div class="seg"><button data-act="cal-mode" data-m="week" class="${mode === "week" ? "on" : ""}">Woche</button><button data-act="cal-mode" data-m="month" class="${mode === "month" ? "on" : ""}">Monat</button></div>`;
  if (mode === "week") {
    const ws = S.weekStart || mondayOf(today());
    const days = calc.range(ws, addDays(ws, 6));
    return `<div class="cal-nav"><button class="link" data-act="cal-today" title="Zur aktuellen Woche"><b>KW ${isoWeek(ws)}</b> <span class="muted">${parseD(ws).getDate()}.${parseD(ws).getMonth() + 1}.–${parseD(addDays(ws, 6)).getDate()}.${parseD(addDays(ws, 6)).getMonth() + 1}.</span></button><span class="cal-arrows"><button class="iconbtn" data-act="cal-prev" aria-label="Vorige Woche">${ICON.left}</button><button class="iconbtn" data-act="cal-next" aria-label="Nächste Woche">${ICON.right}</button></span></div>
      <div class="cal-head">${seg}</div>
      <div class="week">${days.map((r) => {
        const sl = calc.sleepFor(r.day).filter((w) => w.kind !== "nap");
        const nap = calc.sleepFor(r.day).find((w) => w.kind === "nap");
        return `<button class="wrow ${r.free ? "free" : "svc"} ${r.day === today() ? "today" : ""}" ${sty(r)} data-day="${r.day}">
          <span class="wd"><b>${WD[(parseD(r.day).getDay() + 6) % 7]}</b><small>${parseD(r.day).getDate()}.${parseD(r.day).getMonth() + 1}.</small></span>
          <span class="wmain"><b>${esc(r.label)}</b>${r.start ? `<span>${hm(r.start)}–${hm(r.end)}</span>` : r.off ? "<span>ganztägig</span>" : ""}${rotTag(r)}
            <small class="wsleep">${nap ? `Vorschlaf ${hm(nap.start)}–${hm(nap.end)} · ` : ""}${sl.map((w) => `😴 ${hm(w.start)}–${hm(w.end)}`).join(" · ")}</small>${r.note ? `<small>📝 ${esc(r.note)}</small>` : ""}${(trData().m.get(r.day) || []).map((x) => `<small class="wtr">${x.tr.icon} ${esc(x.title)}</small>`).join("")}</span>
        </button>`;
      }).join("")}</div>${legendHtml()}`;
  }
  const ym = S.calMonth || today().slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const counts = new Map(); for (const r of calc.range(`${ym}-01`, ymd(new Date(y, m, 0)))) if (!r.free) counts.set(r.label, (counts.get(r.label) || 0) + 1);
  return `<div class="cal-nav"><button class="link" data-act="cal-today" title="Zum heutigen Monat"><b>${MONTHS[m - 1]}</b> <span class="muted">${y}</span></button><span class="cal-arrows"><button class="iconbtn" data-act="cal-prev" aria-label="Voriger Monat">${ICON.left}</button><button class="iconbtn" data-act="cal-next" aria-label="Nächster Monat">${ICON.right}</button></span></div>
    <div class="cal-head">${seg}</div>
    <div class="month cal-month">${monthCells(ym, calc)}</div>
    ${dayCard(today())}
    ${legendHtml()}
    <div class="card counts"><b>${MONTHS[m - 1]}:</b> ${counts.size ? [...counts].map(([l, n]) => `${n}× ${esc(l)}`).join(" · ") : "keine Dienste"}</div>
    <p class="muted small center">Tag antippen, um Dienst, Zeit oder Notiz zu ändern.</p>`;
}
function isoWeek(day) { const d = parseD(day); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); const w1 = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7); }

// ---------- Plan: Rotationen + Dienste ----------
function pagePlan() {
  const t = today();
  const rs = S.D.rotations.slice().sort((a, b) => b.start_date.localeCompare(a.start_date));
  const sv = services();
  const used = (id) => S.D.days.filter((d) => d.service_id === id).length + (S.D.cycle || []).filter((x) => x.service_id === id).length;
  const sim = similarGroups(sv), simKey = sim.map((g) => g.map((x) => x.color).join("")).join("|");
  const simHtml = sim.length && readJ("sf-simhint", "") !== simKey ? `<div class="simhint" id="simhint"><span aria-hidden="true">🎨</span><div>${sim.map((g) => `${g.map((x) => `<i style="--c:${x.color}"></i>`).join("")} <b>${g.map((x) => esc(x.label)).join(", ")}</b>`).join("<br>")} haben sehr ähnliche Farben und sind im Kalender leicht zu verwechseln. Wenn du magst, tippe unten einen Dienst an und wähle eine deutlichere Farbe – geändert wird nichts automatisch.<br><button class="link small" data-act="simhint-x" data-k="${esc(simKey)}">Hinweis ausblenden</button></div></div>` : "";
  return `<button class="link back" data-act="go" data-href="#/mehr">‹ Mehr</button><section class="hello"><h1>Dein Plan</h1><p class="muted">Lege deine Dienste einmal fest – dann trägst du in einer Rotation einen Durchgang ein, der sich automatisch wiederholt.</p></section>
    ${S.draft?.dirty ? `<button class="banner draftb" data-act="resume-draft">✏️ „${esc(S.draft.name)}“ ist noch nicht gespeichert – <b>weiter bearbeiten</b></button>` : ""}
    <h2 class="sec">Rotationen</h2>
    ${rs.length ? rs.map((r) => {
      const len = r.cycle_len || 7, rc = rotCalc(r);
      const active = r.start_date <= t && (!r.end_date || r.end_date >= t);
      const strip = rc.range(r.start_date, addDays(r.start_date, Math.min(len, 28) - 1));
      const n = rc.range(r.start_date, addDays(r.start_date, len - 1)).filter((x) => !x.free).length;
      const ci = active ? rc.resolve(t).cycle_idx : null;
      return `<button class="card pat" data-rot="${r.id}"><div class="pat-h"><b>${esc(r.name)}</b>${active ? `<span class="pill on">läuft</span>` : r.start_date > t ? `<span class="pill">kommt</span>` : `<span class="pill">vorbei</span>`}</div>
        <p class="rh-line">${ICON.rep}<span>Rhythmus: <b>${len} Tage${weeksText(len)}</b> · wiederholt sich ${esc(untilText(r.end_date))}</span></p>
        <p class="muted small">ab ${esc(fmtD(r.start_date, { weekday: "short", day: "numeric", month: "short", year: "numeric" }))} · ${n} Dienste je Durchgang${ci !== null ? ` · heute Tag ${ci + 1}` : ""}</p>
        <div class="mini big">${strip.map((x) => `<i class="${x.free ? "free" : ""}" ${sty(x)}>${x.free ? "" : esc(x.short)}</i>`).join("")}${len > 28 ? `<span class="muted small">…</span>` : ""}</div></button>`;
    }).join("") : `<div class="card empty"><h3>Noch keine Rotation</h3><p class="muted">Starttag wählen, einen Durchgang eintragen – er wiederholt sich automatisch.</p></div>`}
    <button class="btn block big" data-act="new-rotation">${ICON.plus} Neue Rotation</button>
    <h2 class="sec">Deine Dienste</h2>
    ${simHtml}
    ${sv.length ? `<div class="svlist">${sv.map((x) => `<button class="svrow" data-svc="${x.id}"><span class="badge sw" ${svSty(x)}>${esc(x.short)}</span><span class="svm"><b>${esc(x.label)}</b><small>${esc(svTimes(x))}${x.kind === "oncall" ? " · Bereitschaft" : ""} · ${used(x.id)} Tage</small></span>${ICON.edit}</button>`).join("")}</div>`
      : `<div class="card empty slim"><p class="muted">Noch keine Dienste – z. B. „Früh 06:00–14:00“ in Gelb.</p></div>`}
    <button class="btn block soft" data-act="new-service">${ICON.plus} Neuer Dienst</button>
    <p class="muted small center">Änderst du Zeit oder Farbe eines Dienstes, gilt das für alle Tage mit diesem Dienst – außer Tage mit ausdrücklich abweichender Zeit.</p>`;
}

// Dienst anlegen/bearbeiten: Bezeichnung, Kürzel, Farbe, Art, Zeit
function serviceEditor(sv, done = null) {
  const isNew = !sv;
  const st = { id: sv?.id || uuid(), label: sv?.label || "", short: sv?.short || "", autoS: !sv, color: sv?.color || L.COLORS[services().length % L.COLORS.length], kind: sv?.kind || "work", s: sv?.start_time || "06:00", e: sv?.end_time || "14:00", lead: sv?.lead_min ? +sv.lead_min : 0 };
  const taken = () => services().filter((x) => x.id !== st.id).map((x) => x.short);
  const simNote = () => { const o = services().filter((x) => x.id !== st.id && colDist(x.color, st.color) < SIM_COL); return o.length ? `Hinweis: ähnlich wie ${o.map((x) => `<i style="--c:${x.color}"></i> ${esc(x.label)}`).join(", ")} – im Kalender schwer zu unterscheiden. Du entscheidest.` : ""; };
  const { sh, close } = openSheet(`<h2>${isNew ? "Neuer Dienst" : "Dienst bearbeiten"}</h2><div id="se"></div>`, "tall");
  const keep = () => { const f = $("#sf", sh); if (!f) return; const v = fd(f); st.label = v.label; st.short = v.short; if (v.s) st.s = v.s; if (v.e) st.e = v.e; if (v.lead !== undefined) st.lead = +v.lead || 0; };
  const preview = () => {
    const p = $("#sv-prev", sh); if (!p) return;
    const lab = $("#sv-label", sh).value.trim() || "Dienst", sho = $("#sv-short", sh).value.trim() || L.autoShort(lab, taken());
    p.setAttribute("style", `--c:${st.color};--ci:${L.ink(st.color)}`);
    p.innerHTML = `<div class="tile-main"><span class="badge">${esc(sho)}</span><div><b>${esc(lab)}</b><span class="times">${st.kind === "off" ? "ganztägig" : `${esc($("#sv-s", sh)?.value || st.s)} – ${esc($("#sv-e", sh)?.value || st.e)}`}</span></div></div>`;
  };
  const draw = () => {
    $("#se", sh).innerHTML = `<form id="sf" class="form">
      <div class="tile big svc sv-prev" id="sv-prev"></div>
      <label class="f" for="sv-label">Bezeichnung</label><input class="inp" id="sv-label" name="label" maxlength="30" required value="${esc(st.label)}" placeholder="z. B. Früh, Spät, Nacht, Rufdienst">
      <label class="f" for="sv-short">Kürzel <span class="muted small">(im Kalender, max. 3 Zeichen)</span></label><input class="inp short" id="sv-short" name="short" maxlength="3" value="${esc(st.short)}" placeholder="F">
      <p class="f">Farbe</p>
      <div class="swatches">${L.COLORS.map((c) => `<button type="button" class="swatch ${st.color.toLowerCase() === c.toLowerCase() ? "on" : ""}" style="--c:${c};--ci:${L.ink(c)}" data-col="${c}" aria-label="Farbe ${c}"></button>`).join("")}
        <label class="swatch custom ${L.COLORS.some((c) => c.toLowerCase() === st.color.toLowerCase()) ? "" : "on"}" style="--c:${st.color}" title="Eigene Farbe"><input type="color" id="sv-col" value="${esc(st.color)}" aria-label="Eigene Farbe"><span>+</span></label></div>
      <p class="sim-note" id="sv-sim" aria-live="polite">${simNote()}</p>
      <p class="f">Art</p>
      <div class="seg small kinds">${[["work", "Arbeit"], ["oncall", "Bereitschaft"], ["off", "Ganztägig"]].map(([k, l]) => `<button type="button" data-kind="${k}" class="${st.kind === k ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
      ${st.kind === "off" ? `<p class="muted small">Ganztägig ohne Uhrzeit – z. B. Urlaub, Seminar, Krank. Zählt für Schlaf-Hinweise als frei.</p>`
        : `<label class="f">Zeit</label><div class="row2"><input class="inp" type="time" id="sv-s" name="s" value="${esc(st.s)}" required><span>bis</span><input class="inp" type="time" id="sv-e" name="e" value="${esc(st.e)}" required></div>
           <p class="muted small">Endet vor dem Beginn = über Nacht (z. B. 22:00–06:00).${st.kind === "oncall" ? " Bereitschaft wird für Familie als „In Bereitschaft“ angezeigt." : ""}</p>
           <label class="f" for="sv-lead">Vorlauf für diesen Dienst <span class="muted small">(Aufstehen bis Dienstbeginn)</span></label>
           <select class="inp" id="sv-lead" name="lead"><option value="0" ${st.lead ? "" : "selected"}>wie Standard (${esc(durTxt(+(S.D?.prefs?.lead_min) || L.RULES.leadDefault))})</option>${LEAD_OPTS.map((m) => `<option value="${m}" ${st.lead === m ? "selected" : ""}>${durTxt(m)}</option>`).join("")}</select>
           <p class="muted small">Z. B. anderer Arbeitsort oder Dienst mit Übergabe – sonst gilt dein Standard unter „Mehr“.</p>`}
      ${!isNew ? `<p class="muted small">Gilt überall, wo dieser Dienst eingetragen ist – Tage mit abweichender Zeit behalten ihre eigene Zeit.</p>` : ""}
      <div class="btns">${isNew ? `<button type="button" class="btn ghost" data-close>Abbrechen</button>` : `<button type="button" class="btn ghost danger-t" id="sv-del">Löschen</button>`}<button class="btn" type="submit">Speichern</button></div>
    </form>`;
    $$("[data-close]", sh).forEach((b) => (b.onclick = close));
    $("#sv-label", sh).oninput = () => { if (st.autoS) $("#sv-short", sh).value = L.autoShort($("#sv-label", sh).value, taken()); preview(); };
    $("#sv-short", sh).oninput = () => { st.autoS = !$("#sv-short", sh).value; preview(); };
    for (const id of ["#sv-s", "#sv-e"]) if ($(id, sh)) $(id, sh).oninput = preview;
    $$("[data-col]", sh).forEach((b) => (b.onclick = () => { keep(); st.color = b.dataset.col; draw(); }));
    $("#sv-col", sh).oninput = (e) => { st.color = e.target.value.toUpperCase(); $$(".swatch", sh).forEach((x) => x.classList.remove("on")); e.target.parentElement.classList.add("on"); e.target.parentElement.style.setProperty("--c", st.color); $("#sv-sim", sh).innerHTML = simNote(); preview(); };
    $$("[data-kind]", sh).forEach((b) => (b.onclick = () => { keep(); st.kind = b.dataset.kind; draw(); }));
    if ($("#sv-del", sh)) $("#sv-del", sh).onclick = async () => {
      const n = S.D.days.filter((d) => d.service_id === st.id).length + (S.D.cycle || []).filter((x) => x.service_id === st.id).length;
      if (!(await confirmSheet(`„${st.label}“ löschen?`, n ? `Alle Tage mit diesem Dienst (auch im Rhythmus) werden danach als frei angezeigt.` : "Der Dienst wird noch an keinem Tag verwendet."))) return;
      await write("service_delete", { id: st.id }).catch(() => null);
      if (S.draft) { for (const [k, x] of Object.entries(S.draft.cyc || {})) if (x && x.service_id === st.id) S.draft.cyc[k] = null; if (S.draft.tool === st.id) S.draft.tool = "open"; saveDraft(); }
      close(); done ? done() : rerender();
    };
    $("#sf", sh).onsubmit = async (e) => {
      e.preventDefault(); keep();
      const label = st.label.trim();
      if (!label) return toast("Bitte eine Bezeichnung eingeben");
      if (st.kind !== "off" && st.s === st.e) return toast("Beginn und Ende sind gleich");
      if (services().some((x) => x.id !== st.id && x.label.toLowerCase() === label.toLowerCase())) return toast(`„${label}“ gibt es schon`);
      const body = { id: st.id, label, short: st.short.trim() || L.autoShort(label, taken()), color: st.color.toUpperCase(), kind: st.kind, start_time: st.kind === "off" ? null : st.s, end_time: st.kind === "off" ? null : st.e, lead_min: st.kind === "off" || !st.lead ? null : st.lead, sort: sv?.sort ?? services().length + 1 };
      const r = await busy(e.target.querySelector("[type=submit]"), () => write("service_save", body)).catch(() => null);
      if (!r) return;
      close(); toast(r.queued ? "Gespeichert (offline)" : isNew ? `Dienst „${label}“ angelegt` : "Dienst gespeichert – gilt für alle Tage");
      done ? done(body) : rerender();
    };
    preview();
  };
  draw();
}
const rerender = () => (route().page === "rotation" ? renderRotationEditor(route().id, true) : render(true));

// ---------- Rotation = Rhythmus: erster Durchgang wird Tag für Tag eingetragen und wiederholt sich ab dem Starttag ----------
const draftKey = () => `sf-draft3-${S.uid}`;
function saveDraft() { if (S.draft?.dirty) writeJ(draftKey(), S.draft); else localStorage.removeItem(draftKey()); }
function setDraft(d) { S.draft = d; saveDraft(); }
const weeksText = (n) => (n % 7 === 0 ? ` (${n / 7} ${n === 7 ? "Woche" : "Wochen"})` : "");
const untilText = (end) => (end ? `bis ${fmtD(end, { day: "numeric", month: "short", year: "numeric" })}` : "unbegrenzt");
function draftFrom(r) {
  const cyc = {};
  for (const x of S.D.cycle || []) if (x.rotation_id === r.id) cyc[x.idx] = { service_id: x.service_id, start_time: x.start_time, end_time: x.end_time };
  return { id: r.id, name: r.name, start: r.start_date, end: r.end_date || null, len: r.cycle_len || 7, isNew: false, dirty: false, tool: "open", cyc };
}
async function leaveDirtyOk(nextId) {
  if (!S.draft?.dirty || S.draft.id === nextId) return true;
  return confirmSheet("Änderungen verwerfen?", `„${S.draft.name}“ ist noch nicht gespeichert.`, "Verwerfen");
}
async function openRotation(id) {
  if (!(await leaveDirtyOk(id))) return;
  if (S.draft?.id !== id) setDraft(draftFrom(S.D.rotations.find((x) => x.id === id)));
  location.hash = "#/rotation/" + id;
}
async function newRotation() {
  if (!(await leaveDirtyOk(null))) return;
  rotationMeta(null);
}
const overlaps = (r, a, b) => r.start_date <= (b || "9999-12-31") && (r.end_date || "9999-12-31") >= a;
// Name, Starttag, optionaler Endtag (leer = unbegrenzt), bei neuer Rotation die Rhythmus-Länge
function rotationMeta(dr) {
  const isNew = !dr, t = today();
  const st = dr ? { name: dr.name, start: dr.start, end: dr.end || "", len: dr.len } : { name: "", start: t, end: "", len: 7 };
  const { sh, close } = openSheet(`<h2>${isNew ? "Neue Rotation" : "Rotation ändern"}</h2>
    <form id="rf" class="form">
      <label class="f" for="rf-name">Name</label><input class="inp" id="rf-name" name="name" maxlength="40" value="${esc(st.name)}" placeholder="z. B. Station 3">
      <div class="row2 dates"><div><label class="f" for="rf-start">Starttag</label><input class="inp" id="rf-start" name="start" type="date" required value="${esc(st.start)}"></div>
      <div><label class="f" for="rf-end">Endtag <span class="muted small">(optional)</span></label><input class="inp" id="rf-end" name="end" type="date" value="${esc(st.end)}"></div></div>
      <p class="muted small">Endtag leer lassen = der Rhythmus wiederholt sich <b>unbegrenzt</b>.</p>
      ${isNew ? `<p class="f">Rhythmus <span class="muted small">(Länge eines Durchgangs, später änderbar)</span></p>
      <div class="chips lenchips">${[7, 14, 21, 28, 35, 42].map((n) => `<button type="button" class="chip ${n === st.len ? "on" : ""}" data-l="${n}">${n / 7} ${n === 7 ? "Woche" : "Wochen"}</button>`).join("")}</div>` : ""}
      <p class="muted small" id="rf-info"></p>
      <div class="btns">${isNew ? `<button type="button" class="btn ghost" data-close>Abbrechen</button>` : `<button type="button" class="btn ghost danger-t" id="rf-del">Löschen</button>`}<button class="btn" type="submit">${isNew ? "Weiter: Rhythmus eintragen" : "Übernehmen"}</button></div>
    </form>`);
  const info = () => {
    const a = $("#rf-start", sh).value, b = $("#rf-end", sh).value, el = $("#rf-info", sh);
    if (!a) return (el.textContent = "");
    if (b && b < a) return (el.innerHTML = `<span class="danger-t">Der Endtag liegt vor dem Starttag.</span>`);
    const ov = S.D.rotations.filter((r) => r.id !== dr?.id && overlaps(r, a, b));
    el.innerHTML = `Ab ${esc(fmtD(a, { weekday: "short", day: "numeric", month: "short" }))} · wiederholt sich ${esc(untilText(b))}${ov.length ? `<br>⚠️ Überschneidet sich mit ${ov.map((r) => `„${esc(r.name)}“`).join(", ")} – wo sich beide überschneiden, gilt die später beginnende Rotation.` : ""}`;
  };
  $$("[data-l]", sh).forEach((b) => (b.onclick = () => { st.len = Number(b.dataset.l); $$("[data-l]", sh).forEach((x) => x.classList.toggle("on", x === b)); }));
  $("#rf-start", sh).oninput = info; $("#rf-end", sh).oninput = info; info();
  if ($("#rf-del", sh)) $("#rf-del", sh).onclick = async () => {
    if (dr.isNew) { close(); setDraft(null); location.hash = "#/plan"; return; }
    if (!(await confirmSheet(`„${dr.name}“ löschen?`, "Der Rhythmus wird entfernt. Einzeln geänderte Tage im Kalender bleiben."))) return;
    await write("rotation_delete", { id: dr.id }).catch(() => null);
    close(); setDraft(null); location.hash = "#/plan"; toast("Rotation gelöscht");
  };
  $("#rf", sh).onsubmit = (e) => {
    e.preventDefault(); const v = fd(e.target);
    if (v.end && v.end < v.start) return toast("Der Endtag liegt vor dem Starttag");
    const name = v.name.trim() || `Rotation ab ${fmtD(v.start)}`;
    close();
    if (isNew) {
      const d = { id: uuid(), name, start: v.start, end: v.end || null, len: st.len, isNew: true, dirty: true, tool: services()[0]?.id || "open", cyc: {} };
      setDraft(d); location.hash = "#/rotation/" + d.id;
      if (!services().length) setTimeout(() => serviceEditor(null, (b) => { if (b) S.draft.tool = b.id; saveDraft(); renderRotationEditor(S.draft.id, true); }), 250);
    } else {
      Object.assign(dr, { name, start: v.start, end: v.end || null, dirty: true });
      saveDraft(); renderRotationEditor(dr.id, true);
    }
  };
}
const draftRot = (dr) => ({ id: dr.id, name: dr.name, start_date: dr.start, end_date: dr.end, cycle_len: dr.len, created_at: "9999" });
const draftCycle = (dr) => Object.entries(dr.cyc).filter(([i, x]) => Number(i) < dr.len && x && x.service_id).map(([i, x]) => ({ rotation_id: dr.id, idx: Number(i), service_id: x.service_id, start_time: x.start_time || null, end_time: x.end_time || null }));
// Nur der Rhythmus dieser Rotation (ohne Einzeländerungen, ohne andere Rotationen)
const draftCalc = (dr) => L.create({ ...S.D, rotations: [draftRot(dr)], cycle: draftCycle(dr), days: [] });
const rotCalc = (r) => L.create({ ...S.D, rotations: [r], cycle: (S.D.cycle || []).filter((x) => x.rotation_id === r.id), days: [] });
function renderRotationEditor(id, soft = false) {
  let dr = S.draft;
  if (!dr || dr.id !== id) {
    const r = S.D.rotations.find((x) => x.id === id);
    if (!r) { location.hash = "#/plan"; return; }
    dr = S.draft = draftFrom(r);
  }
  if (!dr.cyc) dr.cyc = {};
  if (dr.tool !== "open" && dr.tool !== "free" && !svById(dr.tool)) dr.tool = "open";
  const c = draftCalc(dr), y = window.scrollY;
  const cycEnd = addDays(dr.start, dr.len - 1);
  // Vorschau: erster Durchgang + Wiederholungen (mind. 8 Wochen, mind. 2 Durchgänge) – höchstens bis zum Endtag
  let pvEnd = addDays(dr.start, Math.max(dr.len * 3, dr.len + 56) - 1);
  if (dr.end && dr.end < pvEnd) pvEnd = dr.end;
  if (pvEnd < cycEnd) pvEnd = cycEnd;
  const first = c.range(dr.start, cycEnd), n = first.filter((r) => !r.free).length, cust = first.filter((r) => r.custom).length;
  const months = []; for (let m = dr.start.slice(0, 7); m <= pvEnd.slice(0, 7); ) { months.push(m); const [yy, mm] = m.split("-").map(Number); m = `${mm === 12 ? yy + 1 : yy}-${pad(mm === 12 ? 1 : mm + 1)}`; }
  const sv = services(), tool = dr.tool;
  const hint = tool === "open" ? "Tag antippen → Dienst wählen, Zeit anpassen" : tool === "free" ? "Tage antippen, um sie auf <b>Frei</b> zu setzen" : `Tage antippen → <b>${esc(svById(tool).label)}</b> eintragen · nochmal tippen = frei`;
  const reps = dr.end ? Math.floor(L.diffDays(dr.start, dr.end) / dr.len) + 1 : null;
  app.innerHTML = `<header class="top ed-top"><button class="iconbtn" id="ed-back" aria-label="Zurück">${ICON.left}</button>
      <button class="ed-title" id="ed-meta"><b>${esc(dr.name)}</b><small>ab ${esc(fmtD(dr.start, { weekday: "short", day: "numeric", month: "short" }))} · ${esc(untilText(dr.end))} ${ICON.edit}</small></button>
      <button class="iconbtn" id="theme" aria-label="Hell/Dunkel">${themeIcon()}</button></header>
    <main class="page editor" id="page">
      <div class="card rhythm" id="rhythm">
        <div class="rh-top"><span class="rh-ic">${ICON.rep}</span><div><b id="rh-text">Rhythmus: ${dr.len} Tage${weeksText(dr.len)}</b><small>wiederholt sich ab ${esc(fmtD(dr.start))} ${esc(untilText(dr.end))}${reps ? ` · ${reps}× ` : ""}</small></div>
          <div class="stepper"><button class="iconbtn sm" data-len="-1" aria-label="Einen Tag kürzer">−</button><button class="iconbtn sm" data-len="1" aria-label="Einen Tag länger">+</button></div></div>
        <div class="chips lenchips">${[7, 14, 21, 28, 35, 42].map((k) => `<button class="chip ${k === dr.len ? "on" : ""}" data-setlen="${k}">${k / 7} Wo.</button>`).join("")}</div>
        <p class="muted small">Kräftig = ein Durchgang zum Eintragen (${esc(fmtD(dr.start))} – ${esc(fmtD(cycEnd))}). <span class="lg-rep-i"></span> Hell = Wiederholung. Tippe in die Wiederholung, um den Rhythmus zu verlängern.</p>
      </div>
      <p class="ed-stats"><span>${n} Dienste</span><span>${dr.len - n} frei</span>${cust ? `<span>⏱ ${cust} abweichend</span>` : ""}${dr.dirty ? `<span class="pill warnp">nicht gespeichert</span>` : `<span class="pill on">gespeichert</span>`}</p>
      ${sv.length ? "" : `<div class="card empty slim"><p><b>Zuerst deine Dienste festlegen</b> – Bezeichnung, Farbe und Zeit. Danach Tage antippen.</p><button class="btn small" data-tool="new">${ICON.plus} Dienst anlegen</button></div>`}
      ${months.map((m) => { const [yy, mm] = m.split("-").map(Number); return `<section class="month ed-month"><h3>${MONTHS[mm - 1]} ${yy}</h3>${monthCells(m, c, { from: dr.start, to: pvEnd, attr: "ed" })}</section>`; }).join("")}
      ${dr.end && pvEnd === dr.end ? `<p class="muted small center">Endtag ${esc(fmtD(dr.end, { day: "numeric", month: "long", year: "numeric" }))} – danach keine Wiederholung.</p>` : `<p class="muted small center">… und so weiter ${esc(untilText(dr.end))}.</p>`}
      ${legendHtml(true, true)}
      <p class="muted small center">Einzelne Tage änderst du im Kalender – das gilt dann nur für diesen Tag, der Rhythmus bleibt.</p>
      ${dr.isNew ? "" : `<p class="center"><button class="link small danger-t" id="ed-del">Rotation löschen</button></p>`}
    </main>
    <div class="palette" role="toolbar" aria-label="Dienst zum Eintragen">
      <p class="pal-hint">${hint}</p>
      <div class="pal-chips">
        <button class="pchip tool ${tool === "open" ? "on" : ""}" data-tool="open">${ICON.edit}<span>Einzeln</span></button>
        ${sv.map((x) => `<button class="pchip ${tool === x.id ? "on" : ""}" ${svSty(x)} data-tool="${x.id}"><b>${esc(x.short)}</b><span>${esc(x.label)}</span><small>${esc(x.kind === "off" ? "ganztägig" : x.start_time + "–" + x.end_time)}</small></button>`).join("")}
        <button class="pchip freec ${tool === "free" ? "on" : ""}" data-tool="free"><b>–</b><span>Frei</span></button>
        <button class="pchip add" data-tool="new">${ICON.plus}<span>Dienst</span></button>
      </div>
      <button class="btn block big" id="ed-save" ${dr.dirty ? "" : "disabled"}>${dr.dirty ? "Rotation speichern" : "Gespeichert ✓"}</button>
    </div>`;
  document.body.classList.add("has-palette");
  $("#theme").onclick = () => { cycleTheme(); };
  $("#ed-back").onclick = async () => {
    if (dr.dirty && !(await confirmSheet("Ohne Speichern zurück?", "Deine Änderungen an dieser Rotation gehen verloren.", "Verwerfen"))) return;
    setDraft(null); location.hash = "#/plan";
  };
  $("#ed-meta").onclick = () => rotationMeta(dr);
  if ($("#ed-del")) $("#ed-del").onclick = async () => {
    if (!(await confirmSheet(`„${dr.name}“ löschen?`, "Der Rhythmus wird entfernt. Einzeln geänderte Tage im Kalender bleiben."))) return;
    await write("rotation_delete", { id: dr.id }).catch(() => null); setDraft(null); location.hash = "#/plan"; toast("Rotation gelöscht");
  };
  const setLen = (k) => { dr.len = Math.max(1, Math.min(400, k)); dr.dirty = true; saveDraft(); renderRotationEditor(dr.id, true); };
  $$("[data-len]").forEach((b) => (b.onclick = () => setLen(dr.len + Number(b.dataset.len))));
  $$("[data-setlen]").forEach((b) => (b.onclick = () => setLen(Number(b.dataset.setlen))));
  $$("[data-tool]").forEach((b) => (b.onclick = () => {
    const k = b.dataset.tool;
    if (k === "new") return serviceEditor(null, (body) => { if (body) dr.tool = body.id; saveDraft(); renderRotationEditor(dr.id, true); });
    dr.tool = k; saveDraft(); renderRotationEditor(dr.id, true);
  }));
  // Antippen in der Wiederholung verlängert den Rhythmus bis zu diesem Tag (volle Wochen, wenn er in Wochen läuft); neue Tage übernehmen, was vorher als Wiederholung zu sehen war
  const extendTo = (d) => {
    const off = L.diffDays(dr.start, d); if (off < dr.len) return;
    let k = off + 1; if (dr.len % 7 === 0) k = Math.ceil(k / 7) * 7;
    k = Math.min(400, k);
    for (let i = dr.len; i < k; i++) { const r = c.resolve(addDays(dr.start, i)); dr.cyc[i] = r.sid ? { service_id: r.sid, start_time: r.custom ? r.s : null, end_time: r.custom ? r.e : null } : null; }
    dr.len = k; toast(`Rhythmus verlängert: ${k} Tage${weeksText(k)}`, 2200);
  };
  $$("[data-ed]").forEach((el) => (el.onclick = () => {
    const d = el.dataset.ed, i = L.diffDays(dr.start, d);
    if (i >= dr.len) { extendTo(d); dr.dirty = true; saveDraft(); if (dr.tool === "open") renderRotationEditor(dr.id, true); }
    if (i >= dr.len) return;
    const cur = dr.cyc[i] || {};
    if (dr.tool === "open") return daySheet(d, { draft: dr, calc: draftCalc(dr), idx: i });
    dr.dirty = true;
    if (dr.tool === "free" || cur.service_id === dr.tool) dr.cyc[i] = null;
    else dr.cyc[i] = { service_id: dr.tool, start_time: null, end_time: null };
    saveDraft();
    if (navigator.vibrate) navigator.vibrate(8);
    renderRotationEditor(dr.id, true);
  }));
  $("#ed-save").onclick = async (e) => {
    const cycle = draftCycle(dr).map(({ rotation_id, ...x }) => x);
    const r = await busy(e.currentTarget, () => write("rotation_save", { id: dr.id, name: dr.name, start_date: dr.start, end_date: dr.end || null, cycle_len: dr.len, cycle })).catch(() => null);
    if (!r) return;
    dr.dirty = false; dr.isNew = false; saveDraft(); rebuild();
    toast(r.queued ? "Gespeichert (offline) – wird synchronisiert" : `„${dr.name}“ gespeichert – wiederholt sich ${untilText(dr.end)}`);
    renderRotationEditor(dr.id, true);
  };
  window.scrollTo(0, soft ? y : 0);
}

// Tag bearbeiten: Dienst wählen, optional abweichende Zeit, Notiz.
// opts.draft → Tag des Rhythmus (gilt für jede Wiederholung); sonst Einzeländerung nur an diesem Datum (day_set / day_clear)
function daySheet(day, opts = {}) {
  const c = opts.calc || calc, dr = opts.draft;
  const r = c.resolve(day);
  const own = dr ? null : S.D.days.find((x) => x.day === day);
  const row = dr ? dr.cyc[opts.idx] || {} : own ? own : { service_id: r.sid, start_time: r.custom ? r.s : null, end_time: r.custom ? r.e : null };
  const st = { sid: row.service_id || null, custom: !!(row.service_id && row.start_time && row.end_time), s: row.start_time || "", e: row.end_time || "", note: (own && own.note) || "" };
  const head = dr ? `Rhythmus „${esc(dr.name)}“ · Tag ${opts.idx + 1} von ${dr.len} – gilt für jede Wiederholung`
    : r.rotation ? `Rotation „${esc(r.rotation)}“ · laut Rhythmus: <b>${esc(r.base_label)}</b>${r.base_s ? ` ${esc(r.base_s)}–${esc(r.base_e)}` : ""}` : "Einzelner Tag (keine Rotation)";
  const { sh, close } = openSheet(`<div class="sheet-head"><h2>${esc(fullDay(day))}</h2><p class="muted">${head}</p></div><div id="ds"></div>`, "tall");
  const draw = () => {
    const sv = svById(st.sid), timed = sv && sv.kind !== "off";
    if (st.custom && timed && !st.s) { st.s = sv.start_time; st.e = sv.end_time; }
    const sl = !dr && st.sid === r.sid ? calc.sleepFor(day) : [];
    $("#ds", sh).innerHTML = `<form id="dayf" class="form">
      ${!dr && r.override ? `<div class="ovr-box"><span>✎</span><div><b>Einzeln geändert</b><small>Laut Rhythmus wäre hier ${esc(r.base_label)}.</small></div><button type="button" class="btn soft small" id="d-reset">Zurück zum Rhythmus</button></div>` : ""}
      <p class="f">Dienst</p>
      <div class="svpick">${services().map((x) => `<button type="button" class="svb ${st.sid === x.id ? "on" : ""}" ${svSty(x)} data-sv="${x.id}"><b>${esc(x.label)}</b><small>${esc(svTimes(x))}</small></button>`).join("")}
        <button type="button" class="svb freeb ${!st.sid ? "on" : ""}" data-sv=""><b>Frei</b><small>kein Dienst</small></button>
        <button type="button" class="svb addb" id="d-new">${ICON.plus}<b>Neuer Dienst</b></button></div>
      ${timed ? `<div class="timebox ${st.custom ? "custom" : ""}">
          <div class="tb-row"><span>${ICON.clock}</span><div><b>${st.custom ? "Abweichende Zeit an diesem Tag" : `${esc(sv.start_time)}–${esc(sv.end_time)}`}</b><small>${st.custom ? `sonst ${esc(sv.start_time)}–${esc(sv.end_time)} (wie „${esc(sv.label)}“)` : `wie bei „${esc(sv.label)}“ festgelegt`}</small></div></div>
          <label class="tog"><input type="checkbox" id="d-cust" ${st.custom ? "checked" : ""}><span>Andere Zeit an diesem Tag</span></label>
          ${st.custom ? `<div class="row2"><input class="inp" type="time" name="s" id="d-s" value="${esc(st.s)}" required><span>bis</span><input class="inp" type="time" name="e" id="d-e" value="${esc(st.e)}" required></div>
            <p class="muted small">Nur ${dr ? "dieser Rhythmus-Tag" : "dieser Tag"} – der Dienst „${esc(sv.label)}“ selbst bleibt unverändert.</p>` : ""}
        </div>` : sv ? `<p class="muted small">„${esc(sv.label)}“ ist ganztägig (ohne Uhrzeit).</p>` : ""}
      ${dr ? "" : `<label class="f" for="d-note">Notiz <span class="muted small">(optional, nur für dich)</span></label><input class="inp" id="d-note" name="note" maxlength="200" value="${esc(st.note)}" placeholder="z. B. Tausch mit Kai">`}
      ${!dr && r.rotation ? `<p class="muted small">Gilt nur für diesen Tag – der Rhythmus bleibt unverändert.</p>` : ""}
      ${!dr ? (trData().m.get(day) || []).map((x) => `<div class="trbox"><span>${x.tr.icon}</span><div><b>${esc(x.title)}</b><small>${esc(x.text)}</small></div></div>`).join("") : ""}
      ${sl.length ? `<p class="muted small">😴 ${sl.map((w) => `${esc(calc.SLEEP_LABEL[w.kind])} ${hm(w.start)}–${hm(w.end)}`).join(" · ")}</p>` : ""}
      <div class="btns"><button type="button" class="btn ghost" data-close>Abbrechen</button><button class="btn" type="submit">${dr ? "Übernehmen" : "Speichern"}</button></div>
    </form>`;
    const keep = () => { if ($("#d-note", sh)) st.note = $("#d-note", sh).value; if ($("#d-s", sh)) { st.s = $("#d-s", sh).value; st.e = $("#d-e", sh).value; } };
    $$("[data-close]", sh).forEach((b) => (b.onclick = () => { close(); if (dr) renderRotationEditor(dr.id, true); }));
    $$("[data-sv]", sh).forEach((b) => (b.onclick = () => { keep(); st.sid = b.dataset.sv || null; st.custom = false; st.s = st.e = ""; draw(); }));
    $("#d-new", sh).onclick = () => { keep(); serviceEditor(null, (body) => { if (body) st.sid = body.id; st.custom = false; draw(); }); };
    if ($("#d-cust", sh)) $("#d-cust", sh).onchange = (e) => { keep(); st.custom = e.target.checked; if (!st.custom) st.s = st.e = ""; draw(); };
    if ($("#d-reset", sh)) $("#d-reset", sh).onclick = async (e) => {
      const r2 = await busy(e.currentTarget, () => write("day_clear", { day })).catch(() => null);
      if (!r2) return; close(); render(true); toast("Tag folgt wieder dem Rhythmus");
    };
    $("#dayf", sh).onsubmit = async (e) => {
      e.preventDefault(); keep();
      const sv2 = svById(st.sid);
      let custom = st.custom && sv2 && sv2.kind !== "off";
      if (custom && st.s === st.e) return toast("Beginn und Ende sind gleich");
      if (custom && st.s === sv2.start_time && st.e === sv2.end_time) custom = false; // gleiche Zeit = keine Abweichung
      const x = { service_id: st.sid, start_time: custom ? st.s : null, end_time: custom ? st.e : null, note: st.note.trim() || null };
      if (dr) { dr.cyc[opts.idx] = x.service_id ? { service_id: x.service_id, start_time: x.start_time, end_time: x.end_time } : null; dr.dirty = true; saveDraft(); close(); renderRotationEditor(dr.id, true); return; }
      // entspricht genau dem Rhythmus (bzw. frei ohne Rotation) und keine Notiz → keine Einzeländerung nötig
      const same = (x.service_id || null) === (r.base_sid || null) && (x.start_time || null) === (r.base_s || null) && (x.end_time || null) === (r.base_e || null);
      const clear = same && !x.note;
      if (clear && !own) { close(); return; }
      const r2 = await busy(e.target.querySelector("[type=submit]"), () => (clear ? write("day_clear", { day }) : write("day_set", { day, ...x }))).catch(() => null);
      if (!r2) return;
      close(); render(true); toast(r2.queued ? "Gespeichert (offline)" : r.rotation && !same ? "Nur dieser Tag geändert" : "Tag gespeichert");
    };
  };
  draw();
}

// ---------- Familie ----------
const shareLink = (token) => `${location.origin}${location.pathname}#/f/${token}`;
function pageFamily() {
  const shares = S.D.shares || [];
  return `<button class="link back" data-act="go" data-href="#/mehr">‹ Mehr</button><section class="hello"><h1>Familie & Teilen</h1><p class="muted">Teile einen Link mit Partner oder Familie. Sie sehen nur lesend, ob du gerade <b>arbeitest</b>, <b>schläfst</b> oder <b>frei</b> hast – ohne eigenes Konto. Notizen bleiben privat.</p></section>
    ${shares.length ? shares.map((s) => `<div class="card share" data-sid="${s.id}"><div class="pat-h"><b>👀 ${esc(s.label || "Freigabe")}</b><span class="muted small">${s.last_viewed_at ? "zuletzt angesehen " + esc(dayLabel(ymd(new Date(s.last_viewed_at)))) : "noch nicht geöffnet"}</span></div>
      <div class="linkbox">${esc(shareLink(s.token))}</div>
      <div class="btns"><button class="btn soft small" data-sh="share">${ICON.share} Teilen</button><button class="btn ghost small" data-sh="copy">${ICON.copy} Kopieren</button><button class="btn ghost small" data-sh="open">Vorschau</button></div>
      <p class="center"><button class="link small danger-t" data-sh="revoke">Link löschen (Zugriff entziehen)</button></p></div>`).join("")
      : `<div class="card empty"><h3>Noch keine Freigabe</h3><p class="muted">Erstelle einen Link – z. B. für deine Partnerin oder die Kinder.</p></div>`}
    <form id="shf" class="card form"><label class="f" for="sh-label">Neuer Link für …</label><input class="inp" id="sh-label" name="label" maxlength="40" placeholder="z. B. Partnerin, Eltern"><button class="btn block" type="submit" ${S.offline && !DEMO ? "disabled" : ""}>${ICON.plus} Link erstellen</button></form>
    ${S.offline && !DEMO ? `<p class="muted small center">Links erstellen geht nur mit Internet.</p>` : ""}`;
}
function bindFamily(root) {
  $("#shf", root).onsubmit = async (e) => {
    e.preventDefault();
    const r = await busy(e.target.querySelector("button"), () => API.fn("share_create", { label: fd(e.target).label })).catch(() => null);
    if (!r) return; S.D.shares = (S.D.shares || []).concat(r.share); render(true); toast("Link erstellt – jetzt teilen");
  };
  $$(".share", root).forEach((c) => {
    const s = S.D.shares.find((x) => x.id === c.dataset.sid), link = shareLink(s.token);
    $$("[data-sh]", c).forEach((b) => (b.onclick = async () => {
      const k = b.dataset.sh;
      if (k === "copy") return copy(link);
      if (k === "open") { location.hash = "#/f/" + s.token; return; }
      if (k === "share") { const text = `Mein Schichtplan bei ShiftFlow – hier siehst du, wann ich arbeite, schlafe oder frei habe:`; if (navigator.share) { try { await navigator.share({ title: "ShiftFlow", text, url: link }); } catch {} } else copy(link); return; }
      if (k === "revoke" && (await confirmSheet("Link löschen?", "Wer den Link hat, sieht deinen Plan danach nicht mehr.", "Löschen"))) {
        await busy(null, () => API.fn("share_revoke", { id: s.id })).catch(() => null); S.D.shares = S.D.shares.filter((x) => x.id !== s.id); render(true);
      }
    }));
  });
}

// Nur-lesen-Ansicht für Familie (#/f/TOKEN), ohne Login
let famTimer = null;
async function renderFamilyView(token) {
  clearInterval(famTimer);
  const ck = "sf-share-" + token;
  app.innerHTML = `<div class="boot"><img src="icons/icon-192.png?v=1793522017" alt="" width="72" height="72"><p>Schichtplan wird geladen …</p></div>`;
  let data = null, offline = false;
  try { data = await API.shareView(token); writeJ(ck, data); }
  catch (e) {
    data = e.offline ? readJ(ck, null) : null; offline = true; // Link widerrufen/ungültig → Kopie verwerfen
    if (!data) localStorage.removeItem(ck);
    if (!data) { app.innerHTML = `<main class="auth"><div class="card empty"><h3>Link nicht verfügbar</h3><p class="muted">${esc(e.message)}</p><a class="btn" href="./">Zu ShiftFlow</a></div></main>`; writeJ("sf-follows", follows().filter((f) => f.token !== token)); return; }
  }
  writeJ("sf-follows", [{ token, name: data.name }].concat(follows().filter((f) => f.token !== token)).slice(0, 5));
  const draw = () => {
    const c = L.create(data), t = today(), now = new Date();
    const st = c.statusAt(now, t);
    const days = c.range(t, addDays(t, 13));
    const until = st.until ? `bis ${whenText(st.until)}` : "";
    const stCls = { arbeitet: "work", schlaeft: "sleep", bereit: "oncall", frei: "free" }[st.state];
    const stIcon = { arbeitet: "🏥", schlaeft: "😴", bereit: "📟", frei: "🌿" }[st.state];
    const mine = S.uid && route().page === "f";
    app.innerHTML = `<header class="top"><img src="icons/icon-192.png?v=1793522017" alt="" width="34" height="34"><b class="brandname">ShiftFlow</b><span class="pill">nur lesen</span>${offline ? `<span class="pill off">Offline</span>` : ""}<span class="sp"></span><button class="iconbtn" id="theme" aria-label="Hell/Dunkel">${themeIcon()}</button></header>
      <main class="page fam-view">
        <section class="hello"><h1>${esc(data.name)}</h1><p class="muted">${esc(fullDay(t))}</p></section>
        <div class="status st-${stCls}" id="fam-status"><span class="si">${stIcon}</span><div><span class="lbl">Gerade</span><b>${esc(st.label)}</b><span>${esc(until)}</span></div></div>
        ${(() => { const nx = c.nextShift(now, t, true, st.state === "arbeitet" || st.state === "bereit" ? st.until : null); return nx ? `<div class="rec rec-ok"><span class="dot"></span><div><b>Nächster Dienst: ${esc(nx.label)}</b><p>${esc(whenText(nx.start))} – ${hm(nx.end)} · ${esc(inText(nx.start))}</p></div></div>` : ""; })()}
        <h2 class="sec">Die nächsten 14 Tage</h2>
        <div class="week fam">${days.map((r) => { const sl = c.sleepFor(r.day).filter((w) => w.kind !== "nap"); return `<div class="wrow ${r.free ? "free" : "svc"} ${r.day === t ? "today" : ""}" ${sty(r)}><span class="wd"><b>${WD[(parseD(r.day).getDay() + 6) % 7]}</b><small>${parseD(r.day).getDate()}.${parseD(r.day).getMonth() + 1}.</small></span><span class="wmain"><b>${r.work ? "Arbeitet" : r.oncall ? "Bereitschaft" : r.off ? esc(r.label) : "Frei"}${r.start ? ` · ${hm(r.start)}–${hm(r.end)}` : ""}</b><small class="wsleep">${sl.map((w) => `😴 schläft ca. ${hm(w.start)}–${hm(w.end)}`).join(" · ")}</small></span></div>`; }).join("")}</div>
        <p class="muted small center">Schlafzeiten sind Empfehlungen aus dem Schichtplan, keine Messung. Aktualisiert sich automatisch.</p>
        <p class="center">${mine ? `<a class="btn ghost" href="#/familie">Zurück</a>` : `<a class="link" href="./">Eigenen Schichtplan mit ShiftFlow anlegen</a>`}</p>
      </main>`;
    $("#theme").onclick = () => { cycleTheme(); draw(); };
  };
  draw();
  famTimer = setInterval(async () => { if (route().page !== "f") return clearInterval(famTimer); try { data = await API.shareView(token); writeJ(ck, data); offline = false; } catch (e) { if (!e.offline) return renderFamilyView(token); offline = true; } draw(); }, 5 * 60000);
  registerSW();
}

// ---------- Mehr / Einstellungen ----------
function pageMore() {
  const p = prefs();
  const th = localStorage.getItem(THEME_KEY) || "auto";
  const tog = (k, label) => `<label class="tog"><input type="checkbox" data-pref="${k}" ${p[k] ? "checked" : ""}><span>${label}</span></label>`;
  const rot = S.D.rotations.length, act = S.D.rotations.find((r) => r.start_date <= today() && (!r.end_date || r.end_date >= today()));
  const mrow = (href, ic, t, sub) => `<button class="mrow" data-act="go" data-href="${href}"><span class="mi">${ic}</span><span class="mb">${t}<small>${sub}</small></span><span class="chev" aria-hidden="true">›</span></button>`;
  return `<section class="hello"><h1>Mehr</h1></section>
    <div class="card"><div class="profile"><span class="avatar">${esc((S.me.display_name || "?").trim().charAt(0).toUpperCase())}</span><div><b>${esc(S.me.display_name)}</b><small>@${esc(S.me.username)}${act ? ` · ${esc(act.name)}` : ""}</small></div></div></div>
    <div class="menu">
      ${mrow("#/plan", ICON.rep, "Plan: Rotationen & Dienste", act ? `${rot} ${rot === 1 ? "Rotation" : "Rotationen"} · „${esc(act.name)}“ läuft` : rot ? `${rot} ${rot === 1 ? "Rotation" : "Rotationen"}` : "Noch keine Rotation")}
      ${mrow("#/familie", ICON.fam, "Familie & Teilen", "Plan teilen, anderen folgen")}
      ${mrow("#/quellen", ICON.book, "Wissen & Quellen", "Leitlinien, Studien, Arbeitszeitgesetz")}
    </div>
    <h2 class="sec">Darstellung</h2>
    <div class="card"><div class="seg"><button data-th="auto" class="${th === "auto" ? "on" : ""}">Automatisch</button><button data-th="light" class="${th === "light" ? "on" : ""}">Hell</button><button data-th="dark" class="${th === "dark" ? "on" : ""}">Dunkel</button></div></div>
    <h2 class="sec">Weg zur Arbeit</h2>
    <div class="card" id="way-card">${wayFields(p)}</div>
    <h2 class="sec">Schlaf & Hinweise</h2>
    <div class="card">
      <label class="f" for="p-need">Wie viel Schlaf brauchst du?</label><select class="inp" id="p-need" data-pref="sleep_need">${[5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map((h) => `<option value="${h}" ${+p.sleep_need === h ? "selected" : ""}>${String(h).replace(".", ",")} Stunden${h === 7.5 ? " (Standard)" : ""}</option>`).join("")}</select>
      <p class="muted small note">Empfohlen: mind. ${L.RULES.sleepMin} Std. pro 24 Std. (AASM/SRS) – auch aufgeteilt in Haupt- und Kurzschlaf.</p>
      <label class="f" for="p-caf">Letzter Kaffee … vor dem Schlafen</label><select class="inp" id="p-caf" data-pref="caffeine_h">${[4, 5, 6, 7, 8, 9, 10].map((h) => `<option value="${h}" ${+p.caffeine_h === h ? "selected" : ""}>${h} Stunden${h === L.RULES.cafDefault ? " (Standard)" : ""}</option>`).join("")}</select>
      <p class="muted small note">Standard: 6 Std. Wer empfindlich auf Koffein reagiert, wählt eher 8–9 Std. (Gardiner 2023).</p>
      <div class="chline">${calc.chrono ? `${calc.chrono.icon} Chronotyp: <b>${esc(calc.chrono.label)}</b>` : "🧬 Chronotyp: <b>noch nicht bestimmt</b>"}<button class="link small" data-act="go" data-href="#/chronotyp">${calc.chrono ? "ändern" : "Test machen"}</button></div>
      ${tog("hint_caffeine", "☕ Koffein-Cutoff anzeigen")}${tog("hint_light", "🚗 Heimweg nach der Nacht (Müdigkeit, Licht) anzeigen")}
    </div>
    <h2 class="sec">Erinnerungen</h2>
    <div class="card" id="push-card"><h3>Smarte Erinnerungen</h3><p class="muted small">Kommen als Push genau passend zu deinem Fahrplan – jede Art einzeln schaltbar.</p><p class="muted small" id="pstate">…</p><div class="btns"><button class="btn small" id="pon">Aktivieren</button><button class="btn ghost small" id="ptest" ${DEMO ? "disabled" : ""}>Test</button></div>
      <div class="ptypes">${PUSH_TYPES.map(([k, l, d]) => `<label class="tog ptog"><input type="checkbox" data-pref="${k}" ${p[k] ? "checked" : ""}><span><b>${l}</b><small>${d}</small></span></label>`).join("")}</div>
      <p class="muted small">iPhone/iPad: Push nur, wenn ShiftFlow über <b>Teilen → Zum Home-Bildschirm</b> installiert ist (iOS 16.4+).</p></div>
    <h2 class="sec">Konto</h2>
    <div class="card"><p class="muted">Angemeldet als <b>${esc(S.me.display_name)}</b> (${esc(S.me.username)})</p>
      <div class="btns col"><button class="btn ghost" id="rename">Namen ändern</button><button class="btn ghost" id="logout">Abmelden</button><button class="btn ghost danger-t" id="delacc">Konto löschen</button></div></div>
    ${DEMO ? `<div class="banner demo">Demo-Modus: Daten bleiben nur in diesem Browser. <button class="link" id="demo-reset">Demo zurücksetzen</button></div>` : ""}
    ${DISCLAIMER}<p class="muted small center">ShiftFlow · ${DEMO ? "Demo" : "Live"}</p>`;
}
function bindMore(root) {
  $$("[data-th]", root).forEach((b) => (b.onclick = () => { localStorage.setItem(THEME_KEY, b.dataset.th); applyTheme(); render(true); }));
  bindPrefSelects(root);
  $("#pon", root).onclick = async (e) => {
    const b = e.currentTarget;
    try { if (b.dataset.on === "1") { await unsubscribePush(); toast("Push auf diesem Gerät aus"); } else { await enablePush(); toast("Push aktiviert 🔔"); } } catch (ex) { toast(ex.message, 5000); }
    pushState();
  };
  $("#ptest", root).onclick = (e) => busy(e.currentTarget, () => API.fn("test_push")).then((r) => toast(r.sent ? "Test-Push gesendet" : "Kein aktives Gerät – erst Push aktivieren")).catch(() => {});
  $("#rename", root).onclick = () => {
    const { sh, close } = openSheet(`<h2>Dein Name</h2><form id="rnf" class="form"><input class="inp" name="n" maxlength="40" required value="${esc(S.me.display_name)}"><div class="btns"><button type="button" class="btn ghost" data-close>Abbrechen</button><button class="btn" type="submit">Speichern</button></div></form>`);
    $("#rnf", sh).onsubmit = async (e) => { e.preventDefault(); const n = fd(e.target).n; const ok = await busy(e.target.querySelector("[type=submit]"), () => API.fn("profile_save", { display_name: n })).catch(() => null); if (ok) { S.me.display_name = n.trim(); try { localStorage.setItem("sf-splash-name", S.me.display_name); } catch {} close(); render(true); } };
  };
  $("#logout", root).onclick = logout;
  $("#delacc", root).onclick = deleteAccount;
  if ($("#demo-reset", root)) $("#demo-reset", root).onclick = () => { localStorage.clear(); location.hash = ""; location.reload(); };
  pushState();
}
function deleteAccount() {
  const { sh, close } = openSheet(`<h2>Konto löschen?</h2><p class="muted">Dein Konto, alle Muster, Tagesänderungen und Freigabe-Links werden endgültig gelöscht. Tippe zur Bestätigung deinen Benutzernamen <b>${esc(S.me.username)}</b>:</p>
    <form id="df" class="form"><input class="inp" name="c" required autocapitalize="none"><div class="btns"><button type="button" class="btn ghost" data-close>Abbrechen</button><button class="btn danger" type="submit">Endgültig löschen</button></div></form>`);
  $("#df", sh).onsubmit = async (e) => {
    e.preventDefault();
    const ok = await busy(e.target.querySelector("[type=submit]"), () => API.fn("delete_account", { confirm: fd(e.target).c })).catch(() => null);
    if (ok) { localStorage.removeItem(cacheKey()); localStorage.removeItem(outKey()); close(); await logout(); toast("Konto gelöscht"); }
  };
}

// ---------- Service Worker + Push ----------
let swReg = null;
async function registerSW() {
  if (!("serviceWorker" in navigator) || swReg) return;
  try { swReg = await navigator.serviceWorker.register("sw.js", { scope: "./" }); swReg.update().catch(() => {}); } catch (e) { console.warn(e); }
}
const b64ToU8 = (b) => { const p = "=".repeat((4 - (b.length % 4)) % 4); const s = atob((b + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
async function enablePush() {
  if (DEMO) throw new Error("Im Demo-Modus gibt es keine Push-Benachrichtigungen");
  if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) {
    const ios = /iPhone|iPad/.test(navigator.userAgent) && !matchMedia("(display-mode: standalone)").matches;
    throw new Error(ios ? "Auf dem iPhone: Teilen → „Zum Home-Bildschirm“, dann die App von dort öffnen und aktivieren." : "Dieser Browser unterstützt keine Push-Benachrichtigungen.");
  }
  const perm = await Notification.requestPermission(); // direkt im Tap aufrufen (iOS)
  if (perm !== "granted") throw new Error("Benachrichtigungen wurden nicht erlaubt (Browser-Einstellungen prüfen).");
  if (!swReg) swReg = await navigator.serviceWorker.register("sw.js", { scope: "./" });
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(C.vapidPublicKey) });
  await API.fn("subscribe", { subscription: sub.toJSON() });
}
async function unsubscribePush(quiet = false) {
  if (DEMO) return;
  try { const reg = swReg || (await navigator.serviceWorker?.getRegistration()); const sub = await reg?.pushManager?.getSubscription(); if (sub) { await API.fn("unsubscribe", { endpoint: sub.endpoint }).catch(() => {}); if (!quiet) await sub.unsubscribe(); } } catch {}
}
async function pushState() {
  const el = $("#pstate"), b = $("#pon"); if (!el) return;
  let on = false;
  try { if (window.Notification && Notification.permission === "granted") { const reg = swReg || (await navigator.serviceWorker.getRegistration()); on = !!(await reg?.pushManager.getSubscription()); } } catch {}
  el.innerHTML = DEMO ? "Im Demo-Modus nicht verfügbar" : on ? "🔔 <b>Aktiv</b> auf diesem Gerät" : window.Notification?.permission === "denied" ? "🔕 Im Browser blockiert" : "🔕 Aus auf diesem Gerät";
  b.textContent = on ? "Ausschalten" : "Aktivieren"; b.dataset.on = on ? "1" : "0"; b.classList.toggle("ghost", on); b.disabled = DEMO;
}
navigator.serviceWorker?.addEventListener("message", (e) => { if (e.data?.type === "open" && e.data.url) { const u = new URL(e.data.url); location.hash = u.hash || "#/"; } });

window.addEventListener("hashchange", () => {
  $$(".sheet,.backdrop").forEach((x) => x.remove()); document.body.classList.remove("noscroll");
  const r = route();
  if (r.page === "f") return renderFamilyView(r.id);
  clearInterval(famTimer);
  if (S.D) render(); else if (!S.uid) boot();
});
window.addEventListener("online", () => { if (S.uid) reload().catch(() => {}); });
window.addEventListener("offline", () => { if (S.uid) { S.offline = true; if (!$(".sheet")) render(true); } });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.D) reload().catch(() => {}); });
// Minütlich neu zeichnen (Live-Status, „noch … bis“), ohne offene Sheets/Eingaben zu stören
setInterval(() => { if (S.D && !$(".sheet") && route().page === "home" && document.visibilityState === "visible" && !document.activeElement?.matches?.("input,select")) render(true); }, 60000);
boot();
})();
