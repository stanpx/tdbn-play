// TDBN Play - Plugin oficial de Kino
// Contenido independiente: Películas, Series, Anime, Documentales y TV en vivo.

const ARCHIVE_BASE = "https://archive.org";
const FAMELACK_BASE = "https://raw.githubusercontent.com/famelack/famelack-data/refs/heads/main/tv/raw/countries";
const FIELDS = ["identifier", "title", "year", "description"];
const VALID_ID = /^[A-Za-z0-9._~-]{1,128}$/;
const PLAYABLE_EXT = /\.(mp4|m4v|webm)$/i;
const SUBTITLE_EXT = /\.(vtt|srt)$/i;
const FORMAT_RANK = ["h.264", "h.264 hd", "mpeg4", "512kb mpeg4"];

const FILMS = "collection:(feature_films) AND mediatype:(movies)";
const TV = "collection:(classic_tv) AND mediatype:(movies)";
const CARTOONS = "collection:(animationandcartoons) AND mediatype:(movies)";
const DOCS = "collection:(Documentaries) AND mediatype:(movies)";

const ROWS = [
  { id: "films", title: "Películas independientes y cine clásico", query: FILMS, kind: "movie", genre: "peliculas" },
  { id: "cartoons", title: "Anime y animación", query: CARTOONS, kind: "movie", genre: "anime" },
  { id: "tv", title: "Series independientes y clásicas", query: TV, kind: "series", genre: "series" },
  { id: "docs", title: "Documentales", query: DOCS, kind: "movie", genre: "documentales" },
];

const LIVE_COUNTRIES = [
  { id: "es", title: "España", flag: "es" },
  { id: "mx", title: "México", flag: "mx" },
  { id: "ar", title: "Argentina", flag: "ar" },
  { id: "us", title: "Estados Unidos", flag: "us" },
];

function log(...args) {
  try {
    kino.log(...args);
  } catch {}
}

function advancedUrl(query, rows, page = 1, sort = "downloads desc") {
  const parts = ["q=" + encodeURIComponent(query)];
  for (const f of FIELDS) parts.push("fl%5B%5D=" + f);
  parts.push("sort%5B%5D=" + encodeURIComponent(sort), "rows=" + rows, "page=" + page, "output=json");
  return ARCHIVE_BASE + "/advancedsearch.php?" + parts.join("&");
}

async function getJson(url) {
  const r = await kino.fetch(url);
  if (!r.ok) throw kino.error("unavailable", "Error de conexión: " + r.status);
  return r.json();
}

function first(v) {
  return Array.isArray(v) ? v[0] : v;
}

function toItem(doc, kind) {
  const desc = [].concat(doc.description || []).join(" ").replace(/<[^>]*>/g, "").trim();
  const rawId = String(doc.identifier || "").replace(/[^A-Za-z0-9._~-]/g, "_");
  return {
    id: rawId,
    ref: doc.identifier,
    title: String(first(doc.title) || doc.identifier),
    kind,
    year: doc.year ? String(first(doc.year)) : undefined,
    poster: ARCHIVE_BASE + "/services/img/" + encodeURIComponent(doc.identifier),
    overview: desc ? desc.slice(0, 400) : undefined,
  };
}

async function queryDocs(query, rows, page = 1, sort) {
  const data = await getJson(advancedUrl(query, rows, page, sort));
  if (!data.response || !Array.isArray(data.response.docs)) {
    throw kino.error("unavailable", "No se recibieron resultados de la consulta");
  }
  return data.response.docs.filter((d) => VALID_ID.test(d.identifier));
}

// ---- Exportaciones requeridas por el contrato de Kino ----

