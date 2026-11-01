/* ShiftFlow – Schicht-, Schlaf- und Hinweislogik (ohne DOM).
   Läuft im Browser (window.SF_LOGIC) und identisch in der Edge Function (globalThis.SF_LOGIC; deploy.sh kopiert die Datei).
   Alle Hinweise sind allgemeine Schlafhygiene-Tipps – keine medizinische Beratung. Faustregeln + Quellen: RULES/SOURCES. */
(function (root) {
"use strict";
// Dienste legt jede:r selbst an (Bezeichnung, Kürzel, Farbe, Zeiten, Art). Keine festen Schichtarten, keine Vorlagen.
// kind: "work" = Arbeit, "oncall" = Bereitschaft, "off" = ganztägig ohne Zeit (z. B. Urlaub); kein Dienst = frei.
const KINDS = { work: "Arbeit", oncall: "Bereitschaft", off: "Ganztägig (ohne Zeit)" };
const COLORS = ["#F5B82E", "#EA6A2A", "#D9481F", "#C8553D", "#C2306A", "#9C2F8F", "#4B2C7D", "#3E4A9C", "#1F7A8C", "#2C9A69", "#7A8C2C", "#8B5A3C"];
// Lesbare Schrift auf jeder Farbe (dunkel auf hell, weiß auf dunkel)
function ink(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "")); if (!m) return "#fff";
  const n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return L > 0.36 ? "#2B1A12" : "#FFFFFF";
}
// Kürzel: ein Wort → erster Buchstabe (F, S, N), bei Kollision zwei; mehrere Wörter → Initialen
const autoShort = (label, taken = []) => {
  const w = String(label || "").trim().split(/\s+/).filter(Boolean); if (!w.length) return "?";
  const t = new Set(taken.map((x) => String(x).toUpperCase()));
  const c = w.length > 1 ? [w.slice(0, 2).map((x) => x[0]).join(""), w[0].slice(0, 2)] : [w[0][0], w[0].slice(0, 2), w[0].slice(0, 3)];
  return (c.map((x) => x.toUpperCase()).find((x) => !t.has(x)) || c[0]).toUpperCase();
};
const H = 3600e3, MIN = 60e3;
const pad = (n) => String(n).padStart(2, "0");
const addDays = (day, n) => { const t = new Date(day + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const diffDays = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
const mod = (a, n) => ((a % n) + n) % n;
const toMin = (hm) => { const [h, m] = String(hm).split(":").map(Number); return h * 60 + m; };
const hmRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const localAt = (day, hm) => new Date(`${day}T${hm}:00`);
const localFmt = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
// Nachtdienst = Arbeitszeit überdeckt mindestens 3 Std. zwischen 0 und 5 Uhr
function isNight(s, e) {
  if (!hmRe.test(s || "") || !hmRe.test(e || "")) return false;
  const a = toMin(s), b = toMin(e) <= a ? toMin(e) + 1440 : toMin(e);
  const ov = (x, y) => Math.max(0, Math.min(b, y) - Math.max(a, x));
  return ov(0, 300) + ov(1440, 1740) >= 180;
}
const hours = (h) => { const r = Math.round(h * 2) / 2; return (r % 1 ? String(r).replace(".", ",") : String(r)) + " Std."; };

// ---- Faustregeln (v4) – jede Zahl stammt aus einer Quelle in SOURCES (Seite „Quellen“ in der App) ----
const RULES = {
  sleepMin: 7,          // AASM/SRS-Konsens 2015: Erwachsene ≥ 7 Std.; Schichtarbeit: 7–9 Std. pro 24 Std., auch aufgeteilt (Shriane 2023)
  restMin: 11,          // § 5 ArbZG: mind. 11 Std. ununterbrochene Ruhezeit; ≤ 11 Std. = „Quick Return“ (Vedaa 2016/2017)
  nightsMax: 3,         // möglichst nicht mehr als 3 Nachtdienste hintereinander (RKW nach DGAUM; BAuA: Nachtblöcke möglichst kurz)
  afterNightsMin: 24,   // BAuA: nach einer Nachtschichtphase auf keinen Fall weniger als 24 Std. Ruhe …
  afterNightsGood: 48,  // … optimal 48 Std.
  cafDefault: 6,        // Standard 6 Std. (Drake 2013: ≥ 6 Std. Abstand); empfindliche Menschen eher 8–9 Std. (Gardiner 2023: eine Tasse Kaffee ≥ 8,8 Std.)
  napMin: 90,           // Vorschlaf vor der Nacht ca. 90 Min. (NIOSH: Ende eines Schlafzyklus → weniger Schlaftrunkenheit; DGSM: 1–2 Std.)
  napGapMin: 90,        // Ende Vorschlaf → Dienstbeginn: Schlaftrunkenheit 15–30 Min. (NIOSH, Shriane 2023) + Weg zur Arbeit
  leadDefault: 90,     // Vorlauf: Aufstehen bis Dienstbeginn (Fertigmachen + Arbeitsweg), einstellbar in 15-Min.-Schritten, je Dienst überschreibbar
  commuteDefault: 30,  // Arbeitsweg (einfach) – gilt auch als Heimweg nach Dienstende
  inertiaMin: 30,      // nach dem Aufwachen 15–30 Min. Schlaftrunkenheit, bevor man fährt (NIOSH, Shriane 2023)
  recoverMin: 270,      // nach der letzten Nacht nur kurz schlafen (Shriane 2023, Empfehlung 5) – hier 3 Schlafzyklen à 90 Min.
  powerNapMin: 20,      // Powernap 10–20 Min. erholt am besten ohne Schlaftrunkenheit (Brooks & Lack 2006)
  powerNapLatest: "16:00", // Powernap nach dem Frühdienst spätestens bis 16 Uhr beenden (sonst leidet der Nachtschlaf)
  stepMin: 60,          // Schlaf schrittweise um ca. 1 Std. pro Tag verschieben (Eastman & Burgess 2009; Burgess et al. 2002)
  mealGapH: 3,          // letzte größere Mahlzeit ca. 3 Std. vor dem Schlafen; nachts 0–6 Uhr möglichst nichts Großes (Chellappa 2021, NIOSH)
  needDefault: 7.5,     // Schlafbedarf für das Tagebuch (einstellbar 5–10 Std.)
};
// Chronotyp (Kurztest aus rMEQ, Adan & Almirall 1991, + MCTQ-Frage zur Schlafmitte an freien Tagen, Roenneberg 2003).
// wake = Verschiebung der freien Aufwachzeit (Min.), nightDays/earlyDays = wie viele Tage vorher schrittweise verschoben wird.
// Frühtypen tun sich mit Nächten schwerer, Spättypen mit Frühdiensten (Juda et al. 2013; Vetter et al. 2015).
const CHRONO = {
  lerche:      { label: "Lerche", icon: "🐦", wake: -60, nightDays: 3, earlyDays: 1, hard: "N", text: "Du wirst früh wach und früh müde. Frühdienste liegen dir, Nächte kosten dich mehr Kraft – Vorschlaf und Erholung danach sind für dich besonders wichtig." },
  eher_lerche: { label: "Eher Lerche", icon: "🐦", wake: -30, nightDays: 3, earlyDays: 1, hard: "N", text: "Eher Morgenmensch. Frühdienste fallen dir leichter als Nächte – vor Nachtblöcken lohnt es sich, schon 2–3 Tage vorher später ins Bett zu gehen." },
  neutral:     { label: "Neutral", icon: "🕊️", wake: 0, nightDays: 2, earlyDays: 2, hard: null, text: "Weder ausgeprägter Morgen- noch Abendmensch. Du kannst dich in beide Richtungen anpassen – am besten schrittweise über 2 Tage." },
  eher_eule:   { label: "Eher Eule", icon: "🦉", wake: 30, nightDays: 1, earlyDays: 3, hard: "E", text: "Eher Abendmensch. Nächte fallen dir leichter, frühe Wecker schwerer – vor Frühdiensten schrittweise früher ins Bett und morgens Licht tanken." },
  eule:        { label: "Eule", icon: "🦉", wake: 60, nightDays: 1, earlyDays: 3, hard: "E", text: "Ausgeprägter Abendmensch. Nachtdienste liegen dir eher, Frühdienste sind am härtesten – plane vor Frühdiensten 2–3 Tage Vorlauf mit Morgenlicht ein." },
};
const CHRONO_Q = [
  { id: "wake", q: "Wenn du deinen Tag völlig frei planen könntest: Wann würdest du am liebsten aufstehen?", a: [["05:00–06:30", 5], ["06:30–07:45", 4], ["07:45–09:45", 3], ["09:45–11:00", 2], ["11:00–12:00", 1]] },
  { id: "fresh", q: "Wie fühlst du dich in der ersten halben Stunde nach dem Aufstehen?", a: [["Sehr müde", 1], ["Eher müde", 2], ["Eher frisch", 3], ["Sehr frisch", 4]] },
  { id: "tired", q: "Um welche Uhrzeit wirst du abends müde und brauchst Schlaf?", a: [["20:00–21:00", 5], ["21:00–22:15", 4], ["22:15–00:45", 3], ["00:45–02:00", 2], ["02:00–03:00", 1]] },
  { id: "peak", q: "Zu welcher Tageszeit fühlst du dich typischerweise am besten?", a: [["05–08 Uhr", 5], ["08–10 Uhr", 4], ["10–17 Uhr", 3], ["17–22 Uhr", 2], ["22–05 Uhr", 1]] },
  { id: "self", q: "Bist du eher ein Morgen- oder ein Abendmensch?", a: [["Eindeutig Morgenmensch", 6], ["Eher Morgenmensch", 4], ["Eher Abendmensch", 2], ["Eindeutig Abendmensch", 0]] },
  { id: "free_sleep", q: "An freien Tagen ohne Wecker: Wann schläfst du ungefähr ein?", time: true, def: "23:30" },
  { id: "free_wake", q: "…und wann wachst du an freien Tagen von selbst auf?", time: true, def: "08:00" },
];
// Auswertung: rMEQ-Summe 4–25 (22–25 Lerche, 18–21 eher Lerche, 12–17 neutral, 8–11 eher Eule, 4–7 Eule);
// bei „neutral“ entscheidet die Schlafmitte an freien Tagen (MSF) als Feinjustierung (≥ 5:00 eher Eule, ≤ 3:00 eher Lerche).
function chronotype(ans) {
  ans = ans || {}; let score = 0;
  for (const q of CHRONO_Q.filter((x) => !x.time)) {
    const v = Number(ans[q.id]);
    if (!q.a.some((o) => o[1] === v) || ans[q.id] === null || ans[q.id] === "" || ans[q.id] === undefined) return null;
    score += v;
  }
  let msf = null;
  if (hmRe.test(ans.free_sleep || "") && hmRe.test(ans.free_wake || "")) {
    const a = toMin(ans.free_sleep), d = mod(toMin(ans.free_wake) - a, 1440);
    if (d >= 180 && d <= 960) msf = mod(Math.round(a + d / 2), 1440);
  }
  let type = score >= 22 ? "lerche" : score >= 18 ? "eher_lerche" : score >= 12 ? "neutral" : score >= 8 ? "eher_eule" : "eule";
  if (type === "neutral" && msf !== null) { const m = msf >= 720 ? msf - 1440 : msf; if (m >= 300) type = "eher_eule"; else if (m <= 180) type = "eher_lerche"; }
  return { type, score, msf };
}
// Sonnenauf-/untergang (NOAA-Näherung, Standard: Mitte Deutschlands) – für „Sonnenbrille ja/nein“ auf dem Heimweg
function sun(day, lat = 51.2, lon = 10.4) {
  const y = Number(day.slice(0, 4)), base = Date.UTC(y, Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  const n = Math.round((base - Date.UTC(y, 0, 1)) / 864e5) + 1, g = 2 * Math.PI / 365 * (n - 1);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const la = lat * Math.PI / 180, c = Math.cos(90.833 * Math.PI / 180) / (Math.cos(la) * Math.cos(dec)) - Math.tan(la) * Math.tan(dec);
  const ha = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  return { rise: new Date(base + (720 - 4 * (lon + ha) - eqt) * MIN), set: new Date(base + (720 - 4 * (lon - ha) - eqt) * MIN) };
}
const SOURCES = [
  { id: "duration", title: "Recommended Amount of Sleep for a Healthy Adult (Konsens)", org: "AASM & Sleep Research Society", year: 2015, url: "https://doi.org/10.5664/jcsm.4758", use: "Schlafziel: mind. 7 Std." },
  { id: "shift-hygiene", title: "Healthy sleep practices for shift workers (Delphi-Konsens, 18 Empfehlungen)", org: "Shriane et al., SLEEP", year: 2023, url: "https://doi.org/10.1093/sleep/zsad182", use: "7–9 Std. pro 24 Std. (auch aufgeteilt), Kurzschlaf, Schlaftrunkenheit, dunkler und kühler Schlafraum, Übergang in freie Tage" },
  { id: "rest", title: "Arbeitszeitgesetz § 5 – Ruhezeit", org: "Bundesrecht", year: null, url: "https://www.gesetze-im-internet.de/arbzg/__5.html", use: "mind. 11 Std. Ruhe zwischen zwei Diensten (mit Ausnahmen, z. B. Krankenhaus)" },
  { id: "quick-returns", title: "Systematic review of the relationship between quick returns in rotating shift work and health-related outcomes", org: "Vedaa et al., Ergonomics", year: 2016, url: "https://doi.org/10.1080/00140139.2015.1052020", use: "kurze Wechsel → weniger Schlaf, mehr Müdigkeit" },
  { id: "quick-returns-diary", title: "Sleep detriments associated with quick returns in rotating shift work", org: "Vedaa et al., JOEM", year: 2017, url: "https://doi.org/10.1097/JOM.0000000000001006", use: "bei Quick Returns im Schnitt nur 5,6 Std. Schlaf" },
  { id: "baua", title: "Gestaltung von Nacht- und Schichtarbeit – Handlungsempfehlungen", org: "BAuA", year: null, url: "https://www.baua.de/DE/Themen/Arbeitsgestaltung/Arbeitszeit/Nacht-und-Schichtarbeit", use: "Nachtblöcke kurz, danach mind. 24 Std. (optimal 48 Std.) Ruhe, vorwärts rotieren" },
  { id: "rkw", title: "Konkrete Gestaltungsmaßnahmen für Schichtarbeit", org: "RKW Kompetenzzentrum (nach DGAUM u. a.)", year: null, url: "https://www.rkw-kompetenzzentrum.de/publikationen/faktenblatt/arbeitszeit-und-schichtsysteme-bedarfsgerecht-gestaltn/konkrete-gestaltungsmassnahmen-fuer-schichtarbeit/", use: "möglichst nicht mehr als 3 Nachtdienste hintereinander" },
  { id: "s2k", title: "S2k-Leitlinie „Gesundheitliche Aspekte und Gestaltung von Nacht- und Schichtarbeit“ (AWMF 002-030; Stand 2020, wird überarbeitet)", org: "DGAUM / AWMF", year: 2020, url: "https://register.awmf.org/de/leitlinien/detail/002-030", use: "deutsche Leitlinie zu Schlaf und Schichtplan-Gestaltung" },
  { id: "dgsm", title: "Patientenratgeber „Schlafprobleme bei Schichtarbeit“", org: "DGSM", year: 2021, url: "https://www.dgsm.de/fileadmin/patienteninformationen/ratgeber_schlafstoerungen/09_DGSM-Schlafprobleme-bei-Schichtarbeit_barrierefrei.pdf", use: "Vorschlaf 1–2 Std. vor der Nacht, größte Müdigkeit 2–5 Uhr, helles Licht nachts, Schlafhygiene" },
  { id: "niosh-nap", title: "Napping: Nap Duration", org: "NIOSH (CDC)", year: 2020, url: "https://www.cdc.gov/niosh/work-hour-training-for-nurses/longhours/mod7/05.html", use: "20 Min. oder ca. 90 Min., Schlaftrunkenheit meist 15–30 Min." },
  { id: "niosh-sleep", title: "Coping with the Night Shift: Sleep", org: "NIOSH (CDC)", year: 2020, url: "https://www.cdc.gov/niosh/work-hour-training-for-nurses/longhours/mod9/05.html", use: "nach der Nacht direkt ins sehr dunkle Bett, möglichst lange schlafen" },
  { id: "niosh-light", title: "Coping with the Night Shift: Light", org: "NIOSH (CDC)", year: 2020, url: "https://www.cdc.gov/niosh/work-hour-training-for-nurses/longhours/mod9/03.html", use: "helles Licht in der 1. Schichthälfte; Sonnenbrille nur, wenn jemand anderes fährt" },
  { id: "niosh-food", title: "Diet Suggestions for Night-Shift Nurses (nach Lowden et al. 2010)", org: "NIOSH (CDC)", year: 2020, url: "https://www.cdc.gov/niosh/work-hour-training-for-nurses/longhours/mod9/08.html", use: "zwischen 0 und 6 Uhr wenig essen, leichte Kost im Dienst" },
  { id: "caffeine", title: "The effect of caffeine on subsequent sleep: a systematic review and meta-analysis", org: "Gardiner et al., Sleep Medicine Reviews", year: 2023, url: "https://doi.org/10.1016/j.smrv.2023.101764", use: "eine Tasse Kaffee ≥ 8,8 Std. vor dem Schlafen – für Empfindliche eher 8–9 Std." },
  { id: "caffeine-6h", title: "Caffeine effects on sleep taken 0, 3, or 6 hours before going to bed", org: "Drake et al., J Clin Sleep Med", year: 2013, url: "https://doi.org/10.5664/jcsm.3170", use: "Koffein mind. 6 Std. vor dem Schlafen meiden (ShiftFlow-Standard)" },
  { id: "eastman-1994", title: "Dark goggles and bright light improve circadian rhythm adaptation to night-shift work", org: "Eastman et al., SLEEP", year: 1994, url: "https://doi.org/10.1093/sleep/17.6.535", use: "helles Licht im Nachtdienst + dunkle Brille auf dem Heimweg beschleunigen die Anpassung" },
  { id: "burgess-2002", title: "Bright light, dark and melatonin can promote circadian adaptation in night shift workers", org: "Burgess, Sharkey & Eastman, Sleep Medicine Reviews", year: 2002, url: "https://doi.org/10.1053/smrv.2001.0215", use: "Licht in der 1. Schichthälfte, Licht meiden am Morgen, dunkler Tagschlaf" },
  { id: "smith-2009", title: "Practical interventions to promote circadian adaptation to permanent night shift work: study 4", org: "Smith, Fogg & Eastman, J Biol Rhythms", year: 2009, url: "https://doi.org/10.1177/0748730409332068", use: "Licht im Dienst, Sonnenbrille draußen, fester abgedunkelter Schlaf – alltagstauglicher Kompromiss" },
  { id: "eastman-burgess-2009", title: "How to travel the world without jet lag", org: "Eastman & Burgess, Sleep Medicine Clinics", year: 2009, url: "https://doi.org/10.1016/j.jsmc.2009.02.006", use: "Schlaf vorab ca. 1 Std. pro Tag verschieben, mit Licht am Morgen (früher) bzw. am Abend (später)" },
  { id: "brooks-lack-2006", title: "A brief afternoon nap following nocturnal sleep restriction: which nap duration is most recuperative?", org: "Brooks & Lack, SLEEP", year: 2006, url: "https://doi.org/10.1093/sleep/29.6.831", use: "Powernap 10–20 Min. wirkt sofort und ohne Schlaftrunkenheit" },
  { id: "ruggiero-2014", title: "Effects of napping on sleepiness and sleep-related performance deficits in night-shift workers: a systematic review", org: "Ruggiero & Redeker, Biol Res Nurs", year: 2014, url: "https://doi.org/10.1177/1099800413476571", use: "Kurzschlaf vor/während der Nacht senkt Müdigkeit und Fehler" },
  { id: "chellappa-2021", title: "Daytime eating prevents internal circadian misalignment and glucose intolerance in night work", org: "Chellappa et al., Science Advances", year: 2021, url: "https://doi.org/10.1126/sciadv.abg9910", use: "Essen in der hellen Tageszeit statt nachts schützt den Stoffwechsel (Chrononutrition)" },
  { id: "rmeq", title: "Horne & Östberg morningness-eveningness questionnaire: a reduced scale", org: "Adan & Almirall, Personality and Individual Differences", year: 1991, url: "https://doi.org/10.1016/0191-8869(91)90110-W", use: "5-Fragen-Kurzform (rMEQ) für den Chronotyp-Test" },
  { id: "mctq", title: "Life between clocks: daily temporal patterns of human chronotypes", org: "Roenneberg, Wirz-Justice & Merrow, J Biol Rhythms", year: 2003, url: "https://doi.org/10.1177/0748730402239679", use: "Schlafmitte an freien Tagen (MCTQ) als Maß für den Chronotyp" },
  { id: "juda-2013", title: "Chronotype modulates sleep duration, sleep quality, and social jet lag in shift-workers", org: "Juda, Vetter & Roenneberg, J Biol Rhythms", year: 2013, url: "https://doi.org/10.1177/0748730412475042", use: "Frühtypen schlafen nach Nächten schlechter, Spättypen vor Frühdiensten" },
  { id: "vetter-2015", title: "Aligning work and circadian time in shift workers improves sleep and reduces circadian disruption", org: "Vetter et al., Current Biology", year: 2015, url: "https://doi.org/10.1016/j.cub.2015.01.064", use: "Dienste passend zum Chronotyp → mehr Schlaf, weniger Belastung" },
  { id: "van-dongen-2003", title: "The cumulative cost of additional wakefulness: dose-response effects on neurobehavioral functions and sleep physiology from chronic sleep restriction", org: "Van Dongen et al., SLEEP", year: 2003, url: "https://doi.org/10.1093/sleep/26.2.117", use: "Schlafschuld summiert sich – Leistung sinkt, ohne dass man es selbst merkt" },
  { id: "drive", title: "High risk of near-crash driving events following night-shift work", org: "Lee et al., PNAS", year: 2016, url: "https://doi.org/10.1073/pnas.1510383112", use: "nach Nachtdienst Beinahe-Unfälle in 6 von 16 Testfahrten, nach ausgeschlafener Fahrt in keiner" },
];
// Welche Quellen gehören zu welchem Hinweis (Link „Quelle“ am Hinweis)
const HINT_SRC = { nap: ["dgsm", "niosh-nap"], wind: ["shift-hygiene", "niosh-sleep"], caf: ["caffeine", "caffeine-6h"], night: ["niosh-light", "niosh-food", "dgsm"], drive: ["drive", "niosh-light"], daysoff: ["shift-hygiene"], rest: ["rest", "quick-returns", "quick-returns-diary"], nights: ["rkw", "baua"], after: ["baua"], duration: ["duration", "shift-hygiene"],
  light: ["eastman-1994", "burgess-2002", "smith-2009", "niosh-light"], shiftplan: ["eastman-burgess-2009", "burgess-2002", "juda-2013"], powernap: ["brooks-lack-2006", "ruggiero-2014", "niosh-nap"],
  food: ["chellappa-2021", "niosh-food"], chrono: ["rmeq", "mctq", "juda-2013", "vetter-2015"], debt: ["van-dongen-2003", "duration"] };

function create(data, opt = {}) {
  const at = opt.at || localAt, fmt = opt.fmt || localFmt;
  const prefs = Object.assign({ sleep_need: 7.5, caffeine_h: RULES.cafDefault, lead_min: RULES.leadDefault, commute_min: RULES.commuteDefault, hint_caffeine: true, hint_light: true }, data.prefs || {});
  const need = Math.min(10, Math.max(5, Number(prefs.sleep_need) || 7.5));
  const cafH = Math.min(10, Math.max(3, Number(prefs.caffeine_h) || RULES.cafDefault));
  const R = RULES;
  // Vorlauf (Aufstehen → Dienstbeginn) und Arbeitsweg in Minuten
  const leadMin = Math.min(240, Math.max(15, Math.round(Number(prefs.lead_min) || R.leadDefault)));
  const commuteMin = Math.min(180, Math.max(0, Math.round(Number(prefs.commute_min ?? R.commuteDefault))));
  const chrono = CHRONO[prefs.chronotype] || null, CH = chrono || CHRONO.neutral, cw = chrono ? chrono.wake : 0;
  const svcs = new Map((data.services || []).map((x) => [x.id, x]));
  // sf_days = ausdrückliche Einzeländerungen; Rotation = Rhythmus (cycle_len Tage), der sich ab start_date wiederholt (end_date leer = unbegrenzt)
  const rows = new Map((data.days || []).map((d) => [d.day, d]));
  const cyc = new Map();
  for (const c of data.cycle || []) { if (!cyc.has(c.rotation_id)) cyc.set(c.rotation_id, new Map()); cyc.get(c.rotation_id).set(Number(c.idx), c); }
  // Bei Überschneidung gilt die später beginnende Rotation (bei gleichem Start die neueste)
  const rots = (data.rotations || []).slice().sort((x, y) => String(y.start_date).localeCompare(String(x.start_date)) || String(y.created_at || "").localeCompare(String(x.created_at || "")));
  const rotationFor = (day) => rots.find((r) => r.start_date <= day && (!r.end_date || r.end_date >= day)) || null;
  const cycleLen = (rot) => Math.max(1, Math.min(400, Number(rot.cycle_len) || 7));
  function base(day) {
    const rot = rotationFor(day); if (!rot) return { rot: null, idx: null, rep: null, tpl: null };
    const n = cycleLen(rot), off = diffDays(rot.start_date, day);
    return { rot, idx: off % n, rep: Math.floor(off / n), n, tpl: (cyc.get(rot.id) && cyc.get(rot.id).get(off % n)) || null };
  }
  const cache = new Map();
  function resolve(day) {
    if (cache.has(day)) return cache.get(day);
    const row = rows.get(day), b = base(day), src = row || b.tpl;
    const sv = src && src.service_id ? svcs.get(src.service_id) : null, bsv = b.tpl && b.tpl.service_id ? svcs.get(b.tpl.service_id) : null;
    const r = { day, sid: sv ? sv.id : null, label: sv ? sv.label : "Frei", short: sv ? sv.short : "", color: sv ? sv.color : null, ink: sv ? ink(sv.color) : null,
      kind: sv ? sv.kind : "free", s: null, e: null, start: null, end: null, def: null, custom: false, note: (row && row.note) || "",
      lead: sv && Number(sv.lead_min) >= 15 ? Math.min(240, Math.round(Number(sv.lead_min))) : null,
      rotation: b.rot ? b.rot.name : null, rotation_id: b.rot ? b.rot.id : null, cycle_idx: b.idx, cycle_len: b.n || null, rep: b.rep,
      override: !!row, base_sid: bsv ? bsv.id : null, base_label: bsv ? bsv.label : "Frei",
      base_s: b.tpl && b.tpl.start_time ? b.tpl.start_time : null, base_e: b.tpl && b.tpl.end_time ? b.tpl.end_time : null,
      work: false, oncall: false, night: false, free: !sv, off: !!sv && sv.kind === "off" };
    if (row && (row.service_id || null) === (b.tpl ? b.tpl.service_id || null : null) && (row.start_time || null) === r.base_s && (row.end_time || null) === r.base_e) r.override = false;
    const own = src && hmRe.test(src.start_time || "") && hmRe.test(src.end_time || "") && src.start_time !== src.end_time;
    if (sv && sv.kind !== "off" && hmRe.test(sv.start_time || "") && hmRe.test(sv.end_time || "")) {
      r.def = { s: sv.start_time, e: sv.end_time };
      r.custom = !!own && (src.start_time !== sv.start_time || src.end_time !== sv.end_time);
      r.s = own ? src.start_time : sv.start_time; r.e = own ? src.end_time : sv.end_time;
      r.start = at(day, r.s); r.end = at(toMin(r.e) <= toMin(r.s) ? addDays(day, 1) : day, r.e);
      r.work = sv.kind === "work"; r.oncall = sv.kind === "oncall"; r.night = r.work && isNight(r.s, r.e);
    }
    cache.set(day, r); return r;
  }
  const range = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(resolve(d)); return out; };
  const times = (sid) => { const sv = svcs.get(sid); return sv && sv.start_time ? { s: sv.start_time, e: sv.end_time } : null; };

  // ---- Schlaffenster (Faustregeln aus RULES, einfach gehalten) ----
  const wcache = new Map();
  // Weckzeit = Dienstbeginn − Vorlauf; Abfahrt = Dienstbeginn − Arbeitsweg; zu Hause = Dienstende + Heimweg
  const leadOf = (x) => (x && x.lead) || leadMin;
  const commuteOf = (x) => Math.min(commuteMin, leadOf(x));
  const wakeAt = (x) => new Date(+x.start - leadOf(x) * MIN);
  const leaveAt = (x) => new Date(+x.start - commuteOf(x) * MIN);
  const homeAt = (x) => new Date(+x.end + commuteMin * MIN);
  const bedAfter = (x) => new Date(+homeAt(x) + 30 * MIN); // Heimweg + kurz runterkommen
  const hm = (m) => `${pad(Math.floor(mod(m, 1440) / 60))}:${pad(mod(m, 1440) % 60)}`;
  const kindOf = (x) => (!x.start || !x.work) ? "F" : x.night ? "N" : toMin(x.s) < 9 * 60 ? "E" : toMin(x.s) >= 12 * 60 ? "L" : "D";
  // Aufwachzeit (Min. nach Mitternacht) nach dem Tag d, wenn kein Dienst früher weckt:
  // frei 07:00 ± Chronotyp; vor Nächten schrittweise später (bis 09:00), vor Frühdiensten schrittweise früher – je 1 Std./Tag (Eastman & Burgess 2009)
  function prepWake(d) {
    const baseW = 7 * 60 + cw, r = resolve(d);
    if (resolve(addDays(d, 1)).night) return Math.max(baseW, 9 * 60);
    if (r.start || resolve(addDays(d, 1)).start) return baseW;
    for (let m = 1; m < Math.max(CH.nightDays, CH.earlyDays); m++) {
      const x = resolve(addDays(d, 1 + m));
      if (x.night) return m < CH.nightDays ? Math.max(baseW, 9 * 60 - R.stepMin * m) : baseW;
      if (x.start && x.work) {
        const t = toMin(x.s) - leadOf(x);
        return m < CH.earlyDays && t < baseW ? Math.min(baseW, t + R.stepMin * m) : baseW;
      }
      if (x.start) return baseW;
    }
    return baseW;
  }
  function sleepFor(d) {
    if (wcache.has(d)) return wcache.get(d);
    const r = resolve(d), prev = resolve(addDays(d, -1)), next = resolve(addDays(d, 1));
    const out = [];
    if (r.night) {
      // Vorschlaf vor der ersten Nacht: ~90 Min.; endet vor dem Fertigmachen/Losfahren (mind. Arbeitsweg + 30 Min. zum Wachwerden)
      if (!prev.night) { const e = new Date(+r.start - Math.max(leadOf(r), commuteOf(r) + R.inertiaMin) * MIN); out.push({ kind: "nap", start: new Date(+e - R.napMin * MIN), end: e, day: d, alarm: true }); }
      // Nach der Nacht: Heimweg, dann direkt ins Bett; nach der letzten Nacht nur kurz
      const s = bedAfter(r), last = !next.night;
      out.push({ kind: last ? "recover" : "day", start: s, end: new Date(+s + (last ? R.recoverMin * MIN : need * H)), day: d });
    } else {
      let wake = at(addDays(d, 1), hm(prepWake(d))), alarm = false;
      if (!next.night && next.start && +wakeAt(next) < +wake) { wake = wakeAt(next); alarm = true; }
      let s = new Date(+wake - need * H);
      if (r.end && +s < +bedAfter(r)) s = bedAfter(r);
      // Nach der letzten Nacht abends früher ins Bett (Shriane 2023, Empfehlung 5)
      if (prev.night && !r.night) { const early = at(d, "22:00"); if (+s > +early) s = early; }
      if (+wake - +s >= 3 * H) out.push({ kind: "night", start: s, end: wake, day: d, alarm });
    }
    // nie in eine Schicht hineinschlafen: spätestens zur Weckzeit (Dienstbeginn − Vorlauf) aufstehen
    for (const w of out) for (const x of [r, next]) if (x.start && +w.end > +wakeAt(x) && +w.start < +x.start) { w.end = wakeAt(x); w.alarm = true; }
    const res = out.filter((w) => +w.end - +w.start >= 20 * MIN);
    wcache.set(d, res); return res;
  }
  function sleepWindows(from, to) {
    const all = []; for (let d = from; d <= to; d = addDays(d, 1)) all.push(...sleepFor(d));
    all.sort((a, b) => a.start - b.start);
    for (let i = 1; i < all.length; i++) if (+all[i].start < +all[i - 1].end) all[i] = { ...all[i], start: all[i - 1].end };
    return all.filter((w) => +w.end - +w.start >= 20 * MIN);
  }
  // Wecker vor einem Dienst: Ende des Schlaffensters, das zur Weckzeit endet (Nachtschlaf vor Frühdienst, Vorschlaf vor der Nacht).
  // null, wenn du vor dem Dienst ohnehin wach bist (z. B. 2. Nacht, Spätdienst) – dann zählt nur „fertig machen ab“.
  function alarmFor(x) {
    if (!x || !x.start) return null;
    const w = sleepWindows(addDays(x.day, -1), x.day).find((v) => v.alarm && +v.end <= +x.start && +v.end > +x.start - 6 * H);
    return w ? w.end : null;
  }
  const SLEEP_LABEL = { night: "Nachtschlaf", day: "Tagschlaf nach der Nacht", recover: "Kurzer Schlaf nach der letzten Nacht", nap: "Vorschlaf vor der Nacht" };

  const isShift = (r, withOncall = true) => !!r.start && (r.work || (withOncall && r.oncall));
  function currentShift(now, today, withOncall = true) { for (const d of [addDays(today, -1), today]) { const r = resolve(d); if (isShift(r, withOncall) && +r.start <= +now && +now < +r.end) return r; } return null; }
  function nextShift(now, today, withOncall = true, after = null) {
    for (let i = -1; i <= 90; i++) { const r = resolve(addDays(today, i)); if (isShift(r, withOncall) && +r.start > +(after || now)) return r; }
    return null;
  }
  function lastShift(now, today) { for (let i = 0; i >= -21; i--) { const r = resolve(addDays(today, i)); if (r.work && r.start && +r.end <= +now) return r; } return null; }
  function nextSleep(now, today) { return sleepWindows(addDays(today, -1), addDays(today, 3)).find((w) => +w.end > +now) || null; }

  function recovery(now, today) {
    const cur = currentShift(now, today, false);
    if (cur) return { level: "work", label: "Im Dienst", text: `${cur.label} bis ${fmt(cur.end)}` };
    const nx = nextShift(now, today, false), last = lastShift(now, today);
    if (!nx) return { level: "good", label: "Gute Erholungszeit", text: "Keine Schicht in Sicht." };
    const gap = last ? (+nx.start - +last.end) / H : Infinity, left = (+nx.start - +now) / H;
    if (gap < R.restMin) return { level: "short", label: "Kurze Ruhezeit", text: `Nur ${hours(gap)} zwischen den Diensten (Regel: mind. ${R.restMin} Std.), nach Heimweg und Vorlauf ca. ${hours(Math.max(0, (+wakeAt(nx) - +homeAt(last)) / H))} zum Schlafen – Schlaf hat jetzt Vorrang.` };
    if (last && last.night && !nx.night && gap < R.afterNightsGood) {
      if (gap < R.afterNightsMin) return { level: "short", label: "Wenig Erholung nach den Nächten", text: `${hours(gap)} zwischen letzter Nacht und nächstem Dienst – empfohlen sind mind. ${R.afterNightsMin}, besser ${R.afterNightsGood} Std.` };
      return { level: "ok", label: "Erholung nach den Nächten", text: `Noch ${hours(left)} bis zum nächsten Dienst – ${R.afterNightsGood} Std. Pause nach Nächten wären ideal.` };
    }
    if (left < 16) return { level: "ok", label: "Normale Erholungszeit", text: `Noch ${hours(left)} bis zur nächsten Schicht.` };
    return { level: "good", label: "Gute Erholungszeit", text: `Noch ${left >= 48 ? Math.floor(left / 24) + " Tage" : hours(left)} bis zur nächsten Schicht.` };
  }
  // Abstände zwischen zwei Arbeitsdiensten: gesetzliche Ruhezeit (Ende → Beginn, § 5 ArbZG)
  // und tatsächliche Schlafgelegenheit (abzüglich Heimweg und Vorlauf vor dem nächsten Dienst)
  function gaps(today, days = 7) {
    const out = []; let prev = null;
    for (const r of range(addDays(today, -1), addDays(today, days))) {
      if (!r.work || !r.start) continue;
      if (prev) { const g = (+r.start - +prev.end) / H; if (g >= 0) out.push({ a: prev, b: r, gap: g, opp: Math.max(0, (+wakeAt(r) - +homeAt(prev)) / H) }); }
      prev = r;
    }
    return out;
  }
  // Ruhezeit unter 11 Std. („Quick Return“)
  function shortGaps(today, days = 7) { return gaps(today, days).filter((g) => g.gap < R.restMin); }
  // Nachtblöcke: aufeinanderfolgende Nachtdienste + Abstand zum nächsten Dienst danach
  function nightBlocks(today, days = 14) {
    const out = []; let run = [];
    const flush = () => { if (run.length) { const lastN = run[run.length - 1]; const nx = nextShift(lastN.end, lastN.day, false, new Date(+lastN.end - 1)); out.push({ nights: run, last: lastN, next: nx, gap: nx ? (+nx.start - +lastN.end) / H : Infinity }); } run = []; };
    for (const r of range(addDays(today, -7), addDays(today, days + 7))) { if (r.night) run.push(r); else flush(); }
    flush();
    return out.filter((b) => b.last.day >= addDays(today, -1) && b.nights[0].day <= addDays(today, days));
  }
  // Mehr als 3 Nächte am Stück
  function nightStreaks(today, days = 14) { return nightBlocks(today, days).filter((b) => b.nights.length > R.nightsMax).map((b) => b.nights); }

  function hints(now, today, dismissed = []) {
    const D = new Set(dismissed), out = [];
    const add = (h) => { if (!D.has(h.id)) out.push(h); };
    const ws = sleepWindows(addDays(today, -1), addDays(today, 2)).filter((w) => +w.end > +now);
    for (const w of ws.slice(0, 3)) {
      if (+w.start - +now > 30 * H) break;
      if (w.kind === "nap") { add({ id: `nap-${w.day}`, at: w.start, icon: "😴", level: "info", src: "nap", title: `Vorschlaf ${fmt(w.start)}–${fmt(w.end)}`, text: `Vor der ersten Nacht ca. 90 Min. schlafen (wenn die Zeit knapp ist: 20 Min.) und Wecker stellen. Danach 15–30 Min. richtig wach werden, bevor du losfährst.${chrono && chrono.hard === "N" ? " Als Frühtyp ist der Vorschlaf für dich besonders wertvoll (Juda 2013)." : ""}` }); continue; }
      const wd = new Date(+w.start - 60 * MIN);
      const wtxt = w.kind === "night" ? `${SLEEP_LABEL[w.kind]} ab ${fmt(w.start)}${w.alarm ? `, Wecker ${fmt(w.end)}` : ""}: Licht dimmen, Bildschirm weg, ruhig werden.`
        : w.kind === "day" ? `Tagschlaf ab ${fmt(w.start)}: direkt ins Bett, Zimmer ganz dunkel, ruhig und kühl (ca. 16–20 °C), Handy stumm.`
        : `Nach der letzten Nacht nur kurz schlafen (${fmt(w.start)}–${fmt(w.end)}), dann ans Tageslicht und abends früher ins Bett.`;
      if (+wd > +now - 60 * MIN) add({ id: `wd-${w.day}-${w.kind}`, at: wd, icon: "🕯️", level: "info", src: w.kind === "recover" ? "daysoff" : "wind", title: `Ab ${fmt(wd)} runterfahren${w.alarm && w.kind === "night" ? ` · Wecker ${fmt(w.end)}` : ""}`, text: wtxt });
      if (prefs.hint_caffeine !== false) { const c = new Date(+w.start - cafH * H); if (+c > +now - 2 * H) add({ id: `caf-${w.day}-${w.kind}`, at: c, icon: "☕", level: "info", src: "caf", title: `Letzter Kaffee bis ${fmt(c)}`, text: `Koffein wirkt viele Stunden nach – danach lieber koffeinfrei. ${SLEEP_LABEL[w.kind]} ab ${fmt(w.start)}.` }); }
    }
    for (const d of [addDays(today, -1), today]) {
      const r = resolve(d);
      if (!r.night) continue;
      // Gut durch die Nacht: Licht, Essen, Tief 2–5 Uhr
      if (+r.end > +now && +r.start < +now + 12 * H) add({ id: `night-${d}`, at: r.start, icon: "🌙", level: "info", src: "night", title: `Nachtdienst ${fmt(r.start)}–${fmt(r.end)}`, text: "Erste Hälfte: helles Licht hält wach, gegen Ende eher gedämpft. Hauptmahlzeit vor dem Dienst, zwischen 0 und 6 Uhr nur leicht essen. Zwischen 2 und 5 Uhr ist man am müdesten." });
      // Heimweg: Müdigkeit am Steuer, Sonnenbrille nur ohne selbst zu fahren
      if (prefs.hint_light !== false && +r.end > +now - 3 * H && +r.end < +now + 20 * H) { const hl = homeLight(r); add({ id: `light-${d}`, at: r.end, icon: hl.dark ? "🚗" : "🕶️", level: "info", src: "light", title: `Nach der Nacht (${fmt(r.end)}): ${hl.dark ? "sicher heim" : "Sonnenbrille auf"}`, text: `${hl.text}${hl.dark ? " Sehr müde? Nicht selbst fahren." : ""}` }); }
    }
    const y = resolve(addDays(today, -1)), t = resolve(today);
    if (y.night && !t.night && !t.work) { const rw = sleepFor(addDays(today, -1)).find((w) => w.kind === "recover"); add({ id: `rhythm-${today}`, at: null, icon: "🔄", level: "info", src: "daysoff", title: "Rhythmus zurückfinden", text: `Nach der letzten Nacht nur kurz schlafen${rw ? ` (bis ca. ${fmt(rw.end)})` : ""}, dann Tageslicht tanken und abends früher ins Bett.` }); }
    const way = `Heimweg ${dur(commuteMin)}`;
    for (const g of gaps(today, 7)) {
      if (g.gap < R.restMin) add({ id: `gap-${g.b.day}`, at: g.a.end, icon: "⚠️", level: "warn", src: "rest", title: `Kurze Ruhezeit: nur ${hours(g.gap)}`, text: `Zwischen ${g.a.label} (${dayShort(g.a.day)}) und ${g.b.label} (${dayShort(g.b.day)}). Regel sind mind. ${R.restMin} Std. (§ 5 ArbZG). Nach ${way} und ${dur(leadOf(g.b))} Vorlauf bleiben ca. ${hours(g.opp)} zum Schlafen – fest einplanen.` });
      else if (!g.a.night && g.opp < need) add({ id: `tight-${g.b.day}`, at: g.a.end, icon: "⏰", level: "info", src: "rest", title: `Knapp: ca. ${hours(g.opp)} Schlafzeit`, text: `Zwischen ${g.a.label} (${dayShort(g.a.day)}) und ${g.b.label} (${dayShort(g.b.day)}) bleiben nach ${way} und ${dur(leadOf(g.b))} Vorlauf (Wecker ${fmt(wakeAt(g.b))}) weniger als dein Schlafziel von ${hours(need)}.` });
    }
    for (const b of nightBlocks(today, 14)) {
      if (b.nights.length > R.nightsMax) add({ id: `streak-${b.nights[0].day}`, at: null, icon: "🌙", level: "warn", src: "nights", title: `${b.nights.length} Nächte in Folge`, text: `Ab ${dayShort(b.nights[0].day)}. Empfohlen sind höchstens ${R.nightsMax} Nachtdienste am Stück – danach bewusst Erholung einplanen.` });
      if (b.next && !b.next.night && b.gap >= R.restMin && b.gap < R.afterNightsGood && +b.next.start > +now) add({ id: `after-${b.last.day}`, at: b.last.end, icon: "🛌", level: b.gap < R.afterNightsMin ? "warn" : "info", src: "after", title: `Nach den Nächten nur ${hours(b.gap)} frei`, text: `Von ${b.last.label} (${dayShort(b.last.day)}) bis ${b.next.label} (${dayShort(b.next.day)}). Empfohlen sind nach Nachtdiensten mind. ${R.afterNightsMin} Std., besser ${R.afterNightsGood} Std. Ruhe.` });
    }
    if (need < R.sleepMin) add({ id: "need-low", at: null, icon: "⏳", level: "info", src: "duration", title: `Schlafziel unter ${R.sleepMin} Std.`, text: `Für Erwachsene werden mind. ${R.sleepMin} Std. Schlaf empfohlen – bei Schichtarbeit pro 24 Std., gern aufgeteilt in Haupt- und Kurzschlaf. Ändern unter „Mehr“.` });
    return out.sort((a, b) => (a.at ? +a.at : 9e15) - (b.at ? +b.at : 9e15));
  }
  // Ereignisse für Push-Erinnerungen (Server prüft alle 5 Minuten). Jeder Typ einzeln schaltbar.
  // push_nap: Vorschlaf + Powernap · push_winddown: 60 Min. vorher runterfahren · push_bed30: „in 30 Min. ins Bett“
  // push_caffeine: letzter Kaffee · push_light: Sonnenbrille/Heimweg · push_shift: Aufstehen · push_diary: Tagebuch am Morgen
  function reminders(now, today, p = {}) {
    const ev = new Map(), put = (e) => { if (!ev.has(e.key)) ev.set(e.key, e); };
    const napOn = p.push_nap ?? p.push_winddown, logged = new Set(p.logged || []);
    for (const w of sleepWindows(addDays(today, -1), addDays(today, 2))) {
      if (w.kind === "nap") { if (napOn) put({ key: `nap-${w.day}`, type: "nap", at: new Date(+w.start - 15 * MIN), title: "😴 Gleich Vorschlaf", body: `Vor der Nacht ca. 90 Min. hinlegen (${fmt(w.start)}–${fmt(w.end)}), Wecker stellen.` }); continue; }
      if (p.push_winddown) put({ key: `wd-${w.day}-${w.kind}`, type: "winddown", at: new Date(+w.start - 60 * MIN), title: "🕯️ Zeit runterzufahren", body: `${SLEEP_LABEL[w.kind]} ab ${fmt(w.start)}${w.alarm ? ` – Wecker auf ${fmt(w.end)} stellen` : ""} – Licht dimmen, Bildschirm weg${w.kind === "night" ? "" : ", Zimmer dunkel und kühl"}.` });
      if (p.push_bed30) put({ key: `bed-${w.day}-${w.kind}`, type: "bed30", at: new Date(+w.start - 30 * MIN), title: "🛏️ In 30 Min. ins Bett", body: `${SLEEP_LABEL[w.kind]} ab ${fmt(w.start)}${w.alarm ? `, Wecker ${fmt(w.end)}` : ` bis ca. ${fmt(w.end)}`}.` });
      if (p.push_caffeine) put({ key: `caf-${w.day}-${w.kind}`, type: "caffeine", at: new Date(+w.start - cafH * H), title: "☕ Letzter Kaffee", body: `Ab jetzt lieber koffeinfrei – ${SLEEP_LABEL[w.kind].toLowerCase()} ab ${fmt(w.start)}.` });
      if (p.push_diary && (w.kind === "night" || w.kind === "day")) { const wd = dayOf(w.end, w.day); if (!logged.has(wd)) put({ key: `diary-${wd}`, type: "diary", at: new Date(+w.end + 30 * MIN), title: "📓 Wie hast du geschlafen?", body: "Kurz ins Schlaf-Tagebuch eintragen – dauert 10 Sekunden." }); }
    }
    for (const r of range(addDays(today, -1), addDays(today, 1))) {
      if (p.push_light && r.night) { const hl = homeLight(r); put({ key: `light-${r.day}`, type: "light", at: new Date(+r.end - 15 * MIN), title: hl.dark ? "🌑 Gleich Feierabend" : "🕶️ Sonnenbrille für den Heimweg", body: hl.dark ? `Heimweg noch im Dunkeln (Sonnenaufgang ca. ${fmt(sun(dayOf(r.end, r.day)).rise)}) – zu Hause Licht gedämpft lassen, direkt ins dunkle Bett. Sehr müde? Nicht selbst fahren.` : "Morgenlicht bremst die Umstellung. Am Steuer nur eine normale, straßentaugliche Sonnenbrille. Sehr müde? Nicht selbst fahren." }); }
      if (p.push_shift && r.start && (r.work || r.oncall)) put({ key: `shift-${r.day}`, type: "shift", at: wakeAt(r), title: `⏰ ${alarmFor(r) ? "Aufstehen" : "Fertig machen"} – ${r.label} um ${fmt(r.start)}`, body: `Abfahrt ca. ${fmt(leaveAt(r))}${r.custom ? " (abweichende Zeit)" : ""}.` });
    }
    if (napOn) for (const d of [today, addDays(today, 1)]) for (const x of dayPlan(d).items) if (x.type === "powernap" && !resolve(d).night && dayOf(x.start, d) === d) put({ key: `pnap-${d}`, type: "nap", at: x.start, title: "💤 Zeit für einen Powernap", body: `${x.title.replace(" (optional)", "")}: Wecker auf 20 Min. stellen.` });
    return [...ev.values()];
  }
  // ---- v8: Tagesfahrplan ----
  const dayOf = (t, hint) => { for (const c of [addDays(hint, -1), hint, addDays(hint, 1), addDays(hint, 2)]) if (+t >= +at(c, "00:00") && +t < +at(addDays(c, 1), "00:00")) return c; return hint; };
  const isEarly = (x) => kindOf(x) === "E";
  // Heimweg nach der Nacht: Sonnenbrille nur, wenn es schon hell ist; am Steuer nur straßentaugliche Gläser (Kat. 1–2), nie in der Dämmerung
  function homeLight(r) {
    const h = homeAt(r), sr = sun(dayOf(r.end, r.day)).rise, dark = +h <= +sr - 15 * MIN;
    return dark
      ? { dark: true, title: "Heimweg im Dunkeln – Licht klein halten", text: `Sonnenaufgang erst ca. ${fmt(sr)}: keine Sonnenbrille nötig (im Dunkeln nie!). Zu Hause nur gedämpftes Licht, direkt ins abgedunkelte Bett.` }
      : { dark: false, title: "🕶️ Sonnenbrille auf für den Heimweg", text: `Morgenlicht nach der Nacht bremst die Umstellung (Eastman, Burgess). Selbst am Steuer nur eine normale, straßentaugliche Sonnenbrille (Kategorie 1–2), keine sehr dunklen Gläser. Sehr müde? Nicht selbst fahren.` };
  }
  function dayPlan(day) {
    const d0 = at(day, "00:00"), d1 = at(addDays(day, 1), "00:00"), it = [];
    const add = (x) => { const e = x.end || x.start; if (+x.start < +d1 && (+e > +d0 || (!x.end && +x.start >= +d0))) it.push(x); };
    const ws = sleepWindows(addDays(day, -2), addDays(day, 2));
    const shifts = range(addDays(day, -1), addDays(day, 1)).filter((x) => isShift(x));
    const shiftAfter = (t) => shifts.concat([resolve(addDays(day, 2))].filter((x) => isShift(x))).find((x) => +x.start >= +t && +x.start - +t <= 6 * H);
    for (const w of ws) {
      if (w.kind === "nap") add({ type: "nap", start: w.start, end: w.end, icon: "😴", title: `Vorschlaf ${fmt(w.start)}–${fmt(w.end)}`, text: "Ca. 90 Min. (ein Schlafzyklus) vor der ersten Nacht – danach 15–30 Min. richtig wach werden.", src: "nap" });
      else add({ type: "sleep", kind: w.kind, start: w.start, end: w.end, icon: "🛏️", title: `${SLEEP_LABEL[w.kind]} ${fmt(w.start)}–${fmt(w.end)}`,
        text: w.kind === "night" ? "Dunkel, ruhig und kühl (16–20 °C). Möglichst feste Zeiten." : w.kind === "day" ? "Direkt nach dem Heimweg ins Bett: Zimmer ganz dunkel, Handy stumm, Ohrstöpsel." : "Nur kurz schlafen, danach raus ans Tageslicht – so findest du schneller in den Tagrhythmus.", src: w.kind === "recover" ? "daysoff" : "wind" });
      if (w.alarm) { const x = shiftAfter(w.end); add({ type: "alarm", start: w.end, icon: "⏰", title: `Wecker ${fmt(w.end)}`, text: x ? `${x.label} um ${fmt(x.start)} · Abfahrt ca. ${fmt(leaveAt(x))}` : "Aufstehen", src: "wind" }); }
      if (w.kind === "nap") continue;
      const c = new Date(+w.start - cafH * H);
      add({ type: "caffeine", start: c, icon: "☕", title: `Letzter Kaffee bis ${fmt(c)}`, text: `${String(cafH).replace(".", ",")} Std. vor dem Schlaf (${fmt(w.start)}) – danach koffeinfrei.`, src: "caf" });
      if (w.kind === "night") add({ type: "dark", start: new Date(+w.start - 90 * MIN), end: w.start, icon: "🕯️", title: `Ab ${fmt(new Date(+w.start - 90 * MIN))} Licht dimmen`, text: "Gedämpftes, warmes Licht und wenig Bildschirm vor dem Schlafen – helles Abendlicht schiebt die innere Uhr nach hinten.", src: "light" });
      // Aufwachen ohne Dienst am Morgen: Tageslicht tanken (nicht am Tag vor der ersten Nacht – da hilft eher Abendlicht)
      const wd = dayOf(w.end, w.day), wr = resolve(wd);
      if (w.kind === "night" && !wr.night && !isEarly(wr)) add({ type: "light", start: new Date(+w.end + 15 * MIN), end: new Date(+w.end + 45 * MIN), icon: "☀️", title: `Morgenlicht ${fmt(new Date(+w.end + 15 * MIN))}–${fmt(new Date(+w.end + 45 * MIN))}`, text: "Ca. 30 Min. Tageslicht nach dem Aufstehen (draußen ist es auch bei Wolken viel heller als drinnen) – stabilisiert deinen Rhythmus.", src: "light" });
      if (w.kind === "recover") add({ type: "light", start: new Date(+w.end + 15 * MIN), end: new Date(+w.end + 3 * H), icon: "☀️", title: `Tageslicht tanken ${fmt(new Date(+w.end + 15 * MIN))}–${fmt(new Date(+w.end + 3 * H))}`, text: "Nach der letzten Nacht nachmittags raus ans Licht (Spaziergang) – hilft zurück in den Tagrhythmus.", src: "light" });
    }
    for (const r of shifts) {
      add({ type: "shift", start: r.start, end: r.end, icon: r.night ? "🌙" : "💼", title: `${r.label} ${fmt(r.start)}–${fmt(r.end)}`, text: `Abfahrt ca. ${fmt(leaveAt(r))} · zu Hause ca. ${fmt(homeAt(r))}`, color: r.color });
      if (r.night) {
        const mid = new Date((+r.start + +r.end) / 2), hl = homeLight(r);
        add({ type: "light", start: r.start, end: mid, icon: "💡", title: `Helles Licht bis ca. ${fmt(mid)}`, text: "In der ersten Dienst-Hälfte so viel helles Licht wie möglich (Licht an, heller Pausenraum) – hält wach und hilft der inneren Uhr. Gegen Ende eher gedämpft.", src: "light" });
        add({ type: "powernap", start: mid, end: new Date(+mid + 20 * MIN), icon: "💤", title: `Kurzschlaf im Dienst (falls möglich) ca. ${fmt(mid)}`, text: "20 Min. in der Pause senken Müdigkeit und Fehler. Danach 15 Min. Schlaftrunkenheit einplanen.", src: "powernap", optional: true });
        const m0 = new Date(+leaveAt(r) - 60 * MIN);
        add({ type: "meal", start: m0, end: leaveAt(r), icon: "🍲", title: `Hauptmahlzeit ${fmt(m0)}–${fmt(leaveAt(r))}`, text: "Warm und ausgewogen vor dem Dienst essen – im Dienst nur leicht (Obst, Joghurt, Vollkorn).", src: "food" });
        const f0 = at(addDays(r.day, 1), "00:00"), f1 = new Date(Math.min(+at(addDays(r.day, 1), "06:00"), +r.end));
        if (+f1 > +f0 && +r.start < +f0) add({ type: "fast", start: f0, end: f1, icon: "🌙", title: `${fmt(f0)}–${fmt(f1)} möglichst nichts Großes essen`, text: "Essen mitten in der Nacht bringt Blutzucker und innere Uhren durcheinander – höchstens ein kleiner Snack, dafür viel trinken.", src: "food" });
        add({ type: "dark", start: r.end, end: bedAfter(r), icon: hl.dark ? "🌑" : "🕶️", title: hl.title, text: hl.text, src: "light", sun: !hl.dark });
      } else if (isEarly(r) && r.work) {
        add({ type: "light", start: wakeAt(r), end: new Date(+wakeAt(r) + 30 * MIN), icon: "💡", title: "Gleich nach dem Aufstehen hell", text: "Großes Licht an und auf dem Weg/bei der Arbeit Tageslicht suchen – Morgenlicht hilft, abends früher müde zu werden.", src: "light" });
        const p0 = new Date(+homeAt(r) + 15 * MIN), p1 = new Date(+p0 + R.powerNapMin * MIN);
        if (+p1 <= +at(r.day, R.powerNapLatest)) add({ type: "powernap", start: p0, end: p1, icon: "💤", title: `Powernap ${fmt(p0)}–${fmt(p1)} (optional)`, text: `Nach dem frühen Wecker: 10–20 Min. hinlegen, Wecker stellen, spätestens ${R.powerNapLatest} Uhr wieder auf.`, src: "powernap", optional: true });
      } else if (kindOf(r) === "L") {
        add({ type: "dark", start: r.end, end: new Date(+homeAt(r) + 30 * MIN), icon: "🕯️", title: "Nach dem Spätdienst: gedämpft", text: "Zu Hause wenig Licht und kein helles Display – dann schläfst du trotz später Heimkehr schneller ein.", src: "light" });
      }
    }
    const r = resolve(day), nx = resolve(addDays(day, 1));
    // Tag vor der ersten Nacht: abends lange hell, morgens gedämpft → Uhr schiebt sich später
    if (nx.night && !r.night) { const sl = ws.find((w) => w.kind === "night" && w.day === day); if (sl) { const a = at(day, "19:00"), b = new Date(+sl.start - 90 * MIN); if (+b > +a) add({ type: "light", start: a, end: b, icon: "💡", title: `Abends lange hell bis ${fmt(b)}`, text: "Vor dem Nachtblock abends viel Licht und erst spät ins Bett – so verschiebt sich deine innere Uhr schon etwas Richtung Nacht. Morgens ausschlafen.", src: "shiftplan" }); } }
    // Essensfenster an Tagen ohne Nachtdienst: ab dem Aufstehen bis ca. 3 Std. vor dem Schlafen
    if (!r.night) {
      const up = ws.filter((w) => w.kind !== "nap" && +w.end >= +d0 && +w.end < +d1).map((w) => w.end).pop();
      const bed = up && ws.find((w) => w.kind !== "nap" && +w.start > +up);
      if (up && bed) { const a = new Date(+up + 30 * MIN), b = new Date(Math.min(+bed.start - R.mealGapH * H, +d1)); if (+b - +a >= 4 * H) add({ type: "meal", start: a, end: b, icon: "🍽️", title: `Essensfenster ${fmt(a)}–${fmt(b)}`, text: `Mahlzeiten in die wache, helle Zeit legen; die letzte größere Mahlzeit ca. ${R.mealGapH} Std. vor dem Schlafen.`, src: "food" }); }
      // Powernap an freien Tagen nach kurzer Nacht
      const last = ws.filter((w) => w.kind === "night" && +w.end >= +d0 && +w.end < +d1).pop();
      if (!r.start && last && (+last.end - +last.start) / H < need - 1.5) { const a = at(day, "13:30"), b = new Date(+a + R.powerNapMin * MIN); add({ type: "powernap", start: a, end: b, icon: "💤", title: `Powernap ${fmt(a)}–${fmt(b)} (optional)`, text: "Die Nacht war kurz – ein 10–20-Min.-Nickerchen am frühen Nachmittag gleicht etwas aus, ohne den Nachtschlaf zu stören.", src: "powernap", optional: true }); }
    }
    it.sort((a, b) => +a.start - +b.start || (a.end ? 1 : 0) - (b.end ? 1 : 0));
    return { day, d0, d1, shift: r, items: it };
  }

  // ---- v8: Strategien für Dienstwechsel ----
  const mainSleep = (d) => sleepFor(d).find((w) => w.kind !== "nap") || null;
  function transitions(today, days = 7) {
    const out = [], hard = chrono ? chrono.hard : null, ctag = chrono ? ` · ${chrono.icon} ${chrono.label}` : "";
    const sleepTxt = (x) => { const w = mainSleep(x); return w ? `Bett ca. ${fmt(w.start)}, auf ca. ${fmt(w.end)}${w.alarm ? " (Wecker)" : ""}` : ""; };
    const seen = new Set();
    for (let i = -2; i <= days; i++) {
      const d = addDays(today, i), r = resolve(d), p = resolve(addDays(d, -1)), n = resolve(addDays(d, 1));
      // 1) Einstieg in Nächte
      if (r.night && !p.night && i >= 0) {
        const k = CH.nightDays, steps = [];
        for (let j = k; j >= 1; j--) {
          const x = addDays(d, -j), rx = resolve(x);
          if (x < today) continue;
          if (rx.start && rx.work && j > 1) continue; // an Diensttagen nicht verschieben
          if (!rx.start || j === 1) steps.push({ day: x, prep: true, title: j === 1 ? "Vortag: abends hell, spät ins Bett" : `${j} Tage vorher: ca. ${k - j + 1} Std. später`, text: `${sleepTxt(x)}. Abends lange helles Licht, morgens nach dem Aufstehen gedämpft (Vorhänge zu, Sonnenbrille draußen).` });
          else steps.push({ day: x, title: `${j} Tage vorher: ${rx.label}`, text: "Dienst – heute normal schlafen, Verschieben erst an freien Tagen." });
        }
        const nap = sleepFor(d).find((w) => w.kind === "nap"), prep = steps.filter((s) => s.prep).length;
        // Text passend zur tatsächlich verbleibenden Zahl an Vorbereitungstagen (Diensttage und vergangene Tage zählen nicht)
        const ptxt = prep >= 2 ? `Noch ${prep} Tage zur Vorbereitung: den Schlaf schrittweise später legen (ca. 1 Std. pro Tag).`
          : prep === 1 ? "Am Tag vorher den Schlaf nach hinten schieben: abends lange hell, spät ins Bett, morgens ausschlafen."
          : "Keine Vorbereitungstage mehr – heute ausschlafen, vor dem Dienst vorschlafen und in der 1. Hälfte viel helles Licht.";
        steps.push({ day: d, title: "Erste Nacht", text: `Ausschlafen${nap ? `, Vorschlaf ${fmt(nap.start)}–${fmt(nap.end)}` : ""}, Hauptmahlzeit vor dem Dienst, in der 1. Hälfte viel helles Licht. ${homeLight(r).dark ? "Heimweg noch dunkel" : "Heimweg mit Sonnenbrille"}, dann direkt ins dunkle Bett.` });
        out.push({ id: `tr-nacht-${d}`, kind: "einstieg_nacht", day: d, from: steps[0].day, icon: "🌙", level: hard === "N" ? "warn" : "info", src: "shiftplan",
          title: `Einstieg in die Nächte (${dayShort(d)})${ctag}`, prep, text: `${ptxt}${hard === "N" ? " Als Frühtyp kosten dich Nächte mehr – Vorschlaf und Licht im Dienst sind besonders wichtig." : ""}`, steps });
      }
      // 2) Erholung nach Nächten
      if (r.night && !n.night && i >= -1) {
        const rw = sleepFor(d).find((w) => w.kind === "recover"), d1 = addDays(d, 1), d2 = addDays(d, 2), ns = mainSleep(d1);
        const steps = [{ day: d1, title: "Heimweg & kurz schlafen", text: `${homeLight(r).title}. ${rw ? `Nur bis ca. ${fmt(rw.end)} schlafen, ` : ""}danach raus ans Tageslicht (Spaziergang), ${ns ? `letzter Kaffee ${fmt(new Date(+ns.start - cafH * H))}, ins Bett ca. ${fmt(ns.start)}` : "abends früh ins Bett"}.` }];
        const r2 = resolve(d2);
        steps.push({ day: d2, title: r2.start ? `${r2.label} – wieder im Tagrhythmus` : "Wieder im Tagrhythmus", text: `${sleepTxt(d1)}. Morgens 30 Min. Tageslicht, tagsüber höchstens ein 20-Min.-Powernap vor 16 Uhr.` });
        const nb = nightBlocks(addDays(d, -1), 3).find((b) => b.last.day === d);
        const short = nb && nb.next && !nb.next.night && nb.gap < R.afterNightsGood;
        out.push({ id: `tr-erholung-${d}`, kind: "erholung_nacht", day: d1, from: d1, icon: "🛌", level: nb && nb.gap < R.afterNightsMin ? "warn" : "info", src: "shiftplan",
          title: `Erholung nach den Nächten (${dayShort(d1)})${ctag}`, text: `Nach der letzten Nacht kurz schlafen, viel Tageslicht und abends früh ins Bett – so bist du am schnellsten zurück.${short ? ` Achtung: nur ${hours(nb.gap)} bis ${nb.next.label} (${dayShort(nb.next.day)}).` : ""}`, steps });
      }
      // 3) Spät → Früh (meist auch ein kurzer Wechsel)
      if (isEarly(r) && kindOf(p) === "L" && i >= 0) {
        const k = CH.earlyDays, gap = (+r.start - +p.end) / H, steps = [];
        for (let j = k; j >= 2; j--) { const x = addDays(d, -j), rx = resolve(x); if (x < today) continue; steps.push({ day: x, title: `${j} Tage vorher${rx.start ? `: ${rx.label}` : ""}`, text: `${rx.start ? "" : sleepTxt(x) + ". "}Morgens früher raus und 30 Min. Tageslicht, abends gedämpftes Licht.` }); }
        const w = mainSleep(p.day);
        steps.push({ day: p.day, title: `${p.label} → früh ins Bett`, text: `Koffein nur bis ${w ? fmt(new Date(+w.start - cafH * H)) : "–"}, nach Dienstende direkt heim, kein helles Display. ${w ? `Bett ca. ${fmt(w.start)}, Wecker ${fmt(w.end)} – ca. ${hours((+w.end - +w.start) / H)} Schlaf.` : ""}${R.restMin > gap ? ` Sachen für morgen vorher packen.` : ""}` });
        steps.push({ day: d, title: `${r.label}: Licht & Powernap`, text: `Gleich nach dem Aufstehen helles Licht. Nach dem Dienst 10–20 Min. Powernap (bis ${R.powerNapLatest} Uhr), abends früh ins Bett.` });
        seen.add(d);
        out.push({ id: `tr-spfr-${d}`, kind: "spaet_frueh", day: d, from: steps[0].day, icon: "🔁", level: gap < R.restMin || hard === "E" ? "warn" : "info", src: "shiftplan", short: gap < R.restMin,
          title: `Spät → Früh (${dayShort(d)})${ctag}`, text: `${gap < R.restMin ? `Nur ${hours(gap)} Ruhezeit. ` : ""}Rückwärts-Wechsel: die innere Uhr muss nach vorn – am Vorabend früh ins Bett, morgens Licht.${hard === "E" ? " Als Spättyp ist der frühe Wecker für dich besonders hart." : ""}`, steps });
      }
    }
    // 4) Sonstige kurze Wechsel (< 11 Std.)
    for (const g of shortGaps(addDays(today, -1), days)) {
      if (seen.has(g.b.day) || g.b.day < today) continue;
      const w = sleepWindows(g.a.day, g.b.day).find((v) => v.kind !== "nap" && +v.start >= +g.a.end && +v.end <= +g.b.start);
      const steps = [{ day: g.a.day, title: `Vor ${g.a.label}: vorbereiten`, text: `Essen und Sachen für morgen schon vorher richten. ${w ? `Koffein nur bis ${fmt(new Date(+w.start - cafH * H))}, nach Dienstende direkt heim und ab ins Bett (${fmt(w.start)}–${fmt(w.end)}).` : "Nach Dienstende direkt heim und schlafen."}` },
        { day: g.b.day, title: `${g.b.label}: durchhalten`, text: `Ca. ${hours(g.opp)} Schlafgelegenheit. Licht am Morgen, nach dem Dienst Powernap 10–20 Min. und früh ins Bett.` }];
      out.push({ id: `tr-kurz-${g.b.day}`, kind: "kurz", day: g.b.day, from: g.a.day, icon: "⚠️", level: "warn", src: "rest", short: true,
        title: `Kurzer Wechsel: ${hours(g.gap)} (${dayShort(g.a.day)} → ${dayShort(g.b.day)})`, text: `Weniger als ${R.restMin} Std. zwischen ${g.a.label} und ${g.b.label} – Schlaf hat jetzt Vorrang.`, steps });
    }
    return out.sort((a, b) => a.from.localeCompare(b.from) || a.day.localeCompare(b.day));
  }
  // Wechsel, die jetzt sichtbar sein sollen (Vorbereitung läuft oder steht bevor)
  function activeTransitions(today, days = 7) {
    return transitions(today, days).filter((t) => t.from <= addDays(today, 1) && t.steps.some((s) => s.day >= today));
  }

  // ---- v8: Schlaf-Tagebuch ----
  function sleepEntry(x) {
    const main = (Date.parse(x.wake_at) - Date.parse(x.bed_at)) / H, naps = (Number(x.naps_min) || 0) / 60;
    return { ...x, main, naps, total: main + naps };
  }
  function sleepStats(logs, today) {
    const L = (logs || []).filter((x) => x && x.day && x.bed_at && x.wake_at).map(sleepEntry).filter((x) => x.main > 0).sort((a, b) => a.day.localeCompare(b.day));
    const win = (n) => {
      const from = addDays(today, -(n - 1)), xs = L.filter((x) => x.day >= from && x.day <= today);
      const sum = xs.reduce((s, x) => s + x.total, 0);
      return { days: n, count: xs.length, avg: xs.length ? sum / xs.length : null, debt: xs.reduce((s, x) => s + (need - x.total), 0), quality: xs.length ? xs.reduce((s, x) => s + Number(x.quality || 0), 0) / xs.length : null };
    };
    const groups = new Map();
    for (const x of L.filter((v) => v.day >= addDays(today, -27))) {
      const r = resolve(x.day), key = r.start ? r.label : r.off ? r.label : "Frei";
      if (!groups.has(key)) groups.set(key, { label: key, color: r.color, night: false, n: 0, h: 0, q: 0 });
      const g = groups.get(key); g.n++; g.h += x.total; g.q += Number(x.quality || 0);
      // Tag nach einer Nacht separat markieren
      if (resolve(addDays(x.day, -1)).night) g.night = true;
    }
    const byType = [...groups.values()].map((g) => ({ label: g.label, color: g.color, count: g.n, avg: g.h / g.n, quality: g.q / g.n })).sort((a, b) => b.count - a.count);
    const series = []; for (let i = 13; i >= 0; i--) { const d = addDays(today, -i), x = L.find((v) => v.day === d), r = resolve(d); series.push({ day: d, total: x ? x.total : null, main: x ? x.main : null, naps: x ? x.naps : null, quality: x ? Number(x.quality) : null, label: r.short || (r.start ? r.label : ""), color: r.color }); }
    return { need, w7: win(7), w14: win(14), byType, series, count: L.length };
  }
  // Vorschlag für den Eintrag am Morgen: der geplante Hauptschlaf, der an diesem Tag endet
  function diaryDefaults(day) {
    const w = sleepWindows(addDays(day, -2), day).filter((v) => v.kind !== "nap" && dayOf(v.end, v.day) === day).pop();
    return w ? { bed: fmt(w.start), wake: fmt(w.end), bedDay: dayOf(w.start, w.day) } : { bed: "23:00", wake: "07:00", bedDay: addDays(day, -1) };
  }

  // Was sieht die Familie? arbeitet / schläft / Bereitschaft / frei
  function statusAt(now, today) {
    const cur = currentShift(now, today, true);
    if (cur) return cur.oncall ? { state: "bereit", label: "In Bereitschaft", until: cur.end, shift: cur } : { state: "arbeitet", label: "Arbeitet", until: cur.end, shift: cur };
    const w = sleepWindows(addDays(today, -1), addDays(today, 1)).find((x) => +x.start <= +now && +now < +x.end);
    if (w) return { state: "schlaeft", label: "Schläft", until: w.end, sleep: w };
    const nx = nextShift(now, today, true);
    return { state: "frei", label: "Frei", until: nx ? nx.start : null, next: nx };
  }
  const dur = (m) => (m < 60 ? `${m} Min.` : `${Math.floor(m / 60)}${m % 60 ? ":" + pad(m % 60) : ""} Std.`);
  function dayShort(day) { const d = new Date(day + "T12:00:00Z"); return d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" }); }
  return { dayPlan, transitions, activeTransitions, sleepStats, sleepEntry, diaryDefaults, dayOf, homeLight, prepWake, kindOf, chrono, chronoInfo: CH, sun,
    resolve, base, rotationFor, cycleLen, range, sleepFor, sleepWindows, nextSleep, currentShift, nextShift, lastShift, recovery, gaps, shortGaps, nightStreaks, nightBlocks, hints, reminders, statusAt, times, need, cafH, leadMin, commuteMin, leadOf, wakeAt, leaveAt, alarmFor, homeAt, dur, fmt, SLEEP_LABEL };
}
// Tagebuch: Bettzeit gehört zum Vortag, wenn sie (auf der Uhr) nach der Aufwachzeit liegt (23:30 → 06:30), sonst zum selben Tag (Tagschlaf 07:30 → 14:00)
const diaryBedDay = (day, bed, wake) => (toMin(bed) >= toMin(wake) ? addDays(day, -1) : day);
root.SF_LOGIC = { diaryBedDay, CHRONO, CHRONO_Q, chronotype, sun, KINDS, COLORS, RULES, SOURCES, HINT_SRC, ink, autoShort, isNight, addDays, diffDays, toMin, hmRe, hours, create };
})(typeof globalThis !== "undefined" ? globalThis : self);
