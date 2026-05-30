// ────────────────────────────────────────────────────────────
//  NEIRO 音色 — catalogue loader / adapter
//  Fetches _catalogue/catalogue.json (built by scripts/build_catalogue.py)
//  and shapes it into the CATALOGUE object the app consumes.
// ────────────────────────────────────────────────────────────
const FORMATS = {
  flac: { label: "FLAC",    bitrate: "1024kbps", cls: "fmt-flac", pillColor: "#d4a060" },
  mp3:  { label: "MP3 320", bitrate: "320kbps",  cls: "fmt-mp3",  pillColor: "#7eb89a" },
  m4a:  { label: "M4A",     bitrate: "256kbps",  cls: "fmt-m4a",  pillColor: "#9090c0" },
  aac:  { label: "AAC",     bitrate: "256kbps",  cls: "fmt-aac",  pillColor: "#9090c0" },
};

const KANJI = ["音", "色", "花", "夜", "波", "静"];

function dominantFormat(tracks) {
  const counts = {};
  for (const t of tracks) counts[t.format] = (counts[t.format] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "flac";
}

function adapt(raw) {
  // media_base_url is injected by CI when audio lives on the GitHub raw CDN
  // rather than under the Pages artifact root. Falls back to "" (relative
  // paths work when serving locally with music/ alongside public/).
  const mediaBase = (raw.meta?.media_base_url || "").replace(/\/$/, "");

  const cat = {
    artists: (raw.artists || []).map((a) => ({
      id:     a.id,
      name:   a.name,
      kana:   a.kana   || "",
      origin: a.origin || "",
      genre:  a.genre  || (a.albums?.[0]?.genre ?? ""),
      bio:    a.bio    || "",
      links:  a.links  || [],
      albums: a.albums || [],
    })),
    allAlbums:    [],
    contributors: raw.meta?.contributors || [],
  };

  cat.artists.forEach((artist) => {
    artist.albums.forEach((album, ai) => {
      // Normalise format to lowercase so filter keys match
      album.tracks.forEach((t) => {
        if (t.format) t.format = t.format.toLowerCase();
        // Prefix path with CDN base so <audio> can stream cross-origin
        if (mediaBase && t.path && !t.path.startsWith("http")) {
          t.path = mediaBase + "/" + t.path.split('/').map(encodeURIComponent).join('/');
        }
      });
      const _enc = p => p ? p.split('/').map(encodeURIComponent).join('/') : null;
      album.coverUrl    = (mediaBase && album.cover_path) ? mediaBase + "/" + _enc(album.cover_path) : null;
      // P3: covers are now externalised to public/_thumbs/<id>.<hash>.<ext>.
      // album.cover_thumb is the relative path; same-origin so loading="lazy"
      // works and the catalogue.json shrinks from 245 KB to 100 KB.
      if (album.cover_thumb && !album.cover) album.cover = album.cover_thumb;
      album.artist      = artist.name;
      album.artistId    = artist.id;
      album.kanjiIdx    = ai % KANJI.length;
      album.totalSize   = album.total_size_mb ?? album.tracks.reduce((s, t) => s + (t.size_mb || 0), 0);
      album.totalDuration = album.tracks.reduce((s, t) => s + (t.duration_sec || 0), 0);
      album.fmt         = dominantFormat(album.tracks);
      if (!album.shards || !album.shards.length) {
        album.shards = [{ label: "Full album ZIP", size_mb: album.totalSize }];
      }
      // Prefix shard download paths too
      if (mediaBase) {
        album.shards.forEach((s) => {
          if (s.path && !s.path.startsWith("http")) {
            s.path = mediaBase + "/" + s.path;
          }
        });
      }
      cat.allAlbums.push(album);
    });
  });

  cat.totalSongs = cat.allAlbums.reduce((s, a) => s + a.tracks.length, 0);
  cat.totalSize  = +(cat.allAlbums.reduce((s, a) => s + a.totalSize, 0) / 1024).toFixed(1);
  return cat;
}

async function loadCatalogue() {
  try {
    const res = await fetch("_catalogue/catalogue.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("catalogue.json " + res.status);
    return adapt(await res.json());
  } catch (err) {
    console.warn("[HIBIKI] catalogue load failed:", err);
    return adapt({ artists: [], meta: { contributors: [] } });
  }
}

window.FORMATS  = FORMATS;
window.KANJI    = KANJI;
window.HIBIKI_CATALOGUE_PROMISE = loadCatalogue().then((c) => {
  window.CATALOGUE = c;
  return c;
});
