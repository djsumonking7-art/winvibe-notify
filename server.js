/**
 * WINVIBE notification server (Render).
 *
 *  Player app  -> POST /event/register   (নতুন রেজিস্ট্রেশন)      -> admin phones
 *  Player app  -> POST /event/request    (add cash / withdraw)     -> admin phones
 *  Admin app   -> POST /event/resolved   (approve / reject)        -> that player's phone
 *  Admin app   -> POST /push/send        (picture + text)          -> all players
 *  Admin app   -> POST /push/offer       (new cashback offer)      -> all players
 *  Anyone      -> GET  /health , GET /img/:id
 *
 * Every POST carries the caller's Firebase ID token (Authorization: Bearer ...). The server never trusts the text
 * sent by an app: it reads the real document from Firestore and builds the message itself.
 *
 * Render's free plan sleeps when idle, so a catch-up loop also scans Firestore every minute and sends anything
 * that was missed (duplicates are blocked by notifyLog/{key}).
 */
const express = require("express");
const admin = require("firebase-admin");
const { t, mask } = require("./templates");

// ------------------------------------------------------------------ firebase
function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT environment variable is missing");
  const sa = JSON.parse(raw);
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  return sa;
}
admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) });
const db = admin.firestore();
const TOPIC = "all";
const CH_PUSH = "winvibe_push";       // offers + admin announcements
const CH_WALLET = "winvibe_wallet";   // deposit / withdraw results
const CH_ADMIN = "winvibe_admin";     // alerts shown on the admin phone

const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");