export async function search(query) {
  await null;
  const q = String(query.q || query.query || "").trim();
  if (!q) return [];
  const safeQ = q.replace(/[:"\\]/g, " ");
  const searchQuery = `(${safeQ}) AND mediatype:(movies)`;
  try {
    const docs = await queryDocs(searchQuery, 30);
    return docs.map((d) => toItem(d, query.type === "series" ? "series" : "movie"));
  } catch (e) {
    log("search failed", e.message);
    return [];
  }
}

export async function home() {
  await null;
  const out = [];
  for (const row of ROWS) {
    try {
      const docs = await queryDocs(row.query, 25);
      if (docs.length) {
        out.push({
          id: row.id,
          title: row.title,
          ref: row.id,
          genre: row.genre,
          items: docs.map((d) => toItem(d, row.kind)),
        });
      }
    } catch (e) {
      log("home row failed", row.id, e.message);
    }
  }
  return out;
}

export async function browse(ref, cursor) {
  await null;
  const row = ROWS.find((r) => r.id === ref);
  if (!row) throw kino.error("not_found", "Fila no encontrada");
  const page = cursor ? Number(cursor) : 1;
  if (!Number.isInteger(page) || page < 1 || page > 100) {
    throw kino.error("not_found", "Página inválida");
  }
  const PAGE_SIZE = 40;
  const docs = await queryDocs(row.query, PAGE_SIZE, page);
  return {
    items: docs.map((d) => toItem(d, row.kind)),
    next: docs.length === PAGE_SIZE ? String(page + 1) : undefined,
  };
}

async function metadata(id) {
  const data = await getJson(ARCHIVE_BASE + "/metadata/" + encodeURIComponent(id));
  if (!data || !Array.isArray(data.files)) {
    throw kino.error("not_found", "Este título no está disponible");
  }
  return data;
}

function videoOriginals(files) {
  const playable = new Set();
  for (const f of files) {
    if (!PLAYABLE_EXT.test(f.name)) continue;
    const from = f.source === "original" ? f.name : f.original;
    if (from) playable.add(from);
  }
  return files.filter((f) => f.source === "original" && playable.has(f.name));
}

function rankFormat(f) {
  const i = FORMAT_RANK.indexOf(String(f.format || "").toLowerCase());
  return i === -1 ? FORMAT_RANK.length : i;
}

function bestPlayable(files, original) {
  const family = files.filter(
    (f) => (f.name === original.name || f.original === original.name) && PLAYABLE_EXT.test(f.name)
  );
  family.sort((a, b) => rankFormat(a) - rankFormat(b));
  return family[0] || null;
}

function downloadUrl(id, name) {
  return ARCHIVE_BASE + "/download/" + encodeURIComponent(id) + "/" + name.split("/").map(encodeURIComponent).join("/");
}

export async function episodes(ref) {
  await null;
  const meta = await metadata(ref);
  const originals = videoOriginals(meta.files);
  const title = String(first(meta.metadata && meta.metadata.title) || ref);
  const list = originals.length ? originals : [{ name: ref, format: "h.264" }];

  return {
    series: {
      title,
      poster: ARCHIVE_BASE + "/services/img/" + encodeURIComponent(ref),
    },
    episodes: list.map((f, i) => ({
      id: `${ref}_s1e${i + 1}`.replace(/[^A-Za-z0-9._~-]/g, "_"),
      season: 1,
      number: i + 1,
      ref: ref + "|" + f.name,
      title: f.title ? String(f.title) : `Episodio ${i + 1}`,
    })),
  };
}

export async function resolve(ref) {
  await null;
  if (ref.startsWith("live|")) {
    const streamUrl = ref.slice(5);
    return {
      url: streamUrl,
      mime: streamUrl.includes(".m3u8") ? "application/x-mpegURL" : "video/mp4",
    };
  }

  const cut = ref.indexOf("|");
  const id = cut === -1 ? ref : ref.slice(0, cut);
  const wanted = cut === -1 ? null : ref.slice(cut + 1);
  const meta = await metadata(id);
  const originals = videoOriginals(meta.files);
  const original = wanted ? originals.find((f) => f.name === wanted) : originals[0];
  if (!original) throw kino.error("not_found", "Este título no contiene video reproducible");
  const file = bestPlayable(meta.files, original);
  if (!file) throw kino.error("not_found", "No hay video compatible en formato mp4");

  const subtitles = meta.files
    .filter((f) => SUBTITLE_EXT.test(f.name))
    .map((f) => ({
      lang: /[._](es|spa|spanish)[._]/i.test(f.name) ? "es" : "en",
      url: downloadUrl(id, f.name),
      format: /\.srt$/i.test(f.name) ? "srt" : "vtt",
    }));

  return {
    url: downloadUrl(id, file.name),
    mime: /\.webm$/i.test(file.name) ? "video/webm" : "video/mp4",
    subtitles,
  };
}

// ---- Canales de TV en directo (capabilities: channels) ----

export async function liveCategories() {
  await null;
  return LIVE_COUNTRIES.map((c) => ({
    id: c.id,
    title: c.title,
    genre: "general",
  }));
}

export async function liveChannels({ categoryId, cursor }) {
  await null;
  const code = categoryId || "es";
  const url = `${FAMELACK_BASE}/${code}.json`;
  let list = [];
  try {
    const res = await kino.fetch(url);
    if (res.ok) list = await res.json();
  } catch (e) {
    log("liveChannels fetch failed", e.message);
  }

  const valid = list.filter(
    (c) => c.sources && Array.isArray(c.sources.streams) && c.sources.streams.length > 0 && !c.isGeoBlocked
  );

  const page = cursor ? parseInt(cursor, 10) : 1;
  const PAGE_SIZE = 50;
  const start = (page - 1) * PAGE_SIZE;
  const slice = valid.slice(start, start + PAGE_SIZE);

  const items = slice.map((c, i) => {
    const streamUrl = c.sources.streams[0];
    const flag = code === "uk" ? "gb" : code;
    return {
      id: `live_${code}_${c.nanoid || i}`.replace(/[^A-Za-z0-9._~-]/g, "_"),
      title: c.name,
      number: start + i + 1,
      categoryId: code,
      logo: `https://flagcdn.com/w320/${flag}.png`,
      ref: "live|" + streamUrl,
      stream: {
        url: streamUrl,
        mime: "application/x-mpegURL",
      },
    };
  });

  return {
    items,
    next: start + PAGE_SIZE < valid.length ? String(page + 1) : null,
  };
}
