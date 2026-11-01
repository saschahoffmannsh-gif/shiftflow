/* ShiftFlow – Demo-Backend: gleiche Schnittstelle wie Supabase + Edge Function, Daten nur im localStorage dieses Browsers */
window.SF_DEMO_BACKEND = function (C) {
  "use strict";
  const KEY = "sf-demo-db", SKEY = "sf-demo-session";
  const L = window.SF_LOGIC;
  const blank = () => ({ v: 3, users: [], prefs: [], services: [], rotations: [], cycle: [], days: [], shares: [], sleep: [] });
  let db; try { db = JSON.parse(localStorage.getItem(KEY)) || blank(); } catch { db = blank(); }
  if (db.v !== 3) db = blank(); // altes Demo-Format verwerfen (v3: Rotation = Rhythmus)
  db.sleep = db.sleep || [];
  const listeners = new Set();
  const bc = "BroadcastChannel" in window ? new BroadcastChannel("sf-demo") : null;
  if (bc) bc.onmessage = () => { try { db = JSON.parse(localStorage.getItem(KEY)) || blank(); db.sleep = db.sleep || []; } catch {} listeners.forEach((f) => f()); };
  const save = () => { localStorage.setItem(KEY, JSON.stringify(db)); bc?.postMessage(1); };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));
  const now = () => new Date().toISOString();
  const pad = (n) => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const fail = (m) => { throw new Error(m); };
  const str = (v, max) => { const s = String(v ?? "").trim().slice(0, max); return s || null; };
  const hash = (s) => [...String(s)].reduce((a, c) => ((a * 31 + c.charCodeAt(0)) | 0), 7).toString(36);
  const sess = () => { try { return JSON.parse(localStorage.getItem(SKEY)); } catch { return null; } };
  const KINDS = ["work", "oncall", "off"], colorRe = /^#[0-9A-Fa-f]{6}$/, hmRe = /^([01]\d|2[0-3]):[0-5]\d$/, dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const tok = () => Array.from({ length: 24 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"[Math.floor(Math.random() * 57)]).join("");
  const DEF = { sleep_need: 7.5, caffeine_h: 6, lead_min: 90, commute_min: 30, hint_caffeine: true, hint_light: true, push_winddown: true, push_caffeine: false, push_light: true, push_shift: false, push_nap: true, push_bed30: false, push_diary: false };

  // Tagebuch-Eintrag prüfen (gleiche Regeln wie die Edge Function)
  function sleepRow(uid, b) {
    const day = String(b.day || ""), bed = String(b.bed || ""), wake = String(b.wake || "");
    if (!dateRe.test(day)) fail("Datum fehlt");
    if (!hmRe.test(bed) || !hmRe.test(wake)) fail("Bitte Bett- und Aufwachzeit angeben");
    const bd = [day, L.addDays(day, -1)].includes(b.bed_day) ? b.bed_day : L.diaryBedDay(day, bed, wake);
    const bedAt = new Date(`${bd}T${bed}:00`), wakeAt = new Date(`${day}T${wake}:00`), h = (wakeAt - bedAt) / 36e5;
    if (!(h > 0 && h <= 20)) fail("Schlafdauer muss zwischen 0 und 20 Std. liegen");
    const q = Math.round(Number(b.quality)); if (!(q >= 1 && q <= 5)) fail("Bitte Schlafqualität 1–5 wählen");
    return { id: uuid(), user_id: uid, day, bed_at: bedAt.toISOString(), wake_at: wakeAt.toISOString(), quality: q, naps_min: Math.min(600, Math.max(0, Math.round(Number(b.naps_min) || 0))), created_at: now(), updated_at: now() };
  }
  function action(a, b) {
    if (a === "config") return { vapidPublicKey: "", emailDomain: C.emailDomain };
    if (a === "share_view") {
      const sh = db.shares.find((s) => s.token === String(b.token || "")); if (!sh) fail("Diese Freigabe gibt es nicht mehr");
      sh.last_viewed_at = now(); save();
      const u = db.users.find((x) => x.id === sh.user_id), p = db.prefs.find((x) => x.user_id === sh.user_id) || DEF;
      return { name: u?.display_name || "?", prefs: { sleep_need: p.sleep_need }, services: db.services.filter((x) => x.user_id === sh.user_id), rotations: db.rotations.filter((x) => x.user_id === sh.user_id).map((x) => ({ ...x, name: "" })), cycle: db.cycle.filter((x) => x.user_id === sh.user_id), days: db.days.filter((x) => x.user_id === sh.user_id).map(({ note, ...x }) => x), today: today() };
    }
    if (a === "signup") {
      const username = String(b.username || "").trim().toLowerCase();
      if (!/^[a-z0-9_.-]{3,24}$/.test(username)) fail("Benutzername: 3–24 Zeichen, nur a–z, 0–9, _ . -");
      if (String(b.password || "").length < 8) fail("Passwort braucht mindestens 8 Zeichen");
      if (!b.consent) fail("Bitte der Datenschutz-Information zustimmen");
      if (db.users.some((u) => u.username === username)) fail("Benutzername ist schon vergeben – bitte einen anderen wählen");
      const id = uuid();
      db.users.push({ id, username, display_name: String(b.display_name || "").trim().slice(0, 40) || username, pw: hash(b.password), created_at: now() });
      db.prefs.push({ user_id: id, ...DEF });
      save(); return { ok: true };
    }
    const s = sess(); if (!s) fail("Nicht angemeldet");
    const me = db.users.find((u) => u.id === s.uid); if (!me) fail("Kein Profil gefunden");
    switch (a) {
      case "profile_save": me.display_name = str(b.display_name, 40) || fail("Name fehlt"); break;
      case "prefs_save": {
        let p = db.prefs.find((x) => x.user_id === me.id); if (!p) { p = { user_id: me.id, ...DEF }; db.prefs.push(p); }
        const q = b.prefs || {};
        for (const k of Object.keys(DEF)) if (q[k] !== undefined) p[k] = q[k];
        if (q.lead_min !== undefined) p.lead_min = Math.min(240, Math.max(15, Math.round(Number(q.lead_min) / 15) * 15 || 90));
        if (q.commute_min !== undefined) p.commute_min = Math.min(180, Math.max(0, Math.round(Number(q.commute_min)) || 0));
        break;
      }
      case "chrono_save": {
        const r = L.chronotype(b.answers || {}); if (!r) fail("Bitte alle Fragen beantworten");
        let p = db.prefs.find((x) => x.user_id === me.id); if (!p) { p = { user_id: me.id, ...DEF }; db.prefs.push(p); }
        Object.assign(p, { chronotype: r.type, chrono_score: r.score, chrono_msf: r.msf, chrono_answers: b.answers, chrono_at: now() });
        save(); return { ok: true, ...r };
      }
      case "chrono_clear": { const p = db.prefs.find((x) => x.user_id === me.id); if (p) Object.assign(p, { chronotype: null, chrono_score: null, chrono_msf: null, chrono_answers: null, chrono_at: null }); break; }
      case "sleep_log_save": {
        const row = sleepRow(me.id, b); db.sleep = db.sleep.filter((x) => !(x.user_id === me.id && x.day === row.day)).concat(row);
        save(); return { ok: true, day: row.day };
      }
      case "sleep_log_delete": db.sleep = db.sleep.filter((x) => !(x.user_id === me.id && x.day === b.day)); break;
      case "service_save": {
        const label = str(b.label, 30) || fail("Bezeichnung fehlt");
        if (!colorRe.test(b.color || "")) fail("Farbe fehlt");
        const kind = KINDS.includes(b.kind) ? b.kind : "work";
        const st = hmRe.test(b.start_time || "") ? b.start_time : null, et = hmRe.test(b.end_time || "") ? b.end_time : null;
        if (kind !== "off" && (!st || !et || st === et)) fail("Bitte Beginn und Ende angeben");
        const id = b.id || uuid(), ex = db.services.find((x) => x.id === id);
        if (ex && ex.user_id !== me.id) fail("Nicht erlaubt");
        const row = { id, user_id: me.id, label, short: str(b.short, 3) || L.autoShort(label), color: b.color, kind, start_time: kind === "off" ? null : st, end_time: kind === "off" ? null : et, lead_min: kind !== "off" && Number(b.lead_min) >= 15 ? Math.min(240, Math.round(Number(b.lead_min))) : null, sort: Number(b.sort) || 0, created_at: ex?.created_at || now() };
        db.services = db.services.filter((x) => x.id !== id).concat(row); save(); return { ok: true, id };
      }
      case "service_delete":
        if (!db.services.some((x) => x.id === b.id && x.user_id === me.id)) break;
        db.services = db.services.filter((x) => x.id !== b.id);
        db.days.forEach((d) => { if (d.service_id === b.id) { d.service_id = null; d.start_time = d.end_time = null; } });
        db.cycle = db.cycle.filter((x) => x.service_id !== b.id); break;
      case "rotation_save": {
        if (!dateRe.test(b.start_date || "")) fail("Starttag fehlt");
        const end = b.end_date || null;
        if (end && !dateRe.test(end)) fail("Endtag ungültig");
        if (end && end < b.start_date) fail("Der Endtag liegt vor dem Start");
        const n = Math.round(Number(b.cycle_len)); if (!(n >= 1 && n <= 400)) fail("Rhythmus: 1 bis 400 Tage");
        const id = b.id || uuid(), ex = db.rotations.find((x) => x.id === id);
        if (ex && ex.user_id !== me.id) fail("Nicht erlaubt");
        const mine = new Set(db.services.filter((x) => x.user_id === me.id).map((x) => x.id)), seen = new Set();
        db.rotations = db.rotations.filter((x) => x.id !== id).concat({ id, user_id: me.id, name: str(b.name, 40) || "Rotation", start_date: b.start_date, end_date: end, cycle_len: n, created_at: ex?.created_at || now() });
        db.cycle = db.cycle.filter((x) => x.rotation_id !== id);
        for (const x of Array.isArray(b.cycle) ? b.cycle : []) {
          const idx = Math.round(Number(x.idx)); if (!(idx >= 0 && idx < n) || seen.has(idx) || !x.service_id) continue;
          if (!mine.has(x.service_id)) fail("Unbekannter Dienst");
          seen.add(idx);
          const own = hmRe.test(x.start_time || "") && hmRe.test(x.end_time || "") && x.start_time !== x.end_time;
          db.cycle.push({ rotation_id: id, user_id: me.id, idx, service_id: x.service_id, start_time: own ? x.start_time : null, end_time: own ? x.end_time : null });
        }
        save(); return { ok: true, id };
      }
      case "rotation_delete":
        if (!db.rotations.some((x) => x.id === b.id && x.user_id === me.id)) break;
        db.rotations = db.rotations.filter((x) => x.id !== b.id); db.cycle = db.cycle.filter((x) => x.rotation_id !== b.id); break;
      case "day_set": {
        if (!dateRe.test(b.day || "")) fail("Datum fehlt");
        const sid = b.service_id && db.services.some((x) => x.id === b.service_id && x.user_id === me.id) ? b.service_id : null;
        if (b.service_id && !sid) fail("Unbekannter Dienst");
        const own = sid && hmRe.test(b.start_time || "") && hmRe.test(b.end_time || "") && b.start_time !== b.end_time;
        db.days = db.days.filter((d) => !(d.user_id === me.id && d.day === b.day));
        db.days.push({ user_id: me.id, day: b.day, rotation_id: null, service_id: sid, start_time: own ? b.start_time : null, end_time: own ? b.end_time : null, note: str(b.note, 200) });
        break;
      }
      case "day_clear":
        if (!dateRe.test(b.day || "")) fail("Datum fehlt");
        db.days = db.days.filter((d) => !(d.user_id === me.id && d.day === b.day)); break;
      case "share_create": { const sh = { id: uuid(), user_id: me.id, token: tok(), label: str(b.label, 40), created_at: now(), last_viewed_at: null }; db.shares.push(sh); save(); return { ok: true, share: sh }; }
      case "share_revoke": db.shares = db.shares.filter((x) => !(x.id === b.id && x.user_id === me.id)); break;
      case "subscribe": case "unsubscribe": case "test_push": fail("Im Demo-Modus gibt es keine Push-Benachrichtigungen");
      case "delete_account":
        if (String(b.confirm || "").trim().toLowerCase() !== me.username) fail("Bitte deinen Benutzernamen zur Bestätigung eingeben");
        for (const k of ["prefs", "services", "rotations", "cycle", "days", "shares", "sleep"]) db[k] = db[k].filter((x) => x.user_id !== me.id);
        db.users = db.users.filter((u) => u.id !== me.id); localStorage.removeItem(SKEY); break;
      default: fail("Unbekannte Aktion");
    }
    save(); return { ok: true };
  }

  return {
    demo: true,
    async session() { const s = sess(); return s && db.users.some((u) => u.id === s.uid) ? { uid: s.uid } : null; },
    async signIn(username, password) {
      const u = db.users.find((x) => x.username === String(username).trim().toLowerCase());
      if (!u || u.pw !== hash(password)) throw new Error("Benutzername oder Passwort stimmt nicht");
      localStorage.setItem(SKEY, JSON.stringify({ uid: u.id }));
    },
    async signOut() { localStorage.removeItem(SKEY); },
    async fn(a, body = {}) { await new Promise((r) => setTimeout(r, 60)); return JSON.parse(JSON.stringify(action(a, body))); },
    async me(uid) { const u = db.users.find((x) => x.id === uid); return u ? { id: u.id, username: u.username, display_name: u.display_name } : null; },
    async load(uid) {
      const p = db.prefs.find((x) => x.user_id === uid) || { user_id: uid, ...DEF };
      const mine = (k) => db[k].filter((x) => x.user_id === uid);
      return JSON.parse(JSON.stringify({ prefs: p, services: mine("services"), rotations: mine("rotations"), cycle: mine("cycle"), days: mine("days"), shares: mine("shares"), sleep: mine("sleep") }));
    },
    realtime(uid, cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async shareView(token) { return this.fn("share_view", { token }); },
    async seedDemo() {
      db = blank();
      const id = uuid(), t = today();
      db.users.push({ id, username: "sascha", display_name: "Sascha", pw: hash("demo1234"), created_at: now() });
      db.prefs.push({ user_id: id, ...DEF });
      // Beispiel: eigene Dienste + eine Rotation über diesen und nächsten Monat, Tag für Tag
      const sv = (label, short, color, kind, st, et, sort) => { const x = { id: uuid(), user_id: id, label, short, color, kind, start_time: st, end_time: et, sort, created_at: now() }; db.services.push(x); return x.id; };
      const F = sv("Früh", "F", "#F5B82E", "work", "06:00", "14:00", 1), S = sv("Spät", "S", "#EA6A2A", "work", "14:00", "22:00", 2), N = sv("Nacht", "N", "#4B2C7D", "work", "22:00", "06:00", 3), B = sv("Rufdienst", "RD", "#C2306A", "oncall", "08:00", "20:00", 4), U = sv("Urlaub", "U", "#2C9A69", "off", null, null, 5);
      // Rhythmus über 14 Tage, beginnt vor 2 Tagen und wiederholt sich unbegrenzt
      const rs = L.addDays(t, -2), rid = uuid();
      db.rotations.push({ id: rid, user_id: id, name: "Station 3", start_date: rs, end_date: null, cycle_len: 14, created_at: now() });
      const seq = [F, F, N, N, null, null, S, S, S, null, null, F, F, null];
      seq.forEach((s, i) => { if (s) db.cycle.push({ rotation_id: rid, user_id: id, idx: i, service_id: s, start_time: null, end_time: null }); });
      // Einzeländerungen obendrauf
      const set = (d, s, st, et, note) => { db.days = db.days.filter((x) => x.day !== d); db.days.push({ user_id: id, day: d, rotation_id: null, service_id: s, start_time: st, end_time: et, note }); };
      set(L.addDays(rs, 8), S, "13:00", "21:30", "Übergabe früher");
      set(L.addDays(t, 11), B, null, null, "Rufbereitschaft");
      for (let i = 20; i < 25; i++) set(L.addDays(t, i), U, null, null, null);
      db.shares.push({ id: uuid(), user_id: id, token: "DemoFamilie2026Link1234", label: "Familie", created_at: now(), last_viewed_at: null });
      // Beispiel-Schlaftagebuch der letzten 14 Tage (geplanter Schlaf ± typische Abweichungen, 2 Lücken)
      const c = L.create({ prefs: DEF, services: db.services, rotations: db.rotations, cycle: db.cycle, days: db.days });
      const late = [40, 15, 75, 0, 30, 90, 20, 45, 10, 60, 25, 0, 35, 50], early = [0, 20, 0, 30, 10, 0, 45, 0, 15, 30, 0, 10, 0, 20], qual = [3, 4, 2, 4, 3, 2, 3, 4, 5, 3, 3, 4, 2, 3];
      for (let i = 13; i >= 1; i--) {
        if (i === 9 || i === 4) continue;
        const d = L.addDays(t, -i), p = c.diaryDefaults(d), k = 13 - i;
        const bed = new Date(+new Date(`${p.bedDay}T${p.bed}:00`) + late[k] * 6e4), wake = new Date(+new Date(`${d}T${p.wake}:00`) - early[k] * 6e4);
        if (wake - bed < 2 * 36e5) continue;
        db.sleep.push({ id: uuid(), user_id: id, day: d, bed_at: bed.toISOString(), wake_at: wake.toISOString(), quality: qual[k], naps_min: k % 4 === 1 ? 20 : 0, created_at: now(), updated_at: now() });
      }
      save(); localStorage.setItem(SKEY, JSON.stringify({ uid: id }));
    },
  };
};
