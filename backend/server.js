// Proyecto Bowl - API mínima.
// GET  /health         -> estado
// GET  /api/data       -> versión actual (pública, solo lectura)
// PUT  /api/data       -> guarda; requiere header X-Bowl-Pin = BOWL_PIN
// GET  /api/history    -> últimas versiones guardadas (requiere PIN)
// Datos en el Mongo compartido con Sushi, aislados en bowl_data y bowl_history.

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGO_DATABASE || "sushi_queen";
const PIN = process.env.BOWL_PIN || "";
const ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || "https://hackerjj.github.io")
  .split(",").map(s => s.trim()).filter(Boolean);
const MAX_BODY = 256 * 1024;
const HISTORY_KEEP = 100;

if (!MONGO_URI) { console.error("Falta MONGO_URI"); process.exit(1); }
if (PIN.length < 6) { console.error("BOWL_PIN debe tener al menos 6 caracteres"); process.exit(1); }

const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
let col, hist;

// Intentos fallidos de PIN por IP (protección básica contra fuerza bruta)
const fails = new Map();
const WINDOW_MS = 15 * 60 * 1000, MAX_FAILS = 10;

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress;
}
function blocked(ip) {
  const f = fails.get(ip);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW_MS) { fails.delete(ip); return false; }
  return f.count >= MAX_FAILS;
}
function noteFail(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() - f.first > WINDOW_MS) fails.set(ip, { first: Date.now(), count: 1 });
  else f.count++;
}
function pinOk(given) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(PIN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cors(req, res) {
  const o = req.headers.origin;
  if (o && ORIGINS.includes(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bowl-Pin");
    res.setHeader("Access-Control-Max-Age", "600");
  }
}
function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("too_large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Validación de forma: evita guardar basura que rompa la calculadora
function validData(d) {
  if (!d || typeof d !== "object") return "data no es objeto";
  if (!d.params || typeof d.params !== "object") return "falta params";
  if (!Array.isArray(d.insumos) || d.insumos.length > 300) return "insumos inválidos";
  if (!Array.isArray(d.productos) || d.productos.length > 200) return "productos inválidos";
  for (const i of d.insumos) {
    if (!i || typeof i.id !== "string" || typeof i.nombre !== "string") return "insumo sin id/nombre";
    if (typeof i.precio !== "number" || typeof i.presentacion !== "number") return "insumo con números inválidos";
  }
  for (const p of d.productos) {
    if (!p || typeof p.id !== "string" || typeof p.nombre !== "string") return "producto sin id/nombre";
    if (typeof p.precio !== "number" || !p.cantidades || typeof p.cantidades !== "object") return "producto inválido";
  }
  return null;
}

async function current() {
  let doc = await col.findOne({ _id: "main" });
  if (!doc) {
    // Primera vez: sembrar con el data.json incluido
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "seed.json"), "utf8"));
    doc = { _id: "main", data: seed, actualizado: seed.actualizado, guardadoPor: seed.guardadoPor };
    await col.insertOne(doc);
  }
  return doc;
}

async function handle(req, res) {
  cors(req, res);
  const url = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (url.pathname === "/health") return send(res, 200, { ok: true });

  if (url.pathname === "/api/data" && req.method === "GET") {
    const doc = await current();
    return send(res, 200, doc.data);
  }

  if (url.pathname === "/api/data" && req.method === "PUT") {
    const ip = clientIp(req);
    if (blocked(ip)) return send(res, 429, { error: "Demasiados intentos con PIN incorrecto. Espera 15 minutos." });
    if (!pinOk(req.headers["x-bowl-pin"])) { noteFail(ip); return send(res, 401, { error: "PIN incorrecto" }); }
    fails.delete(ip);

    let body;
    try { body = JSON.parse(await readBody(req)); }
    catch (e) { return send(res, e.message === "too_large" ? 413 : 400, { error: "JSON inválido o demasiado grande" }); }

    const { data, baseStamp, force, guardadoPor } = body || {};
    const err = validData(data);
    if (err) return send(res, 400, { error: "Datos inválidos: " + err });

    const doc = await current();
    if (!force && baseStamp && doc.actualizado && baseStamp !== doc.actualizado) {
      return send(res, 409, { error: "conflict", actualizado: doc.actualizado, guardadoPor: doc.guardadoPor });
    }

    const stamp = new Date().toISOString();
    const who = String(guardadoPor || "Sin nombre").slice(0, 40);
    data.actualizado = stamp;
    data.guardadoPor = who;

    // Copia de la versión anterior al historial antes de sobrescribir
    await hist.insertOne({ data: doc.data, actualizado: doc.actualizado, guardadoPor: doc.guardadoPor, archivado: stamp });
    const old = await hist.find({}, { projection: { _id: 1 } }).sort({ archivado: -1 }).skip(HISTORY_KEEP).toArray();
    if (old.length) await hist.deleteMany({ _id: { $in: old.map(o => o._id) } });

    await col.updateOne({ _id: "main" }, { $set: { data, actualizado: stamp, guardadoPor: who } }, { upsert: true });
    return send(res, 200, { ok: true, actualizado: stamp, guardadoPor: who });
  }

  if (url.pathname === "/api/history" && req.method === "GET") {
    const ip = clientIp(req);
    if (blocked(ip)) return send(res, 429, { error: "Demasiados intentos" });
    if (!pinOk(req.headers["x-bowl-pin"])) { noteFail(ip); return send(res, 401, { error: "PIN incorrecto" }); }
    const items = await hist.find({}).sort({ archivado: -1 }).limit(30).toArray();
    return send(res, 200, items.map(h => ({ id: String(h._id), actualizado: h.actualizado, guardadoPor: h.guardadoPor, archivado: h.archivado, data: h.data })));
  }

  send(res, 404, { error: "not_found" });
}

async function main() {
  await client.connect();
  const db = client.db(DB_NAME);
  col = db.collection("bowl_data");
  hist = db.collection("bowl_history");
  await hist.createIndex({ archivado: -1 });
  http.createServer((req, res) => {
    handle(req, res).catch(e => { console.error(e); send(res, 500, { error: "error interno" }); });
  }).listen(PORT, () => console.log("proyectobowl-backend en puerto " + PORT));
}

main().catch(e => { console.error("No arrancó:", e.message); process.exit(1); });