// ------------------------------------------------------------------ helpers
const str = (v) => (v === undefined || v === null ? "" : String(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phoneFromEmail = (e) => str(e).split("@")[0];

/** true = we own this key (first time), false = somebody already sent it */
async function claim(key) {
  try {
    await db.collection("notifyLog").doc(key).create({ at: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  } catch (e) {
    if (e && (e.code === 6 || /already exists/i.test(String(e.message)))) return false;
    throw e;
  }
}
const release = (key) => db.collection("notifyLog").doc(key).delete().catch(() => {});

async function isAdminUid(uid) {
  const d = await db.collection("admins").doc(uid).get();
  return d.exists && d.get("active") !== false;
}

async function tokensOf(collection, field, value) {
  const q = field ? db.collection(collection).where(field, "==", value) : db.collection(collection);
  const s = await q.limit(500).get();
  return s.docs.map((d) => d.id);
}

async function dropDeadTokens(collection, tokens, responses) {
  const dead = [];
  responses.forEach((r, i) => {
    const c = r.error && r.error.code;
    if (c === "messaging/registration-token-not-registered" || c === "messaging/invalid-registration-token") dead.push(tokens[i]);
  });
  await Promise.all(dead.map((tk) => db.collection(collection).doc(tk).delete().catch(() => {})));
}

function buildPayload({ title, body, channel, image, data }) {
  const n = { title, body };
  if (image) n.imageUrl = image;
  return {
    notification: n,
    android: {
      priority: "high",
      notification: { channelId: channel, sound: "default", ...(image ? { imageUrl: image } : {}) },
    },
    data: Object.fromEntries(Object.entries({ ...(data || {}), ...(image ? { image } : {}) }).map(([k, v]) => [k, str(v)])),
  };
}

/** returns number of phones reached */
async function sendToTokens(collection, tokens, payload) {
  if (!tokens.length) return 0;
  let ok = 0;
  for (let i = 0; i < tokens.length; i += 500) {
    const part = tokens.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast({ tokens: part, ...payload });
    ok += res.successCount;
    await dropDeadTokens(collection, part, res.responses);
  }
  return ok;
}

const sendToAdmins = async (msg) =>
  sendToTokens("adminTokens", await tokensOf("adminTokens"), buildPayload({ ...msg, channel: CH_ADMIN }));
const sendToUser = async (uid, msg) =>
  sendToTokens("fcmTokens", await tokensOf("fcmTokens", "uid", uid), buildPayload({ ...msg, channel: CH_WALLET }));
const sendToAll = (msg) => admin.messaging().send({ topic: TOPIC, ...buildPayload({ ...msg, channel: CH_PUSH }) });

// ------------------------------------------------------------------ events
async function notifyRegister(uid, email) {
  const key = `reg_${uid}`;
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return { ok: false, reason: "no-profile" };
  if (!(await claim(key))) return { ok: true, duplicate: true };
  try {
    let total = 0;
    try { total = (await db.collection("users").count().get()).data().count; } catch (e) { /* optional */ }
    const msg = t.adminRegister({
      name: str(snap.get("name")) || "Player",
      phone: phoneFromEmail(email) || "-",
      referred: !!snap.get("referredBy"),
      total,
    });
    const n = await sendToAdmins({ ...msg, data: { open: "users", kind: "register", uid } });
    return { ok: true, sent: n };
  } catch (e) { await release(key); throw e; }
}

async function notifyRequest(doc, callerUid) {
  const d = doc.data() || {};
  if (callerUid && d.uid !== callerUid) return { ok: false, reason: "not-yours" };
  if (d.status !== "pending") return { ok: true, skipped: "not-pending" };
  const key = `req_${doc.id}`;
  if (!(await claim(key))) return { ok: true, duplicate: true };
  try {
    const isDep = d.type === "deposit";
    const msg = isDep
      ? t.adminDeposit({ name: str(d.name) || "Player", amount: d.amount, method: str(d.method) || "-", trxId: str(d.trxId) || "-" })
      : t.adminWithdraw({ name: str(d.name) || "Player", amount: d.amount, net: d.net == null ? d.amount : d.net, method: str(d.method) || "-", account: str(d.account) || "-" });
    const n = await sendToAdmins({ ...msg, data: { open: "requests", kind: str(d.type), requestId: doc.id } });
    return { ok: true, sent: n };
  } catch (e) { await release(key); throw e; }
}

async function notifyResolved(doc) {
  const d = doc.data() || {};
  const st = d.status;
  if (st !== "approved" && st !== "rejected") return { ok: true, skipped: "still-pending" };
  const key = `res_${doc.id}_${st}`;
  if (!(await claim(key))) return { ok: true, duplicate: true };
  try {
    const dep = d.type === "deposit";
    const p = { amount: d.amount, net: d.net == null ? d.amount : d.net, method: str(d.method) || "-", account: str(d.account), cashback: Number(d.cashback) || 0 };
    const msg = dep
      ? (st === "approved" ? t.depositApproved(p) : t.depositRejected(p))
      : (st === "approved" ? t.withdrawApproved(p) : t.withdrawRejected(p));
    const n = await sendToUser(str(d.uid), { ...msg, data: { open: "wallet", kind: `${d.type}_${st}`, requestId: doc.id } });
    return { ok: true, sent: n };
  } catch (e) { await release(key); throw e; }
}

/** pushes/{id} written by the admin app (title, body, image link or pushImages/{id}) */
async function sendPushDoc(id) {
  const ref = db.collection("pushes").doc(id);
  const mine = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.get("status") !== "pending") return null;
    tx.update(ref, { status: "sending" });
    return s.data();
  });
  if (!mine) return { ok: true, skipped: true };
  try {
    const title = str(mine.title).trim() || "TZ WinVibe";
    const body = str(mine.body).trim();
    let image = "";
    if (/^https:\/\//i.test(str(mine.image))) image = mine.image;
    else if (mine.hasImage === true && PUBLIC_URL) image = `${PUBLIC_URL}/img/${id}`;
    const messageId = await sendToAll({ title, body, image, data: { open: "home", kind: "announcement", pushId: id } });
    await ref.update({ status: "sent", messageId, sentAt: admin.firestore.FieldValue.serverTimestamp(), via: "render" });
    return { ok: true };
  } catch (e) {
    await ref.update({ status: "failed", error: str(e && e.message).slice(0, 300) });
    throw e;
  }
}

async function sendOffer(id) {
  const s = await db.collection("offers").doc(id).get();
  if (!s.exists) return { ok: false, reason: "offer-not-found" };
  const amount = Number(s.get("amount")) || 0, cashback = Number(s.get("cashback")) || 0;
  if (amount <= 0 || cashback <= 0) return { ok: false, reason: "bad-offer" };
  const image = /^https:\/\//i.test(str(s.get("pushImage"))) ? s.get("pushImage") : "";
  const msg = t.offer({ amount, cashback });
  const messageId = await sendToAll({ ...msg, image, data: { open: "addcash", kind: "offer", offerId: id } });
  // show it in the admin's "Sent history" too
  await db.collection("pushes").add({
    title: msg.title, body: msg.body, image, hasImage: false, status: "sent", messageId, by: "offer",
    createdAt: admin.firestore.FieldValue.serverTimestamp(), sentAt: admin.firestore.FieldValue.serverTimestamp(), via: "render",
  });
  return { ok: true };
}

// ------------------------------------------------------------------ http
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

const hits = new Map();   // uid -> [timestamps]
function limited(uid, max = 40) {
  const now = Date.now();
  const a = (hits.get(uid) || []).filter((x) => now - x < 60000);
  a.push(now);
  hits.set(uid, a);
  return a.length > max;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (!v.some((x) => n - x < 60000)) hits.delete(k); }, 120000).unref();

async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const m = /^Bearer (.+)$/.exec(h);
    if (!m) return res.status(401).json({ ok: false, error: "no token" });
    req.user = await admin.auth().verifyIdToken(m[1]);
    if (limited(req.user.uid)) return res.status(429).json({ ok: false, error: "slow down" });
    next();
  } catch (e) { res.status(401).json({ ok: false, error: "bad token" }); }
}
async function adminOnly(req, res, next) {
  try {
    if (!(await isAdminUid(req.user.uid))) return res.status(403).json({ ok: false, error: "not an admin" });
    next();
  } catch (e) { res.status(500).json({ ok: false, error: "check failed" }); }
}
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { console.error(req.path, e); res.status(500).json({ ok: false, error: str(e && e.message).slice(0, 200) }); }
};
const okId = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(s);

