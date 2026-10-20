// Armazenamento local do Mesma Lua (IndexedDB).
// Substitui o Supabase: os dados ficam NO NAVEGADOR de quem está usando.
// As fotos são guardadas dentro da própria estrela (como data URL, já reduzidas).

const DB_NAME = "mesma-lua";
const DB_VERSION = 1;
const STARS = "stars";
const EVENTS = "sky_events";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STARS)) db.createObjectStore(STARS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(EVENTS)) db.createObjectStore(EVENTS, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const os = tx.objectStore(store);
    let result;
    const req = fn(os);
    if (req) req.onsuccess = () => (result = req.result);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------- estrelas ----------
export async function listStars() {
  const all = await run(STARS, "readonly", (os) => os.getAll());
  return (all || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

export async function insertStar({ x, y, message, photo_url, author }) {
  const star = {
    id: newId(),
    x,
    y,
    message: message ?? null,
    photo_url: photo_url ?? null,
    author: author ?? null,
    created_at: new Date().toISOString(),
  };
  await run(STARS, "readwrite", (os) => os.put(star));
  return star;
}

export async function deleteStar(id) {
  await run(STARS, "readwrite", (os) => os.delete(id));
}

// ---------- eventos do céu ----------
export async function listEvents() {
  const all = await run(EVENTS, "readonly", (os) => os.getAll());
  return (all || []).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
}

export async function insertEvent(payload) {
  const ev = { id: newId(), ...payload, created_at: new Date().toISOString() };
  await run(EVENTS, "readwrite", (os) => os.put(ev));
  return ev;
}

export async function updateEvent(id, payload) {
  const current = await run(EVENTS, "readonly", (os) => os.get(id));
  if (!current) throw new Error("Evento não encontrado");
  const ev = { ...current, ...payload };
  await run(EVENTS, "readwrite", (os) => os.put(ev));
  return ev;
}

export async function deleteEvent(id) {
  await run(EVENTS, "readwrite", (os) => os.delete(id));
}

// ---------- fotos ----------
// Reduz a foto (lado maior = 1600px, JPEG 0.82) e devolve uma data URL.
export function photoToDataUrl(file, maxSide = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não consegui ler a foto"));
    };
    img.src = url;
  });
}

// ---------- backup ----------
// Como os dados vivem só neste navegador, o backup em arquivo é a garantia
// contra limpar dados do navegador / trocar de celular.
export async function exportBackup() {
  const [stars, sky_events] = await Promise.all([listStars(), listEvents()]);
  const blob = new Blob(
    [JSON.stringify({ app: "mesma-lua", version: 1, exported_at: new Date().toISOString(), stars, sky_events })],
    { type: "application/json" }
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mesma-lua-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== "mesma-lua") throw new Error("Arquivo inválido");
  for (const s of data.stars || []) await run(STARS, "readwrite", (os) => os.put(s));
  for (const e of data.sky_events || []) await run(EVENTS, "readwrite", (os) => os.put(e));
}
