// ────────────────────────────────────────────────────────────
//  NEIRO 音色 — application logic
// ────────────────────────────────────────────────────────────
(async function () {
  'use strict';

  await window.HIBIKI_CATALOGUE_PROMISE;

  // ── State ─────────────────────────────────────────────────
  const state = {
    route: 'library', subRoute: null, subId: null,
    filters: { format: null, genre: null, decade: null },
    sort: 'recent', search: '',
    player: {
      queue: [], idx: 0, playing: false,
      currentTime: 0, duration: 0, volume: 0.7,
      shuffle: false,
      repeat: 'off', // 'off' | 'all' | 'one'
    },
  };

  const audio = new Audio();
  audio.volume = state.player.volume;

  // ── DOM refs ──────────────────────────────────────────────
  const app         = document.getElementById('app');
  const pbTitle     = document.getElementById('pbTitle');
  const pbArtist    = document.getElementById('pbArtist');
  const pbArt       = document.getElementById('pbArt');
  const pbPlay      = document.getElementById('pbPlay');
  const pbPlayIcon  = document.getElementById('pbPlayIcon');
  const pbPrev      = document.getElementById('pbPrev');
  const pbNext      = document.getElementById('pbNext');
  const pbCurrent   = document.getElementById('pbCurrent');
  const pbTotal     = document.getElementById('pbTotal');
  const pbBarFill   = document.getElementById('pbBarFill');
  const pbBar       = document.getElementById('pbBar');
  const pbFmt       = document.getElementById('pbFmt');
  const pbDl        = document.getElementById('pbDl');
  const pbVolFill   = document.getElementById('pbVolFill');
  const pbVolBar    = document.getElementById('pbVolBar');
  const pbVolIcon   = document.getElementById('pbVolIcon');
  const pbShuffle   = document.getElementById('pbShuffle');
  const pbRepeat    = document.getElementById('pbRepeat');
  const songBadge   = document.getElementById('songCountBadge');
  const searchInput = document.getElementById('searchInput');
  const toastRegion = document.getElementById('toastRegion');

  // ── Utilities ─────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
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

  function toast(msg, k = '音色') {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span class="tk">${esc(k)}</span>${esc(msg)}`;
    toastRegion.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }
  // Sticky toast variant — caller controls dismiss / updates.
  function toastSticky(msg, k = '音色') {
    const t = document.createElement('div');
    t.className = 'toast toast-sticky';
    t.innerHTML = `<span class="tk">${esc(k)}</span><span class="t-msg">${esc(msg)}</span>`;
    toastRegion.appendChild(t);
    return t;
  }
  function updateToast(el, msg) {
    const m = el?.querySelector('.t-msg'); if (m) m.textContent = msg;
  }
  function dismissToast(el) { if (!el) return; el.style.animation = 'toastOut 0.25s ease-in forwards'; setTimeout(() => el.remove(), 250); }

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
        if (!a.year || Math.floor(a.year / 10) * 10 !== parseInt(state.filters.decade)) return false;
      }
      return true;
    });
    if (state.sort === 'alpha') list = [...list].sort((a,b) => a.title.localeCompare(b.title));
    else if (state.sort === 'year') list = [...list].sort((a,b) => b.year - a.year);
    return list;
  }
  function countFmt(f)    { return CATALOGUE.allAlbums.filter(a=>a.fmt===f).reduce((s,a)=>s+a.tracks.length,0); }
  function countGenre(g)  { const gl=g.toLowerCase(); return CATALOGUE.allAlbums.filter(a=>a.genre.toLowerCase().includes(gl)).reduce((s,a)=>s+a.tracks.length,0); }
  function countDecade(d) { const di=parseInt(d); return CATALOGUE.allAlbums.filter(a=>Math.floor(a.year/10)*10===di).reduce((s,a)=>s+a.tracks.length,0); }

  function activeFilterCount() {
    return [state.filters.format, state.filters.genre, state.filters.decade].filter(Boolean).length;
  }

  // ── Card HTML ─────────────────────────────────────────────
  function cardHTML(album, i) {
    const ki = i % 6;
    const dlLabel = album.shards.length > 1 ? `↓ ${album.shards.length} parts` : '↓ ZIP';
    return `
<article class="album-card" role="listitem" tabindex="0"
  data-album-id="${album.id}"
  aria-label="${esc(album.title)} by ${esc(album.artist)}">
  <div class="art-wrap ${kClass(ki)}" aria-hidden="true">
    ${album.cover ? `<img src="${album.cover}" alt="" loading="lazy">` : kChar(ki)}
    <span class="fmt-badge ${fmtCls(album.fmt)}">${fmtLbl(album.fmt)}</span>
  </div>
  <div class="card-body">
    <div class="card-title">${esc(album.title)}</div>
    <div class="card-artist">${esc(album.artist)}</div>
    <div class="card-footer">
      <div class="card-meta">${album.tracks.length} tracks<br>${fmtMB(album.totalSize)}</div>
      <button class="dl-btn" data-dl-album="${album.id}" aria-label="Download ${esc(album.title)}">${dlLabel}</button>
    </div>
  </div>
</article>`;
  }

  // ── Sidebar filter HTML (shared between desktop sidebar and mobile sheet) ─
  function filterHTML() {
    const GENRES  = [...new Set(CATALOGUE.allAlbums.map(a=>a.genre))].sort();
    const DECADES = [...new Set(CATALOGUE.allAlbums.map(a=>a.year&&Math.floor(a.year/10)*10).filter(Boolean))].sort((a,b)=>b-a);
    return `
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
  <div class="filter-item${state.filters.genre===g?' active':''}" tabindex="0" role="button" data-fg="${esc(g)}">
    <span>${esc(g)}</span><span class="filter-count">${countGenre(g)}</span>
  </div>`).join('')}
</div>
<div class="filter-group">
  <span class="filter-label">Decade</span>
  ${DECADES.map(d=>`
  <div class="filter-item${state.filters.decade===String(d)?' active':''}" tabindex="0" role="button" data-fd="${d}">
    <span>${d}s</span><span class="filter-count">${countDecade(d)}</span>
  </div>`).join('')}
</div>
<div class="watermark" aria-hidden="true">音色</div>`;
  }

  // ── View: Library ─────────────────────────────────────────
  function viewLibrary() {
    const albums = filteredAlbums();
    const sortLabels = { recent:'recently added ↓', alpha:'alphabetical ↑', year:'year ↓' };
    const fc = activeFilterCount();
    return `
<div class="layout">
  <aside class="sidebar-left" aria-label="Filters">
    ${filterHTML()}
  </aside>

  <main class="main" role="main">
    <div class="main-header">
      <h1 class="main-title">All albums <small>${albums.length} results</small></h1>
      <div class="main-header-actions">
        <button class="mobile-filter-btn${fc?' has-filter':''}" id="mobileFilterBtn" aria-label="Open filters">
          <i class="ti ti-adjustments-horizontal" aria-hidden="true"></i>
          Filters
          <span class="mfb-badge">${fc||''}</span>
        </button>
        <button class="surprise-btn" id="surpriseBtn" aria-label="Random album">
          <i class="ti ti-arrows-shuffle" aria-hidden="true"></i>
          Surprise me
        </button>
        <span class="sort-control">sorted by — <span class="sort-pill">${sortLabels[state.sort]}</span></span>
      </div>
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
  <div class="np-art ${kClass(ki)}" aria-hidden="true">${item?.album?.cover ? `<img src="${item.album.cover}" alt="">` : kChar(ki)}</div>
  <div class="np-title">${item ? esc(item.track.title) : '—'}</div>
  <div class="np-artist">${item ? esc(item.artist) : 'No track selected'}</div>
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
      <div class="queue-title">${esc(it.track.title)}</div>
      <div class="queue-artist">${esc(it.artist)}</div>
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
    const cover = album.coverUrl || album.cover;
    return `
<div class="album-page">
  ${cover ? `<div class="album-backdrop" aria-hidden="true" style="background-image:url(${esc(cover)})"></div>` : ''}
  <button class="album-back" data-nav="library"><i class="ti ti-arrow-left"></i> Back to library</button>
  <div class="album-hero">
    <div class="album-hero-art ${kClass(ki)} art-wrap" aria-hidden="true">
      ${cover ? `<img src="${cover}" alt="">` : kChar(ki)}
    </div>
    <div class="album-hero-info">
      ${(() => {
        const g = album.genre && album.genre !== 'Unknown' ? esc(album.genre) : '';
        const y = album.year ? String(album.year) : '';
        // Suggest-a-genre link: prefilled GitHub issue using the classify-genre template.
        const ghParams = new URLSearchParams({
          template: 'classify-genre.yml',
          title: `classify: ${album.artist} — ${album.title}`,
          'album-id': album.id,
          'current-genre': album.genre || 'Unknown',
        });
        const suggestUrl = `https://github.com/SarangVehale/hibiki/issues/new?${ghParams.toString()}`;
        const suggestLink = `<a class="hero-genre-suggest" href="${suggestUrl}" target="_blank" rel="noopener noreferrer" title="Suggest a different genre">${g || y ? '· edit' : 'Suggest genre'}</a>`;
        if (!g && !y) return `<div class="hero-genre-tag">${suggestLink}</div>`;
        const sep = g && y ? '<span class="sep"> · </span>' : '';
        return `<div class="hero-genre-tag">${g}${sep}${y} ${suggestLink}</div>`;
      })()}
      <h1 class="hero-album-title">${esc(album.title)}</h1>
      <div class="hero-artist-name" data-nav="artist" data-artist-id="${album.artistId}">${esc(album.artist)}</div>
      <div class="hero-actions">
        <button class="hero-action-btn hero-play-btn" data-play-album="${album.id}" aria-label="Play album">
          <i class="ti ti-player-play" aria-hidden="true"></i> Play
        </button>
        <button class="hero-action-btn" data-share-hash="${hashFor('library','album',album.id)}" aria-label="Copy share link">
          <i class="ti ti-link" aria-hidden="true"></i> Share
        </button>
      </div>
      <div class="hero-stats">
        <div class="hero-stat"><strong>${album.tracks.length}</strong>Tracks</div>
        <div class="hero-stat"><strong>${fmtMB(album.totalSize)}</strong>Total size</div>
        <div class="hero-stat"><strong>${fmtLbl(album.fmt)}</strong>Format</div>
        <div class="hero-stat"><strong>${fmtFull(album.totalDuration)}</strong>Duration</div>
      </div>
      ${album.notes ? `<p class="hero-notes">${esc(album.notes)}</p>` : ''}
    </div>
  </div>
  <div class="download-bar">
    <span class="dl-label">↓ Download album</span>
    ${album.shards.map((s,si)=>`<button class="dl-part-btn" data-dl-shard="${album.id}" data-shard-idx="${si}">${esc(s.label)} · ${fmtMB(s.size_mb)}</button>`).join('')}
    <span class="dl-total">${fmtMB(album.totalSize)} total · iPod-ready ZIPs</span>
  </div>
  <div class="tracklist-wrap">
    <table class="tracklist" aria-label="Track listing for ${esc(album.title)}">
      <thead><tr>
        <th scope="col">#</th><th scope="col">Title</th><th scope="col">Duration</th>
        <th scope="col">Format</th><th scope="col">Size</th>
        <th scope="col"><span class="sr-only">Actions</span></th>
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
  <td class="td-title">${esc(tr.title)}</td>
  <td class="td-dur">${fmt(tr.duration_sec)}</td>
  <td class="td-fmt"><span class="fmt-pill ${fmtCls(tr.format)}">${fmtLbl(tr.format)}</span></td>
  <td class="td-size">${tr.size_mb.toFixed(1)} MB</td>
  <td class="td-actions">
    <button class="track-action" data-queue-add="${id}" data-track-idx="${i}" title="Add to queue" aria-label="Add to queue"><i class="ti ti-playlist-add" aria-hidden="true"></i></button>
    <button class="track-action" data-queue-next="${id}" data-track-idx="${i}" title="Play next" aria-label="Play next"><i class="ti ti-corner-down-right" aria-hidden="true"></i></button>
    <button class="track-dl" data-dl-track="${id}" data-track-idx="${i}" aria-label="Download ${esc(tr.title)}">↓</button>
  </td>
</tr>`;}).join('')}
      </tbody>
    </table>
  </div>
  ${(()=>{
    const artist = CATALOGUE.artists.find(a=>a.id===album.artistId);
    const others = artist?.albums.filter(a=>a.id!==id).slice(0,4);
    return others?.length ? `
<div class="related-block">
  <h2 class="main-title" style="margin-bottom:16px">More by ${esc(artist.name)}</h2>
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
  <div class="ar-name">${esc(ar.name)} <small>${esc(ar.kana)}</small></div>
  <div class="ar-stats">${ar.albums.length} albums · ${tracks} tracks · ${fmtMB(size)}</div>
  <div class="ar-genre">${esc(ar.genre)}</div>
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
      <div class="artist-kana">${esc(artist.kana)}</div>
      <h1 class="artist-name">${esc(artist.name)}</h1>
      ${artist.bio ? `<p class="artist-bio">${esc(artist.bio)}</p>` : ''}
    </div>
    <div class="artist-meta-block">
      <div class="artist-meta-row"><span class="k">Albums</span><span class="v">${artist.albums.length}</span></div>
      <div class="artist-meta-row"><span class="k">Tracks</span><span class="v">${tracks}</span></div>
      <div class="artist-meta-row"><span class="k">Total size</span><span class="v">${fmtMB(size)}</span></div>
      <div class="artist-meta-row"><span class="k">Origin</span><span class="v">${esc(artist.origin)}</span></div>
      <div class="artist-meta-row"><span class="k">Genre</span><span class="v">${esc(artist.genre)}</span></div>
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
  <p class="page-sub">Three ways to add an album. Pick the path that fits you.</p>

  <div class="contrib-paths">
    <div class="contrib-path">
      <div class="contrib-path-num">01</div>
      <div class="contrib-path-title">Fastest — open an issue</div>
      <div class="contrib-path-desc">Tell the maintainer what you'd like to add. Use the form below; we'll pre-fill a GitHub issue with your metadata. Best if you're new to GitHub.</div>
    </div>
    <div class="contrib-path">
      <div class="contrib-path-num">02</div>
      <div class="contrib-path-title">Direct — edit on GitHub</div>
      <div class="contrib-path-desc">Already on GitHub? You don't need git installed — press <code>.</code> on the <a href="https://github.com/SarangVehale/hibiki" target="_blank" rel="noopener noreferrer">repo page</a> to open <strong>github.dev</strong>, drop your files into <code>music/&lt;Artist&gt;/&lt;Album&gt;/</code> with a <code>meta.yaml</code>, and commit. CI validates and the maintainer merges.</div>
      <a class="contrib-cta" href="https://github.dev/SarangVehale/hibiki" target="_blank" rel="noopener noreferrer"><i class="ti ti-edit" aria-hidden="true"></i> Open in github.dev</a>
    </div>
    <div class="contrib-path">
      <div class="contrib-path-num">03</div>
      <div class="contrib-path-title">Quiet — email</div>
      <div class="contrib-path-desc">No GitHub account at all? Email a link to the files (Dropbox / Drive / Wetransfer) plus a one-line licence statement. The maintainer adds it for you within a few days.</div>
      <a class="contrib-cta" href="mailto:sarang.kernel@gmail.com?subject=NEIRO%20%E2%80%94%20album%20submission&body=Hi%2C%0A%0AI'd%20like%20to%20contribute%20this%20album%20to%20NEIRO.%0A%0A--%20Album%20details%20--%0AArtist%3A%20%0AAlbum%3A%20%0AYear%3A%20%0AGenre%3A%20%0A%0A--%20Files%20--%0ALink%20to%20audio%20(Drive%2FDropbox%2FWeTransfer)%3A%20%0ALink%20to%20cover%20art%20(optional)%3A%20%0A%0A--%20Licence%20--%0AI%20confirm%20I%20own%20or%20have%20permission%20to%20share%20this%20material%2C%20and%20it%20may%20be%20published%20under%20the%20licence%20I%20specify%20here%3A%20%0A%0AThanks!%0A"><i class="ti ti-mail" aria-hidden="true"></i> Compose email</a>
    </div>
  </div>

  <div class="contrib-form-intro">
    <span class="form-section-label">— Path 01 form —</span>
    <p class="contrib-form-note">Filling this out opens a prefilled GitHub issue. The audio files themselves are uploaded once the maintainer responds (a static site can't accept large file uploads directly).</p>
  </div>
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
        <td><span class="contrib-handle">${esc(x.handle)}</span></td>
        <td class="contrib-num">${x.albums}</td>
        <td class="contrib-num">${x.songs}</td>
        <td class="contrib-date">${esc(x.first)}</td>
        <td class="contrib-date">${esc(x.latest)}</td>
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
    <h2>What is NEIRO?</h2>
    <p>NEIRO (音色) is a free, public music archive — a zero-infrastructure static site over a GitHub repository. No backend, no database, no tracking.</p>
    <p>音色 means "timbre" in Japanese — the colour of a sound. Browse, preview, and download freely. Contribute your own music via a pull request.</p>
  </div>
  <div class="about-block">
    <h2>Technical stack <small>How it works</small></h2>
    <table class="tech-table">
      <tr><td>Hosting</td><td>GitHub Pages — free static hosting</td></tr>
      <tr><td>Build &amp; CI</td><td>GitHub Actions — free for public repos</td></tr>
      <tr><td>Large files</td><td>Cloudflare R2 — audio served via CDN, zero egress cost</td></tr>
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
      <tr><td>S</td><td>Toggle shuffle</td></tr>
      <tr><td>R</td><td>Cycle repeat mode</td></tr>
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
  // Hash-based deep links: #/library, #/library/album/:id, #/artists/:id, etc.
  // pushState on user nav so the browser back/forward buttons work,
  // popstate on Back/Forward replays the same navigate path.
  function hashFor(route, sub, id) {
    let h = '#/' + (route || 'library');
    if (sub && id) h += '/' + sub + '/' + encodeURIComponent(id);
    return h;
  }
  function parseHash() {
    const raw = (window.location.hash || '').replace(/^#\/?/, '');
    if (!raw) return { route: 'library', sub: null, id: null };
    const parts = raw.split('/');
    return {
      route: parts[0] || 'library',
      sub:   parts[1] || null,
      id:    parts[2] ? decodeURIComponent(parts[2]) : null,
    };
  }
  let _suppressPush = false;
  function navigate(route, sub, id) {
    state.route = route; state.subRoute = sub||null; state.subId = id||null;
    document.querySelectorAll('.route-link').forEach(l=>l.classList.toggle('active', l.dataset.route===route));
    const url = hashFor(route, sub, id);
    if (!_suppressPush && window.location.hash !== url) {
      try { history.pushState({ route, sub, id }, '', url); } catch(_) {}
    }
    render();
    window.scrollTo({ top:0, behavior:'instant' });
  }
  window.addEventListener('popstate', () => {
    const { route, sub, id } = parseHash();
    _suppressPush = true; navigate(route, sub, id); _suppressPush = false;
  });

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
    app.querySelectorAll('.album-card').forEach(card=>{
      card.addEventListener('click', e=>{
        if (e.target.closest('.dl-btn')) return;
        const id = card.dataset.albumId;
        if (id) navigate(state.route==='artists'?'artists':'library','album',id);
      });
      card.addEventListener('keydown', e=>{
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); return; }
        if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)) return;
        const grid = card.closest('.album-grid');
        if (!grid) return;
        const cards = [...grid.querySelectorAll('.album-card')];
        const idx = cards.indexOf(card);
        if (idx < 0) return;
        // Derive column count from the rendered grid template — matches the
        // browser's resolved layout regardless of auto-fill breakpoint.
        const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length || 1;
        let next = idx;
        if (e.key === 'ArrowRight') next = Math.min(idx + 1, cards.length - 1);
        else if (e.key === 'ArrowLeft') next = Math.max(idx - 1, 0);
        else if (e.key === 'ArrowDown') next = Math.min(idx + cols, cards.length - 1);
        else if (e.key === 'ArrowUp') next = Math.max(idx - cols, 0);
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = cards.length - 1;
        if (next !== idx) { e.preventDefault(); cards[next].focus(); }
      });
    });
    app.querySelectorAll('[data-nav]').forEach(el=>{
      el.addEventListener('click', ()=>{
        const nav=el.dataset.nav, aid=el.dataset.artistId;
        if(nav==='artist'&&aid) navigate('artists','artist',aid);
        else if(nav==='library') navigate('library');
        else if(nav==='artists') navigate('artists');
      });
    });
    app.querySelectorAll('.artist-row').forEach(row=>{
      row.addEventListener('click', ()=>navigate('artists','artist',row.dataset.artistId));
      row.addEventListener('keydown', e=>{ if(e.key==='Enter') row.click(); });
    });
    app.querySelectorAll('[data-dl-album],[data-dl-shard],[data-dl-track]').forEach(btn=>{
      btn.addEventListener('click', e=>{
        e.stopPropagation();
        triggerDownload(btn.dataset);
      });
    });
    // Queue / play-next / share / surprise
    app.querySelectorAll('[data-queue-add]').forEach(btn=>{
      btn.addEventListener('click', e=>{ e.stopPropagation(); addToQueue(btn.dataset.queueAdd, parseInt(btn.dataset.trackIdx)); });
    });
    app.querySelectorAll('[data-queue-next]').forEach(btn=>{
      btn.addEventListener('click', e=>{ e.stopPropagation(); playNextTrack(btn.dataset.queueNext, parseInt(btn.dataset.trackIdx)); });
    });
    app.querySelectorAll('[data-share-hash]').forEach(btn=>{
      btn.addEventListener('click', e=>{ e.stopPropagation(); copyShareLink(btn.dataset.shareHash); });
    });
    app.querySelectorAll('[data-play-album]').forEach(btn=>{
      btn.addEventListener('click', e=>{ e.stopPropagation(); playFrom(btn.dataset.playAlbum, 0); });
    });
    const surprise = app.querySelector('#surpriseBtn');
    if (surprise) surprise.addEventListener('click', () => {
      const all = CATALOGUE.allAlbums; if (!all.length) return;
      const a = all[Math.floor(Math.random() * all.length)];
      navigate('library', 'album', a.id);
    });
    app.querySelectorAll('[data-play]').forEach(row=>{
      row.addEventListener('click', e=>{
        if(e.target.closest('[data-dl]')) return;
        playFrom(row.dataset.play, parseInt(row.dataset.ti));
      });
    });
    app.querySelectorAll('[data-ff]').forEach(el=>{ el.addEventListener('click', ()=>{ state.filters.format=el.dataset.ff||null; render(); }); });
    app.querySelectorAll('[data-fg]').forEach(el=>{ el.addEventListener('click', ()=>{ state.filters.genre=state.filters.genre===el.dataset.fg?null:el.dataset.fg; render(); }); });
    app.querySelectorAll('[data-fd]').forEach(el=>{ el.addEventListener('click', ()=>{ state.filters.decade=state.filters.decade===el.dataset.fd?null:el.dataset.fd; render(); }); });
    app.querySelectorAll('.sort-pill').forEach(pill=>{ pill.addEventListener('click', ()=>{ const s=['recent','alpha','year']; state.sort=s[(s.indexOf(state.sort)+1)%3]; render(); }); });
    bindNP();

    // Mobile filter button
    const mfb = app.querySelector('#mobileFilterBtn');
    if (mfb) mfb.addEventListener('click', openFilterSheet);

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
      submitBtn.addEventListener('click', ()=>{
        // Audio file uploads can't be sent directly from a static site.
        // Open a prefilled GitHub issue so the maintainer can coordinate.
        const get=s=>app.querySelector(s)?.value?.trim()||'';
        const params=new URLSearchParams({
          template:'album-submission.yml',
          title:`submission: ${get('#f-artist')} — ${get('#f-album')}`,
          artist:get('#f-artist'),
          album: get('#f-album'),
          year:  get('#f-year'),
          notes: get('#f-notes') ? `${get('#f-notes')}\n\nHandle: ${get('#f-handle')||'anonymous'}` : `Handle: ${get('#f-handle')||'anonymous'}`,
        });
        const url=`https://github.com/SarangVehale/hibiki/issues/new?${params.toString()}`;
        window.open(url,'_blank','noopener,noreferrer');
        toast('Opening GitHub to finish your submission','花');
      });
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
  function vrow(cls,icon,name,status) { return `<div class="val-row val-${cls}"><i class="ti ${icon}" aria-hidden="true"></i><span class="vr-name">${esc(name)}</span><span class="vr-status">${esc(status)}</span></div>`; }

  // ── Real downloads ────────────────────────────────────────
  // Cross-origin <a href download> is silently ignored by browsers, so a
  // direct `download` attribute against media.githubusercontent.com just
  // navigates the tab to the audio. We fetch the response stream, build a
  // same-origin Blob URL, and trigger the download from that — which
  // honors the `download` attribute. Progress is reported via a sticky
  // toast since shards can be 50 MB+.
  async function triggerDownload(ds) {
    let url = null, filename = null;
    if (ds.dlTrack) {
      const album = CATALOGUE.allAlbums.find(a => a.id === ds.dlTrack);
      const tr = album?.tracks[parseInt(ds.trackIdx)];
      if (tr?.path) { url = tr.path; filename = `${album.artist} - ${tr.title}.${tr.format || 'mp3'}`; }
    } else if (ds.dlShard) {
      const album = CATALOGUE.allAlbums.find(a => a.id === ds.dlShard);
      const sh = album?.shards[parseInt(ds.shardIdx)];
      if (sh?.path) { url = sh.path; filename = `${album.artist} - ${album.title} (${sh.label}).zip`; }
    } else if (ds.dlAlbum) {
      const album = CATALOGUE.allAlbums.find(a => a.id === ds.dlAlbum);
      if (album?.shards?.length > 1) {
        navigate(state.route==='artists'?'artists':'library','album',album.id);
        toast('Choose a part to download','↓');
        return;
      }
      const sh = album?.shards[0];
      if (sh?.path) { url = sh.path; filename = `${album.artist} - ${album.title}.zip`; }
    }
    if (!url) { toast('Download not available — file URL missing','⚠'); return; }

    const progress = toastSticky(`Downloading ${filename}…`, '↓');
    let objURL = null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = +res.headers.get('content-length') || 0;
      const totalMB = total ? (total / 1048576).toFixed(1) : '?';

      if (res.body && total) {
        const reader = res.body.getReader();
        const chunks = []; let got = 0; let lastPct = -1;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.length;
          const pct = Math.floor((got / total) * 100);
          if (pct !== lastPct) {
            lastPct = pct;
            updateToast(progress, `${filename} — ${(got/1048576).toFixed(1)} / ${totalMB} MB (${pct}%)`);
          }
        }
        objURL = URL.createObjectURL(new Blob(chunks));
      } else {
        // No body stream / no content-length — fall back to single blob
        objURL = URL.createObjectURL(await res.blob());
      }

      const a = document.createElement('a');
      a.href = objURL; a.download = filename || ''; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();

      dismissToast(progress);
      toast(`Saved — ${filename}`, '✓');
    } catch (e) {
      dismissToast(progress);
      toast(`Download failed — ${e.message}`, '⚠');
    } finally {
      // Browser holds the blob until it actually saves; revoke after a bit
      if (objURL) setTimeout(() => URL.revokeObjectURL(objURL), 60000);
    }
  }

  // ── Queue helpers (F1) ────────────────────────────────────
  // Build a queue-item object from album + track index
  function _qi(album, trackIdx) {
    const artist = CATALOGUE.artists.find(a => a.id === album.artistId);
    return { track: album.tracks[trackIdx], albumId: album.id, album,
      artist: artist?.name || album.artist, trackIdx };
  }
  function addToQueue(albumId, trackIdx) {
    const album = CATALOGUE.allAlbums.find(a => a.id === albumId); if (!album) return;
    state.player.queue.push(_qi(album, trackIdx));
    // If nothing is loaded yet, start playing what was just queued
    if (state.player.queue.length === 1) { state.player.idx = 0; state.player.playing = true; loadTrack(); updateBar(); updatePlayState(); }
    refreshNP();
    toast('Added to queue', '＋');
  }
  function playNextTrack(albumId, trackIdx) {
    const album = CATALOGUE.allAlbums.find(a => a.id === albumId); if (!album) return;
    const item = _qi(album, trackIdx);
    if (!state.player.queue.length) { state.player.queue = [item]; state.player.idx = 0; state.player.playing = true; loadTrack(); updateBar(); updatePlayState(); }
    else state.player.queue.splice(state.player.idx + 1, 0, item);
    refreshNP();
    toast('Playing next', '↦');
  }

  // ── Share helper (F4) ─────────────────────────────────────
  async function copyShareLink(hash) {
    const url = window.location.origin + window.location.pathname + (hash || window.location.hash || '');
    try { await navigator.clipboard.writeText(url); toast('Link copied', '⧉'); }
    catch (_) {
      // Older browsers / insecure contexts: fall back to a temporary input
      const ta = document.createElement('textarea'); ta.value = url;
      ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta);
      ta.select(); try { document.execCommand('copy'); toast('Link copied', '⧉'); }
      catch { toast(url, '⧉'); } ta.remove();
    }
  }

  // ── Continue listening (F3) ───────────────────────────────
  const RESUME_KEY = 'neiro-resume';
  function saveSession() {
    const p = state.player; const it = p.queue[p.idx]; if (!it) return;
    try { localStorage.setItem(RESUME_KEY, JSON.stringify({
      albumId: it.albumId, trackIdx: it.trackIdx, t: Math.floor(p.currentTime||0), ts: Date.now()
    })); } catch(_) {}
  }
  function loadSession() {
    try { const raw = localStorage.getItem(RESUME_KEY); if (!raw) return null;
      const s = JSON.parse(raw);
      // Drop sessions older than 30 days
      if (Date.now() - (s.ts||0) > 30 * 86400 * 1000) return null;
      return s;
    } catch(_) { return null; }
  }
  // Throttle saves: every 5 seconds while playing
  let _lastSave = 0;
  function _maybeSave() { const now = Date.now(); if (now - _lastSave > 5000) { _lastSave = now; saveSession(); } }

  // ── Mobile filter sheet ───────────────────────────────────
  const filterSheet = document.getElementById('filterSheet');
  const filterSheetBackdrop = document.getElementById('filterSheetBackdrop');
  const filterSheetBody = document.getElementById('filterSheetBody');
  const filterSheetClose = document.getElementById('filterSheetClose');

  function openFilterSheet() {
    filterSheetBody.innerHTML = filterHTML();
    filterSheet.classList.add('open');
    filterSheet.setAttribute('aria-hidden','false');
    // Bind filter interactions inside the sheet
    filterSheetBody.querySelectorAll('[data-ff]').forEach(el=>{ el.addEventListener('click', ()=>{ state.filters.format=el.dataset.ff||null; closeFilterSheet(); render(); }); });
    filterSheetBody.querySelectorAll('[data-fg]').forEach(el=>{ el.addEventListener('click', ()=>{ state.filters.genre=state.filters.genre===el.dataset.fg?null:el.dataset.fg; closeFilterSheet(); render(); }); });
    filterSheetBody.querySelectorAll('[data-fd]').forEach(el=>{ el.addEventListener('click', ()=>{ state.filters.decade=state.filters.decade===el.dataset.fd?null:el.dataset.fd; closeFilterSheet(); render(); }); });
  }
  function closeFilterSheet() {
    filterSheet.classList.remove('open');
    filterSheet.setAttribute('aria-hidden','true');
  }
  if (filterSheetClose) filterSheetClose.addEventListener('click', closeFilterSheet);
  if (filterSheetBackdrop) filterSheetBackdrop.addEventListener('click', closeFilterSheet);

  // ── Shuffle / Repeat ──────────────────────────────────────
  function toggleShuffle() {
    const p = state.player;
    p.shuffle = !p.shuffle;
    if (p.queue.length > 1) {
      const current = p.queue[p.idx];
      if (p.shuffle) {
        // Fisher-Yates, current track stays at front
        const rest = p.queue.filter((_,i) => i !== p.idx);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        p.queue = [current, ...rest];
        p.idx = 0;
      } else {
        // Restore original track order
        p.queue.sort((a, b) => a.trackIdx - b.trackIdx);
        p.idx = p.queue.findIndex(it => it === current);
        if (p.idx < 0) p.idx = 0;
      }
    }
    updateShuffleRepeatUI();
    refreshNP();
  }

  function cycleRepeat() {
    const modes = ['off', 'all', 'one'];
    const i = modes.indexOf(state.player.repeat);
    state.player.repeat = modes[(i + 1) % 3];
    updateShuffleRepeatUI();
  }

  function updateShuffleRepeatUI() {
    const p = state.player;
    // Player bar buttons
    if (pbShuffle) {
      pbShuffle.classList.toggle('active', p.shuffle);
      pbShuffle.setAttribute('aria-label', p.shuffle ? 'Shuffle on' : 'Shuffle off');
    }
    if (pbRepeat) {
      pbRepeat.classList.toggle('active', p.repeat !== 'off');
      pbRepeat.classList.toggle('repeat-one', p.repeat === 'one');
      pbRepeat.setAttribute('aria-label', `Repeat ${p.repeat}`);
      const icon = pbRepeat.querySelector('i');
      if (icon) icon.className = p.repeat === 'one' ? 'ti ti-repeat-once' : 'ti ti-repeat';
    }
    // Full player buttons
    const fpS = document.getElementById('fpShuffle');
    const fpR = document.getElementById('fpRepeat');
    if (fpS) {
      fpS.classList.toggle('active', p.shuffle);
      fpS.setAttribute('aria-label', p.shuffle ? 'Shuffle on' : 'Shuffle off');
    }
    if (fpR) {
      fpR.classList.toggle('active', p.repeat !== 'off');
      fpR.classList.toggle('repeat-one', p.repeat === 'one');
      fpR.setAttribute('aria-label', `Repeat ${p.repeat}`);
      const icon = fpR.querySelector('i');
      if (icon) icon.className = p.repeat === 'one' ? 'ti ti-repeat-once' : 'ti ti-repeat';
    }
  }

  // ── Audio / player ────────────────────────────────────────
  function playFrom(albumId, trackIdx) {
    const album=CATALOGUE.allAlbums.find(a=>a.id===albumId); if(!album) return;
    const artist=CATALOGUE.artists.find(a=>a.id===album.artistId);
    // Build queue; if shuffle is on, shuffle from chosen track
    const allTracks = album.tracks.map((tr,i)=>({ track:tr, albumId, album, artist:artist.name, trackIdx:i }));
    if (state.player.shuffle && allTracks.length > 1) {
      const chosen = allTracks[trackIdx];
      const rest = allTracks.filter((_,i) => i !== trackIdx);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      state.player.queue = [chosen, ...rest];
      state.player.idx = 0;
    } else {
      state.player.queue = allTracks;
      state.player.idx = trackIdx;
    }
    // Order matters: set playing=true FIRST so loadTrack's shouldPlay reads true
    state.player.playing=true;
    loadTrack();
    updateBar(); updatePlayState(); refreshNP(); updateShuffleRepeatUI();
    if(state.subRoute==='album') render();
  }

  // Prevents the 'pause' event emitted by src reassignment from flipping playing=false
  let _loadingTrack = false;

  function loadTrack() {
    const item=state.player.queue[state.player.idx]; if(!item) return;
    state.player.currentTime=0;
    state.player.duration=item.track.duration_sec||0;
    if(item.track.path) {
      const shouldPlay=state.player.playing;
      _loadingTrack=true;
      try { audio.src=item.track.path; } catch(_){}
      _loadingTrack=false;
      if(shouldPlay) audio.play().catch(()=>{});
    }
    updateBar();
  }

  function togglePlay() {
    state.player.playing=!state.player.playing;
    updatePlayState();
    if(state.player.playing) {
      const item=state.player.queue[state.player.idx];
      if(item&&item.track.path&&!audio.src) { try{audio.src=item.track.path;}catch(_){} }
      audio.play().catch(()=>{});
    } else {
      audio.pause();
    }
    refreshNP();
  }

  function prevTrack() {
    const p=state.player;
    // If more than 3s in, restart current track
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      state.player.currentTime = 0;
      updateProgress();
      return;
    }
    if(p.idx>0){ p.idx--; loadTrack(); if(p.playing) audio.play().catch(()=>{}); updateBar(); refreshNP(); }
    else if(p.repeat==='all'){ p.idx=p.queue.length-1; loadTrack(); if(p.playing) audio.play().catch(()=>{}); updateBar(); refreshNP(); }
  }

  function nextTrack() {
    const p=state.player;
    if(p.repeat==='one') {
      audio.currentTime=0; state.player.currentTime=0;
      if(p.playing) audio.play().catch(()=>{});
      updateProgress(); return;
    }
    if(p.idx<p.queue.length-1){ p.idx++; loadTrack(); if(p.playing) audio.play().catch(()=>{}); updateBar(); refreshNP(); }
    else if(p.repeat==='all'){ p.idx=0; loadTrack(); if(p.playing) audio.play().catch(()=>{}); updateBar(); refreshNP(); }
    else { p.playing=false; audio.pause(); updatePlayState(); }
  }

  // Only read audio position; the rAF loop below handles DOM writes
  audio.addEventListener('timeupdate', ()=>{
    state.player.currentTime=audio.currentTime||0;
    if(audio.duration&&isFinite(audio.duration)) state.player.duration=audio.duration;
    _maybeSave();
  });

  // rAF-driven progress paint — batches all DOM writes to one frame
  let _rafId=null;
  function scheduleProgressPaint() {
    if(_rafId) return;
    _rafId=requestAnimationFrame(()=>{ _rafId=null; updateProgress(); });
  }
  audio.addEventListener('timeupdate', scheduleProgressPaint);
  audio.addEventListener('loadedmetadata', ()=>{
    if(audio.duration&&isFinite(audio.duration)){
      state.player.duration=audio.duration;
      if(pbTotal) pbTotal.textContent=fmt(audio.duration);
      updateBar();
    }
    // F3: if a resume position is pending from a saved session, seek to it
    if (state.player._resumeTime != null) {
      try { audio.currentTime = state.player._resumeTime; } catch(_) {}
      state.player._resumeTime = null;
    }
  });
  audio.addEventListener('ended', ()=>nextTrack());
  audio.addEventListener('play',  ()=>{ state.player.playing=true;  updatePlayState(); refreshNP(); });
  audio.addEventListener('pause', ()=>{ if(_loadingTrack) return; state.player.playing=false; updatePlayState(); refreshNP(); });

  let _lastPositionPush = 0;
  function updateProgress() {
    const p=state.player;
    const pct=p.duration>0?(p.currentTime/p.duration*100).toFixed(1):0;
    if(pbBarFill) pbBarFill.style.width=pct+'%';
    if(pbCurrent) pbCurrent.textContent=fmt(p.currentTime);
    if(pbBar) pbBar.setAttribute('aria-valuenow', pct);
    const npFill=app.querySelector('#npFill'), npCur=app.querySelector('#npCur');
    if(npFill) npFill.style.width=pct+'%';
    if(npCur)  npCur.textContent=fmt(p.currentTime);
    const fpFill=document.getElementById('fpScrubFill'), fpC=document.getElementById('fpCur');
    const fpThumb=document.getElementById('fpScrubThumb');
    if(fpFill) fpFill.style.width=pct+'%';
    if(fpC)    fpC.textContent=fmt(p.currentTime);
    if(fpThumb) fpThumb.style.left=pct+'%';
    // M1: push position to MediaSession ~once per second so the OS scrub
    // bar tracks correctly without flooding the API every paint frame.
    const now = Date.now();
    if (now - _lastPositionPush > 1000 && 'mediaSession' in navigator
        && navigator.mediaSession.setPositionState && p.duration > 0) {
      _lastPositionPush = now;
      try {
        navigator.mediaSession.setPositionState({
          duration: p.duration,
          position: Math.min(p.currentTime, p.duration),
          playbackRate: audio.playbackRate || 1,
        });
      } catch(_) {}
    }
  }

  function updateBar() {
    const p=state.player; const item=p.queue[p.idx]; if(!item) return;
    const ki=albumIdx(item.album)%6;
    if(pbArt) {
      pbArt.className=`pb-art ${kClass(ki)}`;
      const c=item.album.cover;
      if(c) {
        pbArt.innerHTML = `<img src="${esc(c)}" alt="" style="width:100%;height:100%;object-fit:cover">`;
        const img = pbArt.querySelector('img');
        if(img) img.addEventListener('error', () => { img.style.display = 'none'; });
      } else {
        pbArt.innerHTML = kChar(ki);
      }
    }
    if(pbTitle)  pbTitle.textContent=item.track.title;
    if(pbArtist) pbArtist.textContent=`${item.artist} — ${item.album.title}`;
    if(pbTotal)  pbTotal.textContent=fmt(p.duration);
    if(pbCurrent) pbCurrent.textContent=fmt(p.currentTime);
    if(pbFmt)  { pbFmt.textContent=fmtLbl(item.track.format); pbFmt.className='pb-fmt-badge'; }
    syncFullPlayer();
    updateMediaSession();
  }

  function updatePlayState() {
    const cls=`ti ${state.player.playing?'ti-player-pause':'ti-player-play'}`;
    if(pbPlayIcon) pbPlayIcon.className=cls;
    if(pbPlay) pbPlay.setAttribute('aria-label', state.player.playing?'Pause':'Play');
    const fpI=document.getElementById('fpPlayIcon');
    if(fpI) fpI.className=cls;
    // M1: mirror state to the OS-level media session
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = state.player.playing ? 'playing' : 'paused';
    }
  }

  // ── M1: Media Session ─────────────────────────────────────
  // Surfaces NEIRO playback on iOS / Android lock screens and routes
  // Bluetooth play/pause/skip events back into the player. Called from
  // updateBar() whenever the track changes; action handlers are set
  // once on first call.
  let _mediaActionsBound = false;
  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const it = state.player.queue[state.player.idx];
    if (!it) { try { navigator.mediaSession.metadata = null; } catch(_) {} return; }
    // Absolute artwork URL so the OS can fetch it independently
    const cover = it.album.coverUrl || it.album.cover || null;
    const artwork = cover ? [{
      src: cover.startsWith('http') || cover.startsWith('data:') ? cover :
           new URL(cover, location.href).toString(),
      sizes: '96x96',
      type: cover.endsWith('.png') ? 'image/png' : 'image/jpeg',
    }] : [];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title:  it.track.title || '',
        artist: it.artist || '',
        album:  it.album.title || '',
        artwork,
      });
    } catch(_) {}
    if (_mediaActionsBound) return;
    _mediaActionsBound = true;
    const safe = (h) => { try { navigator.mediaSession.setActionHandler(h.k, h.fn); } catch(_) {} };
    safe({ k:'play',           fn: () => { if (!state.player.playing) togglePlay(); } });
    safe({ k:'pause',          fn: () => { if (state.player.playing) togglePlay(); } });
    safe({ k:'previoustrack',  fn: prevTrack });
    safe({ k:'nexttrack',      fn: nextTrack });
    safe({ k:'seekto',         fn: (e) => {
      if (!isFinite(e.seekTime)) return;
      try {
        if (e.fastSeek && typeof audio.fastSeek === 'function') audio.fastSeek(e.seekTime);
        else audio.currentTime = e.seekTime;
        state.player.currentTime = e.seekTime;
        updateProgress();
      } catch(_) {}
    } });
    safe({ k:'stop',           fn: () => { audio.pause(); audio.currentTime = 0; } });
  }

  function refreshNP() {
    const sidebar=app.querySelector('#npSidebar');
    if(sidebar) { sidebar.innerHTML=viewNowPlaying(); bindNP(); }
  }

  // ── Player bar wiring ─────────────────────────────────────
  pbPlay.addEventListener('click', togglePlay);
  pbPrev.addEventListener('click', prevTrack);
  pbNext.addEventListener('click', nextTrack);
  if(pbShuffle) pbShuffle.addEventListener('click', toggleShuffle);
  if(pbRepeat)  pbRepeat.addEventListener('click', cycleRepeat);

  // Scrub bar — mouse
  pbBar.addEventListener('click', e=>{
    const r=pbBar.getBoundingClientRect();
    const t=Math.floor((e.clientX-r.left)/r.width*state.player.duration);
    state.player.currentTime=t;
    if(audio.src&&isFinite(audio.duration)) { try{audio.currentTime=t;}catch(_){} }
    updateProgress();
  });

  // Scrub bar — touch
  wireScrubbable(pbBar, ()=>state.player.duration, t=>{
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
  pbDl.addEventListener('click', ()=>{
    const item = state.player.queue[state.player.idx];
    if (!item) return;
    triggerDownload({ dlTrack: item.albumId, trackIdx: String(item.trackIdx) });
  });

  // ── Touch-scrub helper ─────────────────────────────────────
  function wireScrubbable(el, getDuration, onSeek) {
    function posToTime(clientX) {
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * getDuration();
    }
    el.addEventListener('touchstart', e=>{
      e.preventDefault();
      el.classList.add('dragging');
      onSeek(posToTime(e.touches[0].clientX));
    }, { passive: false });
    el.addEventListener('touchmove', e=>{
      e.preventDefault();
      onSeek(posToTime(e.touches[0].clientX));
    }, { passive: false });
    el.addEventListener('touchend', ()=>el.classList.remove('dragging'));
  }

  // ── Nav ───────────────────────────────────────────────────
  document.querySelectorAll('.route-link').forEach(link=>{
    link.addEventListener('click', e=>{ e.preventDefault(); navigate(link.dataset.route); });
  });
  document.querySelector('.nav-logo')?.addEventListener('click', e=>{ e.preventDefault(); navigate('library'); });
  // Debounce search re-render — avoids rebuilding the whole grid per keystroke
  let _searchTimer=null;
  searchInput.addEventListener('input', ()=>{
    state.search=searchInput.value;
    if(state.route!=='library'||state.subRoute) return;
    clearTimeout(_searchTimer);
    _searchTimer=setTimeout(render, 120);
  });

  // ── Keyboard shortcuts ────────────────────────────────────
  document.addEventListener('keydown', e=>{
    if(document.activeElement===searchInput) return;
    if(e.key===' ')        { e.preventDefault(); togglePlay(); }
    if(e.key==='ArrowLeft'  && e.altKey) { e.preventDefault(); prevTrack(); }
    if(e.key==='ArrowRight' && e.altKey) { e.preventDefault(); nextTrack(); }
    if(e.key==='s'||e.key==='S') toggleShuffle();
    if(e.key==='r'||e.key==='R') cycleRepeat();
    if(e.key==='m'||e.key==='M') pbVolIcon.click();
    if(e.key==='/') { e.preventDefault(); searchInput.focus(); }
  });

  // ── Dark mode — light is default; user toggle persisted to localStorage ──
  const themeToggleBtn  = document.getElementById('themeToggle');
  const themeIconEl     = document.getElementById('themeIcon');
  function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    if(themeIconEl) themeIconEl.className = dark ? 'ti ti-sun' : 'ti ti-moon';
    if(themeToggleBtn) themeToggleBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  }
  // Start light; only go dark if user explicitly chose it
  const _storedTheme = localStorage.getItem('neiro-theme');
  applyTheme(_storedTheme === 'dark');
  if(themeToggleBtn) themeToggleBtn.addEventListener('click', ()=>{
    const nowDark = !document.documentElement.classList.contains('dark');
    localStorage.setItem('neiro-theme', nowDark ? 'dark' : 'light');
    applyTheme(nowDark);
  });

  // ── Full-screen player ─────────────────────────────────────
  const fullPlayer   = document.getElementById('fullPlayer');
  const fpDown       = document.getElementById('fpDown');
  const fpArtEl      = document.getElementById('fpArt');
  const fpTitleEl    = document.getElementById('fpTitle');
  const fpAlbumEl    = document.getElementById('fpAlbum');
  const fpArtistEl   = document.getElementById('fpArtist');
  const fpScrubBarEl = document.getElementById('fpScrubBar');
  const fpTotEl      = document.getElementById('fpTot');
  const fpPlayBtn    = document.getElementById('fpPlay');
  const fpPrevBtn    = document.getElementById('fpPrev');
  const fpNextBtn    = document.getElementById('fpNext');
  const fpShuffleBtn = document.getElementById('fpShuffle');
  const fpRepeatBtn  = document.getElementById('fpRepeat');

  function syncFullPlayer() {
    const p=state.player, item=p.queue[p.idx];
    if(!item||!fullPlayer) return;
    const ki=albumIdx(item.album)%6;
    if(fpArtEl) {
      fpArtEl.className=`fp-art-wrap ${kClass(ki)}`;
      const cover=item.album.coverUrl||item.album.cover;
      if(cover) {
        fpArtEl.innerHTML = `<img src="${esc(cover)}" alt="">`;
        const img = fpArtEl.querySelector('img');
        if(img) img.addEventListener('error', () => { img.style.display = 'none'; });
      } else {
        fpArtEl.innerHTML = kChar(ki);
      }
    }
    if(fpTitleEl)  fpTitleEl.textContent=item.track.title;
    if(fpAlbumEl)  fpAlbumEl.textContent=item.album.title;
    if(fpArtistEl) fpArtistEl.textContent=item.artist;
    if(fpTotEl)    fpTotEl.textContent=fmt(p.duration);
    const pct=p.duration>0?(p.currentTime/p.duration*100).toFixed(1):0;
    const fpFill=document.getElementById('fpScrubFill'), fpC=document.getElementById('fpCur');
    const fpThumb=document.getElementById('fpScrubThumb');
    if(fpFill) fpFill.style.width=pct+'%';
    if(fpC)    fpC.textContent=fmt(p.currentTime);
    if(fpThumb) fpThumb.style.left=pct+'%';
    updatePlayState();
    updateShuffleRepeatUI();
  }

  function openFullPlayer() {
    if(!fullPlayer||!state.player.queue.length) return;
    fullPlayer.classList.add('open');
    syncFullPlayer();
  }
  function closeFullPlayer() {
    if(fullPlayer) fullPlayer.classList.remove('open');
  }

  // Open on art / track info click
  if(pbArt)  pbArt.addEventListener('click', openFullPlayer);
  if(pbArt)  pbArt.addEventListener('keydown', e=>{ if(e.key==='Enter') openFullPlayer(); });
  document.querySelector('.pb-track')?.addEventListener('click', openFullPlayer);
  if(fpDown) fpDown.addEventListener('click', closeFullPlayer);

  // Full player controls
  if(fpPlayBtn)   fpPlayBtn.addEventListener('click', ()=>{ togglePlay(); syncFullPlayer(); });
  if(fpPrevBtn)   fpPrevBtn.addEventListener('click', ()=>{ prevTrack(); syncFullPlayer(); });
  if(fpNextBtn)   fpNextBtn.addEventListener('click', ()=>{ nextTrack(); syncFullPlayer(); });
  if(fpShuffleBtn) fpShuffleBtn.addEventListener('click', ()=>{ toggleShuffle(); });
  if(fpRepeatBtn)  fpRepeatBtn.addEventListener('click', ()=>{ cycleRepeat(); });
  const fpShareBtn = document.getElementById('fpShare');
  if(fpShareBtn) fpShareBtn.addEventListener('click', ()=>{
    const it = state.player.queue[state.player.idx];
    copyShareLink(it ? hashFor('library','album',it.albumId) : window.location.hash);
  });

  // Full player scrub — mouse
  if(fpScrubBarEl) fpScrubBarEl.addEventListener('click', e=>{
    const r=fpScrubBarEl.getBoundingClientRect();
    const t=Math.floor((e.clientX-r.left)/r.width*state.player.duration);
    state.player.currentTime=t;
    if(audio.src&&isFinite(audio.duration)){try{audio.currentTime=t;}catch(_){}}
    updateProgress();
  });

  // Full player scrub — touch
  if(fpScrubBarEl) wireScrubbable(fpScrubBarEl, ()=>state.player.duration, t=>{
    state.player.currentTime=t;
    if(audio.src&&isFinite(audio.duration)){try{audio.currentTime=t;}catch(_){}}
    updateProgress();
  });

  // ── Full player swipe gestures ─────────────────────────────
  // Swipe down to close; swipe left/right on art to skip
  if(fullPlayer) {
    let fpTouchY0 = 0, fpTouchX0 = 0;
    fullPlayer.addEventListener('touchstart', e=>{
      fpTouchY0 = e.touches[0].clientY;
      fpTouchX0 = e.touches[0].clientX;
    }, { passive: true });
    fullPlayer.addEventListener('touchend', e=>{
      const dy = e.changedTouches[0].clientY - fpTouchY0;
      const dx = e.changedTouches[0].clientX - fpTouchX0;
      if(Math.abs(dy) > Math.abs(dx) && dy > 80) { closeFullPlayer(); return; }
      // Swipe on art only
      if(e.target.closest('.fp-art-wrap') && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
        if(dx < 0) nextTrack(); else prevTrack();
        syncFullPlayer();
      }
    }, { passive: true });
  }

  // ── Swipe up on player bar to open full player (mobile) ───
  if(pbArt) {
    let pbTouchY0 = 0;
    document.getElementById('playerBar')?.addEventListener('touchstart', e=>{
      pbTouchY0 = e.touches[0].clientY;
    }, { passive: true });
    document.getElementById('playerBar')?.addEventListener('touchend', e=>{
      const dy = e.changedTouches[0].clientY - pbTouchY0;
      if(dy < -40) openFullPlayer();
    }, { passive: true });
  }

  audio.addEventListener('loadedmetadata',()=>{ if(fpTotEl) fpTotEl.textContent=fmt(audio.duration||0); });

  // ── Mobile nav ────────────────────────────────────────────
  const navToggle = document.getElementById('navToggle');
  const mobileNav = document.getElementById('mobileNav');
  if (navToggle && mobileNav) {
    navToggle.addEventListener('click', () => {
      const open = mobileNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
      mobileNav.setAttribute('aria-hidden', String(!open));
    });
    mobileNav.querySelectorAll('.route-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        mobileNav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
        mobileNav.setAttribute('aria-hidden', 'true');
        navigate(link.dataset.route);
      });
    });
  }

  // ── Init ──────────────────────────────────────────────────
  songBadge.textContent=`${CATALOGUE.totalSongs} songs`;
  pbVolFill.style.width=(state.player.volume*100)+'%';
  updateShuffleRepeatUI();

  // F3: Restore previous session into the player bar without autoplaying.
  // Browsers block autoplay without a user gesture and resuming without
  // intent is annoying — user taps play, audio loads, loadedmetadata seeks
  // to the saved position via state.player._resumeTime.
  const _resume = loadSession();
  if (_resume) {
    const _ralbum = CATALOGUE.allAlbums.find(a => a.id === _resume.albumId);
    const _rtr    = _ralbum?.tracks[_resume.trackIdx];
    if (_ralbum && _rtr) {
      state.player.queue = [_qi(_ralbum, _resume.trackIdx)];
      state.player.idx   = 0;
      state.player.currentTime = _resume.t || 0;
      state.player.duration    = _rtr.duration_sec || 0;
      state.player._resumeTime = _resume.t || 0;
      updateBar(); updateProgress();
      toast(`Tap play to resume — ${esc(_rtr.title)}`, '⟲');
    }
  }

  // Boot from URL hash so a direct link / browser back works on first paint
  const _boot = parseHash();
  _suppressPush = true; navigate(_boot.route, _boot.sub, _boot.id); _suppressPush = false;

})();
