// ────────────────────────────────────────────────────────────
//  HIBIKI 響 — application logic
// ────────────────────────────────────────────────────────────
(async function () {
  'use strict';

  // Wait for catalogue.json to load before booting
  await window.HIBIKI_CATALOGUE_PROMISE;

  // ── State ─────────────────────────────────────────────────
  const state = {
    route: 'library', subRoute: null, subId: null,
    filters: { format: null, genre: null, decade: null },
    sort: 'recent', search: '',
    player: { queue: [], idx: 0, playing: false, currentTime: 0, duration: 0, volume: 0.7 },
  };

  const audio = new Audio();
  audio.volume = state.player.volume;

  // ── DOM refs ──────────────────────────────────────────────
  const app        = document.getElementById('app');
  const pbTitle    = document.getElementById('pbTitle');
  const pbArtist   = document.getElementById('pbArtist');
  const pbArt      = document.getElementById('pbArt');
  const pbPlay     = document.getElementById('pbPlay');
  const pbPlayIcon = document.getElementById('pbPlayIcon');
  const pbPrev     = document.getElementById('pbPrev');
  const pbNext     = document.getElementById('pbNext');
  const pbCurrent  = document.getElementById('pbCurrent');
  const pbTotal    = document.getElementById('pbTotal');
  const pbBarFill  = document.getElementById('pbBarFill');
  const pbBar      = document.getElementById('pbBar');
  const pbFmt      = document.getElementById('pbFmt');
  const pbDl       = document.getElementById('pbDl');
  const pbVolFill  = document.getElementById('pbVolFill');
  const pbVolBar   = document.getElementById('pbVolBar');
  const pbVolIcon  = document.getElementById('pbVolIcon');
  const songBadge  = document.getElementById('songCountBadge');
  const searchInput = document.getElementById('searchInput');
  const toastRegion = document.getElementById('toastRegion');

  // ── Utilities ─────────────────────────────────────────────
  function fmt(sec) {
    const m = Math.floor(sec / 60);
    const s = String(Math.floor(sec % 60)).padStart(2, '0');
    return `${m}:${s}`;
  }
  function fmtFull(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = String(Math.floor(sec % 60)).padStart(2, '0');
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${s}`;
    return `${m}:${s}`;
  }
  function fmtMB(mb) {
    if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
    return Math.round(mb) + ' MB';
  }
  function kClass(i)  { return 'k' + (i % 6); }
  function kChar(i)   { return KANJI[i % 6]; }
  function fmtCls(f)  { return 'fmt-' + (f||'').toLowerCase(); }
  function fmtLbl(f)  { return (FORMATS[(f||'').toLowerCase()] || {}).label || (f||'').toUpperCase(); }
  function albumIdx(album) { return CATALOGUE.allAlbums.indexOf(album); }

  function toast(msg, k = '響') {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span class="tk">${k}</span>${msg}`;
    toastRegion.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  // ── Filtering / search ────────────────────────────────────
  function filteredAlbums() {
    const q = state.search.toLowerCase();
    let list = CATALOGUE.allAlbums.filter(a => {
      if (q && !(
        a.title.toLowerCase().includes(q) ||
        a.artist.toLowerCase().includes(q) ||
        a.genre.toLowerCase().includes(q) ||
        a.tracks.some(t => t.title.toLowerCase().includes(q))
      )) return false;
      if (state.filters.format && a.fmt !== state.filters.format) return false;
      if (state.filters.genre) {
        if (!a.genre.toLowerCase().includes(state.filters.genre.toLowerCase())) return false;
      }
      if (state.filters.decade) {
        if (Math.floor(a.year / 10) * 10 !== parseInt(state.filters.decade)) return false;
      }
      return true;
    });
    if (state.sort === 'alpha') list = [...list].sort((a,b) => a.title.localeCompare(b.title));
    else if (state.sort === 'year') list = [...list].sort((a,b) => b.year - a.year);
    return list;
  }
  function countFmt(f)   { return CATALOGUE.allAlbums.filter(a=>a.fmt===f).reduce((s,a)=>s+a.tracks.length,0); }
  function countGenre(g) { const gl=g.toLowerCase(); return CATALOGUE.allAlbums.filter(a=>a.genre.toLowerCase().includes(gl)).reduce((s,a)=>s+a.tracks.length,0); }
  function countDecade(d){ const di=parseInt(d); return CATALOGUE.allAlbums.filter(a=>Math.floor(a.year/10)*10===di).reduce((s,a)=>s+a.tracks.length,0); }

  // ── Card HTML ─────────────────────────────────────────────
  function cardHTML(album, i) {
    const ki = i % 6;
    const dlLabel = album.shards.length > 1 ? `↓ ${album.shards.length} parts` : '↓ ZIP';
    return `
<article class="album-card" role="listitem" tabindex="0"
  data-album-id="${album.id}"
  aria-label="${album.title} by ${album.artist}">
  <div class="art-wrap ${kClass(ki)}" aria-hidden="true">
    ${kChar(ki)}
    <span class="fmt-badge ${fmtCls(album.fmt)}">${fmtLbl(album.fmt)}</span>
  </div>
  <div class="card-body">
    <div class="card-title">${album.title}</div>
    <div class="card-artist">${album.artist}</div>
    <div class="card-footer">
      <div class="card-meta">${album.tracks.length} tracks<br>${fmtMB(album.totalSize)}</div>
      <button class="dl-btn" data-dl-album="${album.id}" aria-label="Download ${album.title}">${dlLabel}</button>
    </div>
  </div>
</article>`;
  }

  // ── View: Library ─────────────────────────────────────────
  function viewLibrary() {
    const albums = filteredAlbums();
    const sortLabels = { recent:'recently added ↓', alpha:'alphabetical ↑', year:'year ↓' };
    const GENRES  = [...new Set(CATALOGUE.allAlbums.map(a=>a.genre))].sort();
    const DECADES = [...new Set(CATALOGUE.allAlbums.map(a=>Math.floor(a.year/10)*10))].sort((a,b)=>b-a);
    return `
<div class="layout">
  <aside class="sidebar-left" aria-label="Filters">
    <div class="filter-group">
      <span class="filter-label">Format</span>
      <div class="filter-item${!state.filters.format?' active':''}" tabindex="0" role="button" data-ff="">
        <span>All formats</span><span class="filter-count">${CATALOGUE.totalSongs}</span>
      </div>
      ${['flac','mp3','m4a'].map(f=>`
      <div class="filter-item${state.filters.format===f?' active':''}" tabindex="0" role="button" data-ff="${f}">
        <span>${FORMATS[f].label}</span><span class="filter-count">${countFmt(f)}</span>
      </div>`).join('')}
    </div>
    <div class="filter-group">
      <span class="filter-label">Genre</span>
      ${GENRES.map(g=>`
      <div class="filter-item${state.filters.genre===g?' active':''}" tabindex="0" role="button" data-fg="${g}">
        <span>${g}</span><span class="filter-count">${countGenre(g)}</span>
      </div>`).join('')}
    </div>
    <div class="filter-group">
      <span class="filter-label">Decade</span>
      ${DECADES.map(d=>`
      <div class="filter-item${state.filters.decade===String(d)?' active':''}" tabindex="0" role="button" data-fd="${d}">
        <span>${d}s</span><span class="filter-count">${countDecade(d)}</span>
      </div>`).join('')}
    </div>
    <div class="watermark" aria-hidden="true">響</div>
  </aside>

  <main class="main" role="main">
    <div class="main-header">
      <h1 class="main-title">All albums <small>${albums.length} results</small></h1>
      <span class="sort-control">sorted by — <span class="sort-pill">${sortLabels[state.sort]}</span></span>
    </div>
    <div class="album-grid" role="list">
      ${albums.length
        ? albums.map((a,i)=>cardHTML(a,i)).join('')
        : `<div class="empty-state" style="grid-column:1/-1">
            <div class="ek">静</div>
            <div class="et">No results</div>
            <div class="es">Try a different search or filter</div>
          </div>`}
    </div>
  </main>

  <aside class="sidebar-right" aria-label="Now playing and queue" id="npSidebar">
    ${viewNowPlaying()}
  </aside>
</div>`;
  }

  function viewNowPlaying() {
    const p = state.player;
    const item = p.queue[p.idx];
    const ki = item ? albumIdx(item.album) % 6 : 0;
    const pct = p.duration > 0 ? (p.currentTime / p.duration * 100).toFixed(1) : 0;
    const upNext = p.queue.slice(p.idx + 1, p.idx + 6);
    return `
<div class="np-panel">
  <div class="panel-label">
    ${item && p.playing ? '<span class="blink"></span>' : ''}Now playing
  </div>
  <div class="np-art ${kClass(ki)}" aria-hidden="true">${kChar(ki)}</div>
  <div class="np-title">${item ? item.track.title : '—'}</div>
  <div class="np-artist">${item ? item.artist : 'No track selected'}</div>
  <div class="np-controls" role="group" aria-label="Playback controls">
    <button class="ctrl-btn" id="npPrev" aria-label="Previous track"><i class="ti ti-player-skip-back" aria-hidden="true"></i></button>
    <button class="ctrl-btn play-btn" id="npPlay" aria-label="${p.playing?'Pause':'Play'}">
      <i class="ti ${p.playing?'ti-player-pause':'ti-player-play'}" aria-hidden="true"></i>
    </button>
    <button class="ctrl-btn" id="npNext" aria-label="Next track"><i class="ti ti-player-skip-forward" aria-hidden="true"></i></button>
  </div>
  <div class="np-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
    <div class="np-progress-fill" id="npFill" style="width:${pct}%"></div>
  </div>
  <div class="np-times"><span id="npCur">${fmt(p.currentTime)}</span><span>${fmt(p.duration)}</span></div>
</div>
${upNext.length ? `
<div class="queue-panel">
  <div class="panel-label">Up next</div>
  ${upNext.map((it,i)=>`
  <div class="queue-item" tabindex="0" role="button" data-qi="${p.idx+1+i}">
    <span class="queue-num">${p.idx+2+i}</span>
    <div class="queue-info">
      <div class="queue-title">${it.track.title}</div>
      <div class="queue-artist">${it.artist}</div>
    </div>
    <span class="queue-dur">${fmt(it.track.duration_sec)}</span>
  </div>`).join('')}
</div>` : ''}`;
  }

  // ── View: Album ───────────────────────────────────────────
  function viewAlbum(id) {
    const album = CATALOGUE.allAlbums.find(a=>a.id===id);
    if (!album) return noResult('波','Album not found');
    const ki = albumIdx(album) % 6;
    return `
<div class="album-page">
  <button class="album-back" data-nav="library"><i class="ti ti-arrow-left"></i> Back to library</button>
  <div class="album-hero">
    <div class="album-hero-art ${kClass(ki)} art-wrap" aria-hidden="true">${kChar(ki)}</div>
    <div class="album-hero-info">
      <div class="hero-genre-tag">${album.genre}<span class="sep"> · </span>${album.year}</div>
      <h1 class="hero-album-title">${album.title}</h1>
      <div class="hero-artist-name" data-nav="artist" data-artist-id="${album.artistId}">${album.artist}</div>
      <div class="hero-stats">
        <div class="hero-stat"><strong>${album.tracks.length}</strong>Tracks</div>
        <div class="hero-stat"><strong>${fmtMB(album.totalSize)}</strong>Total size</div>
        <div class="hero-stat"><strong>${fmtLbl(album.fmt)}</strong>Format</div>
        <div class="hero-stat"><strong>${fmtFull(album.totalDuration)}</strong>Duration</div>
      </div>
      ${album.notes ? `<p class="hero-notes">${album.notes}</p>` : ''}
    </div>
  </div>
  <div class="download-bar">
    <span class="dl-label">↓ Download album</span>
    ${album.shards.map(s=>`<button class="dl-part-btn" data-dl>${s.label} · ${fmtMB(s.size_mb)}</button>`).join('')}
    <span class="dl-total">${fmtMB(album.totalSize)} total · iPod-ready ZIPs</span>
  </div>
  <div class="tracklist-wrap">
    <table class="tracklist" aria-label="Track listing for ${album.title}">
      <thead><tr>
        <th scope="col">#</th><th scope="col">Title</th><th scope="col">Duration</th>
        <th scope="col">Format</th><th scope="col">Size</th>
        <th scope="col"><span class="sr-only">Download</span></th>
      </tr></thead>
      <tbody>
        ${album.tracks.map((tr,i)=>{
          const playing = state.player.queue.length &&
            state.player.queue[state.player.idx]?.albumId===id &&
            state.player.queue[state.player.idx]?.trackIdx===i;
          return `
<tr class="${playing?'playing':''}" data-play="${id}" data-ti="${i}" style="cursor:pointer">
  <td class="td-num">
    <span class="num-text">${String(tr.number).padStart(2,'0')}</span>
    <span class="play-on-hover" aria-hidden="true"><i class="ti ti-player-play-filled"></i></span>
  </td>
  <td class="td-title">${tr.title}</td>
  <td class="td-dur">${fmt(tr.duration_sec)}</td>
  <td class="td-fmt"><span class="fmt-pill ${fmtCls(tr.format)}">${fmtLbl(tr.format)}</span></td>
  <td class="td-size">${tr.size_mb.toFixed(1)} MB</td>
  <td class="td-dl"><button class="track-dl" data-dl>↓ track</button></td>
</tr>`;}).join('')}
      </tbody>
    </table>
  </div>
  ${(()=>{
    const artist = CATALOGUE.artists.find(a=>a.id===album.artistId);
    const others = artist?.albums.filter(a=>a.id!==id).slice(0,4);
    return others?.length ? `
<div class="related-block">
  <h2 class="main-title" style="margin-bottom:16px">More by ${artist.name}</h2>
  <div class="album-grid" style="grid-template-columns:repeat(4,1fr)">
    ${others.map((a,i)=>cardHTML(a,i)).join('')}
  </div>
</div>` : '';
  })()}
</div>`;
  }

  // ── View: Artists list ────────────────────────────────────
  function viewArtists() {
    return `
<div class="artist-listing">
  <div class="main-header" style="padding:22px 28px 12px;border-bottom:var(--rule-strong)">
    <h1 class="main-title">Artists <small>${CATALOGUE.artists.length} artists</small></h1>
  </div>
  ${CATALOGUE.artists.map((ar,i)=>{
    const tracks = ar.albums.reduce((s,a)=>s+a.tracks.length,0);
    const size   = ar.albums.reduce((s,a)=>s+a.totalSize,0);
    return `
<div class="artist-row" tabindex="0" role="button" data-nav="artist" data-artist-id="${ar.id}">
  <span class="ar-index">${String(i+1).padStart(2,'0')}</span>
  <div class="ar-name">${ar.name} <small>${ar.kana}</small></div>
  <div class="ar-stats">${ar.albums.length} albums · ${tracks} tracks · ${fmtMB(size)}</div>
  <div class="ar-genre">${ar.genre}</div>
  <div class="ar-arrow">→</div>
</div>`;
  }).join('')}
</div>`;
  }

  // ── View: Artist page ─────────────────────────────────────
  function viewArtist(id) {
    const artist = CATALOGUE.artists.find(a=>a.id===id);
    if (!artist) return noResult('波','Artist not found');
    const tracks = artist.albums.reduce((s,a)=>s+a.tracks.length,0);
    const size   = artist.albums.reduce((s,a)=>s+a.totalSize,0);
    return `
<div class="artist-page">
  <button class="album-back" data-nav="artists"><i class="ti ti-arrow-left"></i> All artists</button>
  <div class="artist-header">
    <div>
      <div class="artist-kana">${artist.kana}</div>
      <h1 class="artist-name">${artist.name}</h1>
      ${artist.bio ? `<p class="artist-bio">${artist.bio}</p>` : ''}
    </div>
    <div class="artist-meta-block">
      <div class="artist-meta-row"><span class="k">Albums</span><span class="v">${artist.albums.length}</span></div>
      <div class="artist-meta-row"><span class="k">Tracks</span><span class="v">${tracks}</span></div>
      <div class="artist-meta-row"><span class="k">Total size</span><span class="v">${fmtMB(size)}</span></div>
      <div class="artist-meta-row"><span class="k">Origin</span><span class="v">${artist.origin}</span></div>
      <div class="artist-meta-row"><span class="k">Genre</span><span class="v">${artist.genre}</span></div>
    </div>
  </div>
  <div class="artist-discog-title">
    Discography <small>${artist.albums.length} ${artist.albums.length===1?'album':'albums'}</small>
  </div>
  <div class="album-grid">${artist.albums.map((a,i)=>cardHTML(a,i)).join('')}</div>
</div>`;
  }

  // ── View: Contribute ──────────────────────────────────────
  function viewContribute() {
    const GENRES = ['Ambient','Electronic','Jazz','Classical','Rock','Folk','Field Recording','Other'];
    return `
<div class="contribute-layout">
  <h1 class="page-heading">Share music <span class="kanji-after">音楽を共有する</span></h1>
  <p class="page-sub">Your contribution will be reviewed and added to the library</p>
  <div class="form-section">
    <span class="form-section-label">Release info</span>
    <div class="form-grid-2">
      <div class="form-field"><label for="f-artist">Artist name *</label><input type="text" id="f-artist" placeholder="e.g. Aphex Twin" /></div>
      <div class="form-field"><label for="f-album">Album title *</label><input type="text" id="f-album" placeholder="e.g. Selected Ambient Works" /></div>
      <div class="form-field"><label for="f-year">Release year *</label><input type="number" id="f-year" placeholder="1992" min="1900" max="${new Date().getFullYear()}" /></div>
      <div class="form-field"><label for="f-genre">Genre *</label>
        <select id="f-genre"><option value="">— select —</option>${GENRES.map(g=>`<option>${g}</option>`).join('')}</select>
      </div>
    </div>
  </div>
  <div class="form-section">
    <span class="form-section-label">Audio files</span>
    <div class="drop-zone" id="audioZone" role="button" tabindex="0" aria-label="Drop zone for audio files">
      <div class="drop-zone-icon"><i class="ti ti-music" aria-hidden="true"></i></div>
      <div class="drop-zone-text">Drop FLAC, MP3, M4A, or AAC files here</div>
      <div class="drop-zone-sub">or click to browse · Max 100 MB per file · 500 MB total</div>
    </div>
    <input type="file" id="audioInput" accept=".flac,.mp3,.m4a,.aac" multiple style="display:none" />
    <div class="validation-panel" id="audioPanel" style="display:none" aria-live="polite"></div>
  </div>
  <div class="form-section">
    <span class="form-section-label">Cover art</span>
    <div class="drop-zone" id="artZone" role="button" tabindex="0" aria-label="Drop zone for cover art">
      <div class="drop-zone-icon"><i class="ti ti-photo" aria-hidden="true"></i></div>
      <div class="drop-zone-text">Drop cover art here</div>
      <div class="drop-zone-sub">JPG or PNG · minimum 500×500 px recommended</div>
    </div>
    <input type="file" id="artInput" accept=".jpg,.jpeg,.png" style="display:none" />
  </div>
  <div class="form-section">
    <span class="form-section-label">About you</span>
    <div class="form-grid-2">
      <div class="form-field"><label for="f-handle">Your handle (optional)</label><input type="text" id="f-handle" placeholder="e.g. @username" /></div>
    </div>
    <div class="form-field" style="margin-top:12px">
      <label for="f-notes">Notes to owner</label>
      <textarea id="f-notes" placeholder="Anything the owner should know..."></textarea>
    </div>
  </div>
  <div class="license-row">
    <input type="checkbox" id="f-license" />
    <label for="f-license">I confirm I have the right to distribute these files and agree they will be made freely available to the public.</label>
  </div>
  <button class="submit-btn" id="submitBtn" type="button" disabled>Submit for review — 開く</button>
  <div class="how-it-works">
    <h2 class="main-title">How it works</h2>
    <p class="how-sub">Four steps from your hard drive to the library</p>
    <div class="how-steps">
      ${[['01','Upload','Fill the form and drop your files. We validate tags and formats automatically.'],
         ['02','Review','A pull request is opened on GitHub. The owner reviews your submission.'],
         ['03','Merge','If approved, the PR is merged. The site rebuilds automatically.'],
         ['04','Live','Your music appears in the library, credited to your handle.'],
      ].map(([n,t,d])=>`
      <div class="how-step">
        <div class="how-step-num">${n}</div>
        <div class="how-step-title">${t}</div>
        <div class="how-step-desc">${d}</div>
      </div>`).join('')}
    </div>
  </div>
</div>`;
  }

  // ── View: Contributors ────────────────────────────────────
  function viewContributors() {
    const c = CATALOGUE.contributors || [];
    const totalAlbums = c.reduce((s,x)=>s+x.albums,0);
    const totalSongs  = c.reduce((s,x)=>s+x.songs,0);
    return `
<div class="contrib-layout">
  <h1 class="page-heading" style="margin-bottom:24px">Contributors
    <span style="font-family:var(--font-data);font-size:14px;font-weight:400;color:var(--ink-faint);margin-left:8px">貢献者</span>
  </h1>
  <div class="contrib-stats" role="list">
    <div class="contrib-stat" role="listitem"><div class="contrib-stat-val">${c.filter(x=>x.handle!=='Anonymous').length}</div><div class="contrib-stat-label">Contributors</div></div>
    <div class="contrib-stat" role="listitem"><div class="contrib-stat-val">${totalAlbums}</div><div class="contrib-stat-label">Albums added</div></div>
    <div class="contrib-stat" role="listitem"><div class="contrib-stat-val">${totalSongs}</div><div class="contrib-stat-label">Songs contributed</div></div>
    <div class="contrib-stat" role="listitem"><div class="contrib-stat-val">${(totalSongs*25/1024).toFixed(0)} GB</div><div class="contrib-stat-label">Music shared</div></div>
  </div>
  <table class="contrib-table" aria-label="Contributors list">
    <thead><tr>
      <th scope="col">Handle</th><th scope="col">Albums</th><th scope="col">Songs</th>
      <th scope="col">First contribution</th><th scope="col">Latest</th>
    </tr></thead>
    <tbody>
      ${c.map(x=>`<tr>
        <td><span class="contrib-handle">${x.handle}</span></td>
        <td class="contrib-num">${x.albums}</td>
        <td class="contrib-num">${x.songs}</td>
        <td class="contrib-date">${x.first}</td>
        <td class="contrib-date">${x.latest}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>`;
  }

  // ── View: About ───────────────────────────────────────────
  function viewAbout() {
    return `
<div class="about-layout">
  <h1 class="page-heading" style="margin-bottom:24px">About <span class="kanji-after">について</span></h1>
  <div class="about-block">
    <h2>What is HIBIKI?</h2>
    <p>HIBIKI (響) is a free, public music archive — a zero-infrastructure static site over a GitHub repository. No backend, no database, no tracking.</p>
    <p>Browse, preview, and download freely. Contribute your own music via a pull request.</p>
  </div>
  <div class="about-block">
    <h2>Technical stack <small>How it works</small></h2>
    <table class="tech-table">
      <tr><td>Hosting</td><td>GitHub Pages — free static hosting</td></tr>
      <tr><td>Build &amp; CI</td><td>GitHub Actions — free for public repos</td></tr>
      <tr><td>Large files</td><td>Git LFS — audio tracked via LFS</td></tr>
      <tr><td>Catalogue</td><td>Python builder generates JSON at build time</td></tr>
      <tr><td>PWA</td><td>Web App Manifest + service worker</td></tr>
    </table>
  </div>
  <div class="about-block">
    <h2>iPod setup guide <small>添付ガイド</small></h2>
    <p>Every album download is a ZIP in iPod folder structure. Drag the unzipped folder into Music.app (macOS) or iTunes — files import with correct metadata and cover art.</p>
    <p>For multi-part albums, download all parts and drag them all in. They merge automatically.</p>
  </div>
  <div class="about-block">
    <h2>Keyboard shortcuts <small>キーボード</small></h2>
    <table class="tech-table">
      <tr><td>Space</td><td>Play / pause</td></tr>
      <tr><td>Alt + ← →</td><td>Previous / next track</td></tr>
      <tr><td>M</td><td>Mute / unmute</td></tr>
      <tr><td>/</td><td>Focus search</td></tr>
    </table>
  </div>
  <div class="about-block">
    <h2>License</h2>
    <p>Site code: MIT. Music and cover art: per-album (see each album's <code>meta.yaml</code>). See <a href="https://github.com/SarangVehale/hibiki/blob/main/LICENSING.md">LICENSING.md</a> for details.</p>
  </div>
</div>`;
  }

  function noResult(k, msg) {
    return `<div class="empty-state"><div class="ek">${k}</div><div class="et">${msg}</div></div>`;
  }

  // ── Routing ───────────────────────────────────────────────
  function navigate(route, sub, id) {
    state.route = route; state.subRoute = sub||null; state.subId = id||null;
    document.querySelectorAll('.route-link').forEach(l=>l.classList.toggle('active', l.dataset.route===route));
    render();
    window.scrollTo({ top:0, behavior:'instant' });
  }

  function render() {
    let html = '';
    const { route, subRoute, subId } = state;
    if      (route==='library'  && subRoute==='album')  html = viewAlbum(subId);
    else if (route==='library')                         html = viewLibrary();
    else if (route==='artists'  && subRoute==='artist') html = viewArtist(subId);
    else if (route==='artists')                         html = viewArtists();
    else if (route==='contribute')                      html = viewContribute();
    else if (route==='contributors')                    html = viewContributors();
    else if (route==='about')                           html = viewAbout();
    else                                                html = viewLibrary();
    app.innerHTML = html;
    bind();
  }

  // ── Event binding ─────────────────────────────────────────
  function bind() {
    // Album cards
    app.querySelectorAll('.album-card').forEach(card=>{
      card.addEventListener('click', e=>{
        if (e.target.closest('.dl-btn')) return;
        const id = card.dataset.albumId;
        if (id) navigate(state.route==='artists'?'artists':'library','album',id);
      });
      card.addEventListener('keydown', e=>{ if(e.key==='Enter') card.click(); });
    });
    // data-nav buttons
    app.querySelectorAll('[data-nav]').forEach(el=>{
      el.addEventListener('click', ()=>{
        const nav=el.dataset.nav, aid=el.dataset.artistId;
        if(nav==='artist'&&aid) navigate('artists','artist',aid);
        else if(nav==='library') navigate('library');
        else if(nav==='artists') navigate('artists');
      });
    });
    // Artist rows
    app.querySelectorAll('.artist-row').forEach(row=>{
      row.addEventListener('click', ()=>navigate('artists','artist',row.dataset.artistId));
      row.addEventListener('keydown', e=>{ if(e.key==='Enter') row.click(); });
    });
    // Download no-ops
    app.querySelectorAll('[data-dl],[data-dl-album]').forEach(btn=>{
      btn.addEventListener('click', e=>{ e.stopPropagation(); toast('Download started','↓'); });
    });
    // Track row → play
    app.querySelectorAll('[data-play]').forEach(row=>{
      row.addEventListener('click', e=>{
        if(e.target.closest('[data-dl]')) return;
        playFrom(row.dataset.play, parseInt(row.dataset.ti));
      });
    });
    // Filters
    app.querySelectorAll('[data-ff]').forEach(el=>{ el.addEventListener('click', ()=>{ state.filters.format=el.dataset.ff||null; render(); }); });
    app.querySelectorAll('[data-fg]').forEach(el=>{ el.addEventListener('click', ()=>{ state.filters.genre=state.filters.genre===el.dataset.fg?null:el.dataset.fg; render(); }); });
    app.querySelectorAll('[data-fd]').forEach(el=>{ el.addEventListener('click', ()=>{ state.filters.decade=state.filters.decade===el.dataset.fd?null:el.dataset.fd; render(); }); });
    // Sort
    app.querySelectorAll('.sort-pill').forEach(pill=>{ pill.addEventListener('click', ()=>{ const s=['recent','alpha','year']; state.sort=s[(s.indexOf(state.sort)+1)%3]; render(); }); });
    bindNP();
    // Contribute form
    const audioZone=app.querySelector('#audioZone'), audioInput=app.querySelector('#audioInput');
    const artZone=app.querySelector('#artZone'),     artInput=app.querySelector('#artInput');
    const submitBtn=app.querySelector('#submitBtn');
    if(audioZone){ audioZone.addEventListener('click',()=>audioInput.click()); dropZone(audioZone,audioInput,handleAudioFiles); }
    if(artZone)  { artZone.addEventListener('click',()=>artInput.click()); dropZone(artZone,artInput,files=>{ const f=files[0]; if(!f) return; const ext='.'+f.name.split('.').pop().toLowerCase(); ['.jpg','.jpeg','.png'].includes(ext)?toast(`Cover art: ${f.name}`,'花'):toast('Cover art must be JPG or PNG','波'); }); }
    if(submitBtn){
      const check=()=>{ submitBtn.disabled=!(['#f-artist','#f-album','#f-year','#f-genre'].every(s=>app.querySelector(s)?.value?.trim())&&app.querySelector('#f-license')?.checked); };
      ['#f-artist','#f-album','#f-year','#f-genre'].forEach(s=>app.querySelector(s)?.addEventListener('input',check));
      app.querySelector('#f-license')?.addEventListener('change',check);
      submitBtn.addEventListener('click', ()=>{ toast('Submission sent — your music is under review. ありがとう','花'); submitBtn.disabled=true; submitBtn.textContent='Submitted ✓'; });
    }
  }

  function bindNP() {
    const npPlay=app.querySelector('#npPlay'), npPrev=app.querySelector('#npPrev'), npNext=app.querySelector('#npNext');
    if(npPlay) npPlay.addEventListener('click', togglePlay);
    if(npPrev) npPrev.addEventListener('click', prevTrack);
    if(npNext) npNext.addEventListener('click', nextTrack);
    app.querySelectorAll('[data-qi]').forEach(el=>{ el.addEventListener('click', ()=>{ state.player.idx=parseInt(el.dataset.qi); loadTrack(); if(state.player.playing) audio.play().catch(()=>{}); updateBar(); refreshNP(); }); });
  }

  function dropZone(zone, input, handler) {
    zone.addEventListener('dragover', e=>{ e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', ()=>zone.classList.remove('drag'));
    zone.addEventListener('drop', e=>{ e.preventDefault(); zone.classList.remove('drag'); handler(Array.from(e.dataTransfer.files)); });
    input.addEventListener('change', ()=>handler(Array.from(input.files)));
  }

  function handleAudioFiles(files) {
    const EXTS=['.flac','.mp3','.m4a','.aac'];
    const panel=app.querySelector('#audioPanel'); if(!panel) return;
    panel.style.display='block';
    let total=0;
    const rows=files.map(f=>{
      const ext='.'+f.name.split('.').pop().toLowerCase();
      const mb=f.size/(1024*1024); total+=mb;
      if(!EXTS.includes(ext)) return vrow('err','ti-x',f.name,'unsupported format');
      if(mb>100)              return vrow('err','ti-x',f.name,'exceeds 100 MB limit');
      return vrow('ok','ti-check',f.name,`${mb.toFixed(1)} MB · ${ext.slice(1).toUpperCase()}`);
    });
    if(total>500) rows.push(vrow('err','ti-alert-triangle',`Total: ${total.toFixed(0)} MB`,'exceeds 500 MB limit'));
    panel.innerHTML=rows.join('');
  }
  function vrow(cls,icon,name,status) { return `<div class="val-row val-${cls}"><i class="ti ${icon}" aria-hidden="true"></i><span class="vr-name">${name}</span><span class="vr-status">${status}</span></div>`; }

  // ── Audio / player ────────────────────────────────────────
  function playFrom(albumId, trackIdx) {
    const album=CATALOGUE.allAlbums.find(a=>a.id===albumId); if(!album) return;
    const artist=CATALOGUE.artists.find(a=>a.id===album.artistId);
    state.player.queue=album.tracks.map((tr,i)=>({ track:tr, albumId, album, artist:artist.name, trackIdx:i }));
    state.player.idx=trackIdx;
    loadTrack(); state.player.playing=true;
    updateBar(); updatePlayState(); refreshNP();
    if(state.subRoute==='album') render();
  }

  function loadTrack() {
    const item=state.player.queue[state.player.idx]; if(!item) return;
    state.player.currentTime=0;
    state.player.duration=item.track.duration_sec||0;
    if(item.track.path) {
      try { audio.src=encodeURI(item.track.path); } catch(_){}
      if(state.player.playing) audio.play().catch(()=>{});
    }
    updateBar();
  }

  function togglePlay() {
    state.player.playing=!state.player.playing;
    updatePlayState();
    if(state.player.playing) {
      const item=state.player.queue[state.player.idx];
      if(item&&item.track.path&&!audio.src) { try{audio.src=encodeURI(item.track.path);}catch(_){} }
      audio.play().catch(()=>{});
    } else {
      audio.pause();
    }
    refreshNP();
  }

  function prevTrack() {
    const p=state.player;
    if(p.idx>0){ p.idx--; loadTrack(); if(p.playing) audio.play().catch(()=>{}); updateBar(); refreshNP(); }
  }
  function nextTrack() {
    const p=state.player;
    if(p.idx<p.queue.length-1){ p.idx++; loadTrack(); if(p.playing) audio.play().catch(()=>{}); updateBar(); refreshNP(); }
    else { p.playing=false; audio.pause(); updatePlayState(); }
  }

  // Real <audio> events drive progress and state
  audio.addEventListener('timeupdate', ()=>{
    state.player.currentTime=audio.currentTime||0;
    if(audio.duration&&isFinite(audio.duration)) state.player.duration=audio.duration;
    updateProgress();
  });
  audio.addEventListener('loadedmetadata', ()=>{
    if(audio.duration&&isFinite(audio.duration)){
      state.player.duration=audio.duration;
      if(pbTotal) pbTotal.textContent=fmt(audio.duration);
      updateBar();
    }
  });
  audio.addEventListener('ended', ()=>nextTrack());
  audio.addEventListener('play',  ()=>{ state.player.playing=true;  updatePlayState(); refreshNP(); });
  audio.addEventListener('pause', ()=>{ state.player.playing=false; updatePlayState(); refreshNP(); });

  function updateProgress() {
    const p=state.player;
    const pct=p.duration>0?(p.currentTime/p.duration*100).toFixed(1):0;
    if(pbBarFill) pbBarFill.style.width=pct+'%';
    if(pbCurrent) pbCurrent.textContent=fmt(p.currentTime);
    const npFill=app.querySelector('#npFill'), npCur=app.querySelector('#npCur');
    if(npFill) npFill.style.width=pct+'%';
    if(npCur)  npCur.textContent=fmt(p.currentTime);
  }

  function updateBar() {
    const p=state.player; const item=p.queue[p.idx]; if(!item) return;
    const ki=albumIdx(item.album)%6;
    if(pbArt)    { pbArt.className=`pb-art ${kClass(ki)}`; pbArt.textContent=kChar(ki); }
    if(pbTitle)  pbTitle.textContent=item.track.title;
    if(pbArtist) pbArtist.textContent=`${item.artist} — ${item.album.title}`;
    if(pbTotal)  pbTotal.textContent=fmt(p.duration);
    if(pbCurrent) pbCurrent.textContent=fmt(p.currentTime);
    if(pbFmt)  { pbFmt.textContent=fmtLbl(item.track.format); pbFmt.className='pb-fmt-badge'; }
  }

  function updatePlayState() {
    if(!pbPlayIcon) return;
    pbPlayIcon.className=`ti ${state.player.playing?'ti-player-pause':'ti-player-play'}`;
    pbPlay.setAttribute('aria-label', state.player.playing?'Pause':'Play');
  }

  function refreshNP() {
    const sidebar=app.querySelector('#npSidebar');
    if(sidebar) { sidebar.innerHTML=viewNowPlaying(); bindNP(); }
  }

  // ── Player bar wiring ─────────────────────────────────────
  pbPlay.addEventListener('click', togglePlay);
  pbPrev.addEventListener('click', prevTrack);
  pbNext.addEventListener('click', nextTrack);
  pbBar.addEventListener('click', e=>{
    const r=pbBar.getBoundingClientRect();
    const t=Math.floor((e.clientX-r.left)/r.width*state.player.duration);
    state.player.currentTime=t;
    if(audio.src&&isFinite(audio.duration)) { try{audio.currentTime=t;}catch(_){} }
    updateProgress();
  });
  pbVolBar.addEventListener('click', e=>{
    const r=pbVolBar.getBoundingClientRect();
    const v=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
    state.player.volume=v; pbVolFill.style.width=(v*100)+'%'; audio.volume=v;
  });
  pbVolIcon.addEventListener('click', ()=>{
    if(audio.volume>0){ audio._prev=audio.volume; audio.volume=0; state.player.volume=0; pbVolFill.style.width='0%'; }
    else { const v=audio._prev||0.7; audio.volume=v; state.player.volume=v; pbVolFill.style.width=(v*100)+'%'; }
  });
  pbDl.addEventListener('click', ()=>{ if(state.player.queue.length) toast('Track download started','↓'); });

  // ── Nav ───────────────────────────────────────────────────
  document.querySelectorAll('.route-link').forEach(link=>{
    link.addEventListener('click', e=>{ e.preventDefault(); navigate(link.dataset.route); });
  });
  document.querySelector('.nav-logo')?.addEventListener('click', e=>{ e.preventDefault(); navigate('library'); });
  searchInput.addEventListener('input', ()=>{
    state.search=searchInput.value;
    if(state.route==='library'&&!state.subRoute) render();
  });

  // ── Keyboard shortcuts ────────────────────────────────────
  document.addEventListener('keydown', e=>{
    if(document.activeElement===searchInput) return;
    if(e.key===' ')        { e.preventDefault(); togglePlay(); }
    if(e.key==='ArrowLeft'  && e.altKey) { e.preventDefault(); prevTrack(); }
    if(e.key==='ArrowRight' && e.altKey) { e.preventDefault(); nextTrack(); }
    if(e.key==='m'||e.key==='M') pbVolIcon.click();
    if(e.key==='/') { e.preventDefault(); searchInput.focus(); }
  });

  // ── Dark mode ─────────────────────────────────────────────
  const darkMQ=window.matchMedia('(prefers-color-scheme: dark)');
  function applyDark(dark) { document.documentElement.classList.toggle('dark', dark); }
  applyDark(darkMQ.matches);
  darkMQ.addEventListener('change', e=>applyDark(e.matches));

  // ── Init ──────────────────────────────────────────────────
  songBadge.textContent=`${CATALOGUE.totalSongs} songs`;
  pbVolFill.style.width=(state.player.volume*100)+'%';
  navigate('library');

})();