const health = (req, res) => res.json({ ok: true, service: "winvibe-notify", time: new Date().toISOString() });
app.get("/", health);
app.get("/health", health);

app.post("/event/register", auth, wrap((req) => notifyRegister(req.user.uid, req.user.email)));

app.post("/event/request", auth, wrap(async (req) => {
  const id = req.body && req.body.requestId;
  if (!okId(id)) return { ok: false, error: "bad id" };
  const doc = await db.collection("requests").doc(id).get();
  if (!doc.exists) return { ok: false, error: "not found" };
  return notifyRequest(doc, req.user.uid);
}));

app.post("/event/resolved", auth, adminOnly, wrap(async (req) => {
  const id = req.body && req.body.requestId;
  if (!okId(id)) return { ok: false, error: "bad id" };
  const doc = await db.collection("requests").doc(id).get();
  if (!doc.exists) return { ok: false, error: "not found" };
  return notifyResolved(doc);
}));

app.post("/push/send", auth, adminOnly, wrap(async (req) => {
  const id = req.body && req.body.pushId;
  if (!okId(id)) return { ok: false, error: "bad id" };
  return sendPushDoc(id);
}));

app.post("/push/offer", auth, adminOnly, wrap(async (req) => {
  const id = req.body && req.body.offerId;
  if (!okId(id)) return { ok: false, error: "bad id" };
  return sendOffer(id);
}));

/** serves the picture the admin picked from the gallery (FCM needs an https link for the big image) */
app.get("/img/:id", async (req, res) => {
  try {
    const id = str(req.params.id);
    if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return res.status(400).send("bad id");
    const doc = await db.collection("pushImages").doc(id).get();
    const data = doc.exists ? doc.get("data") : null;
    const m = typeof data === "string" && data.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/is);
    if (!m) return res.status(404).send("not found");
    res.set("Content-Type", m[1]);
    res.set("Cache-Control", "public, max-age=86400");
    res.status(200).send(Buffer.from(m[2], "base64"));
  } catch (e) { console.error(e); res.status(500).send("error"); }
});

// ------------------------------------------------------------------ catch-up (missed events)
const done = new Set();
const ago = (min) => admin.firestore.Timestamp.fromMillis(Date.now() - min * 60000);
const ms = (ts) => (ts && ts.toMillis ? ts.toMillis() : 0);
let busy = false;

async function catchUp() {
  if (busy) return;
  busy = true;
  try {
    const cut30 = Date.now() - 30 * 60000;

    const pend = await db.collection("requests").where("status", "==", "pending").limit(100).get();
    for (const d of pend.docs) {
      const k = `req_${d.id}`;
      if (done.has(k) || ms(d.get("createdAt")) < cut30) continue;
      await notifyRequest(d, null).catch((e) => console.error("catchUp req", e.message));
      done.add(k);
    }

    const users = await db.collection("users").where("createdAt", ">", ago(15)).limit(50).get();
    for (const d of users.docs) {
      const k = `reg_${d.id}`;
      if (done.has(k)) continue;
      try {
        const u = await admin.auth().getUser(d.id);
        await notifyRegister(d.id, u.email);
      } catch (e) { console.error("catchUp reg", e.message); }
      done.add(k);
    }

    const handled = await db.collection("requests").where("handledAt", ">", ago(15)).limit(100).get();
    for (const d of handled.docs) {
      const k = `res_${d.id}_${d.get("status")}`;
      if (done.has(k)) continue;
      await notifyResolved(d).catch((e) => console.error("catchUp res", e.message));
      done.add(k);
    }

    const pushes = await db.collection("pushes").where("status", "==", "pending").limit(10).get();
    for (const d of pushes.docs) {
      const age = Date.now() - ms(d.get("createdAt"));
      if (age < 45000 || age > 30 * 60000) continue;      // give the admin app's own call a head start
      await sendPushDoc(d.id).catch((e) => console.error("catchUp push", e.message));
    }
    if (done.size > 5000) done.clear();
  } catch (e) {
    console.error("catchUp", e.message);
  } finally { busy = false; }
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`winvibe-notify listening on ${PORT}  (public url: ${PUBLIC_URL || "not set"})`);
  setTimeout(catchUp, 4000);
  setInterval(catchUp, 60000).unref();
});
