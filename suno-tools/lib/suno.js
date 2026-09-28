// Talking to Suno. Everything here works WITHOUT an account, using the same public data suno.com's own pages load:
//   - a song's details:        GET  /api/clip/<id>
//   - a public playlist:       GET  /api/playlist/<id>/?page=N
//   - a creator's public songs: GET /api/profiles/<handle>?page=N
//   - the Explore page lists:  POST /api/discover/  (Trending, Staff Picks, New Songs, genre and mood lists…)
// Searching without an account means searching those Explore lists (a few hundred songs, refreshed every 15 minutes).
//
// OPTIONAL: with a `__client` token from a (throwaway!) Suno account, searches use Suno's own search instead, which
// covers every public song. If the token stops working, it falls back to the Explore lists by itself.
// Either way: public songs only. Unpublished/private songs can't be found or downloaded.
//
// Audio comes from the song's public preview video (cdn1.suno.ai/<id>.mp4 — the same file Discord's own link preview
// uses); ffmpeg takes the sound out of it.

const API = 'https://studio-api.prod.suno.com/api';
const AUTH_HOSTS = ['https://auth.suno.com', 'https://clerk.suno.com'];
const CLERK_VERSION = '5.35.1';
const USER_AGENT = 'Mozilla/5.0 (compatible; DiscordBot; suno-tools)';
const TIMEOUT_MS = 15000;
const POOL_TTL_MS = 15 * 60 * 1000;

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const SONG_RE = new RegExp(`suno\\.(?:com|ai)\\/song\\/(${UUID})`, 'i');
const PLAYLIST_RE = new RegExp(`suno\\.(?:com|ai)\\/playlist\\/(${UUID})`, 'i');
const SHORT_RE = /suno\.(?:com|ai)\/s\/[a-zA-Z0-9]+/i;
const PROFILE_RE = /suno\.(?:com|ai)\/@([a-zA-Z0-9_.-]+)/i;
const ANY_LINK_RE = new RegExp(`https?:\\/\\/(?:www\\.)?(?:suno\\.(?:com|ai)\\/song\\/${UUID}|suno\\.(?:com|ai)\\/playlist\\/${UUID}|suno\\.(?:com|ai)\\/s\\/[a-zA-Z0-9]+|suno\\.(?:com|ai)\\/@[a-zA-Z0-9_.-]+)`, 'i');

async function getJson(url, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`Suno answered HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** A Suno clip → the song shape used everywhere else. Null if it isn't a finished, public song with audio. */
function toSong(clip) {
  if (!clip?.id || clip.status !== 'complete' || clip.is_public === false || clip.is_trashed || clip.is_hidden) return null;
  return {
    id: clip.id,
    url: `https://suno.com/song/${clip.id}`,
    title: String(clip.title || '').trim() || 'Untitled',
    artist: clip.display_name || clip.handle || null,
    handle: clip.handle || null,
    artistIcon: clip.avatar_image_url || null,
    imageUrl: clip.image_large_url || clip.image_url || null,
    audioUrl: clip.video_url || `https://cdn1.suno.ai/${clip.id}.mp4`,
    tags: clip.metadata?.tags || clip.display_tags || null,
    lyrics: clip.metadata?.prompt || null,
    duration: Number(clip.metadata?.duration) || null,
    model: clip.major_model_version || clip.model_name || null,
    plays: Number(clip.play_count) || 0,
    likes: Number(clip.upvote_count) || 0,
  };
}

/** The first Suno link in `text` (song, playlist, short /s/ link or @profile), or null. */
function findSunoLink(text) {
  const m = String(text || '').match(ANY_LINK_RE);
  return m ? m[0].replace(/[),.!?;:'"]+$/, '') : null;
}

/** A short suno.com/s/<code> link → the full page URL it points at. Anything else comes back unchanged. */
async function expandLink(url) {
  if (!SHORT_RE.test(url)) return url;
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return res.url;
}

async function getSong(id) {
  let clip;
  try {
    clip = await getJson(`${API}/clip/${id}`);
  } catch (err) {
    if (err.status === 404 || err.status === 403 || err.status === 401) throw new Error("that Suno song isn't available — it may be private, unpublished or deleted.");
    throw err;
  }
  const song = toSong(clip);
  if (!song) throw new Error("that Suno song isn't public or isn't finished.");
  return song;
}

async function getPlaylist(id, maxSongs = 200) {
  const songs = [];
  let name = null;
  for (let page = 1; page <= 20 && songs.length < maxSongs; page++) {
    let data;
    try {
      data = await getJson(`${API}/playlist/${id}/?page=${page}`);
    } catch (err) {
      if (page === 1) throw new Error("that Suno playlist isn't available — it may be private or deleted.");
      break;
    }
    name ||= data.name;
    const clips = (data.playlist_clips || []).map((e) => e.clip).filter(Boolean);
    if (!clips.length) break;
    songs.push(...clips.map(toSong).filter(Boolean));
    if (songs.length >= (Number(data.num_total_results) || 0)) break;
  }
  if (!songs.length) throw new Error('that Suno playlist has no public songs.');
  return { name: name || 'Suno playlist', songs: songs.slice(0, maxSongs) };
}

async function getProfileSongs(handle, pages = 2) {
  const songs = [];
  let name = handle;
  for (let page = 1; page <= pages; page++) {
    let data;
    try {
      data = await getJson(`${API}/profiles/${encodeURIComponent(handle)}?page=${page}&playlists_sort_by=created_at&clips_sort_by=created_at`);
    } catch (err) {
      if (page === 1) throw new Error(`couldn't find a Suno creator called @${handle}.`);
      break;
    }
    name = data.display_name || name;
    const found = (data.clips || []).map(toSong).filter(Boolean);
    if (!found.length) break;
    songs.push(...found);
  }
  if (!songs.length) throw new Error(`@${handle} has no public songs.`);
  return { name, songs };
}

/**
 * Whatever a Suno link points at: { kind: 'song'|'playlist'|'profile', name, songs }.
 */
async function resolveLink(link) {
  const url = await expandLink(link);
  const song = url.match(SONG_RE)?.[1];
  if (song) {
    const s = await getSong(song);
    return { kind: 'song', name: s.title, songs: [s] };
  }
  const playlist = url.match(PLAYLIST_RE)?.[1];
  if (playlist) return { kind: 'playlist', ...(await getPlaylist(playlist)) };
  const handle = url.match(PROFILE_RE)?.[1];
  if (handle) return { kind: 'profile', ...(await getProfileSongs(handle)) };
  throw new Error("that doesn't look like a Suno song, playlist or profile link.");
}

// ---------------------------------------------------------------------------
// The public Explore lists — the default search source (no account needed).
// ---------------------------------------------------------------------------
let pool = { at: 0, songs: [], trending: [], styles: [] };
let poolLoading = null;

async function loadPool() {
  const songs = new Map();
  let trending = [];
  const styles = [];
  const playlistIds = [];
  const add = (clip, source) => {
    const s = toSong(clip);
    if (s && !songs.has(s.id)) songs.set(s.id, { ...s, source });
    return s;
  };
  let total = 20;
  for (let start = 0; start < total && start < 60; start += 3) {
    const data = await getJson(`${API}/discover/`, { method: 'POST', body: { start_index: start, page_size: 3 } }).catch(() => null);
    if (!data) break;
    total = Number(data.total_sections) || total;
    for (const section of data.sections || []) {
      for (const item of section.items || []) {
        if (item.entity_type === 'song_schema') add(item, section.title);
        else if (item.entity_type === 'style_schema' && item.name) styles.push(item.name);
        if (Array.isArray(item.items)) {
          const list = item.items.map((clip) => add(clip, item.title || section.title)).filter(Boolean);
          if (item.id === 'featured_feed_trending') trending = list;
        }
      }
      if (section.section_type === 'playlist' && new RegExp(`^${UUID}$`).test(section.id)) playlistIds.push([section.id, section.title]);
    }
    if (!(data.sections || []).length) break;
  }
  // The featured playlists (Staff Picks, Best of…) only show a preview on Explore — fetch them whole.
  for (const [id, title] of playlistIds.slice(0, 6)) {
    const list = await getPlaylist(id, 100).catch(() => null);
    for (const s of list?.songs || []) if (!songs.has(s.id)) songs.set(s.id, { ...s, source: title });
  }
  if (!songs.size) throw new Error("couldn't reach Suno's song lists right now.");
  return { at: Date.now(), songs: [...songs.values()], trending: trending.length ? trending : [...songs.values()].slice(0, 30), styles: [...new Set(styles)] };
}

/** The Explore lists, cached for 15 minutes (a stale copy is used if Suno can't be reached). */
async function getPool() {
  if (pool.songs.length && Date.now() - pool.at < POOL_TTL_MS) return pool;
  poolLoading ||= loadPool()
    .then((p) => (pool = p))
    .catch((err) => {
      if (pool.songs.length) return pool;
      throw err;
    })
    .finally(() => (poolLoading = null));
  return poolLoading;
}

const words = (text) => String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Best matches for `query` in the Explore lists: title words count most, then the artist, then the style. */
function searchPool(songs, query, { styleOnly = false } = {}) {
  const q = words(query);
  if (!q.length) return [];
  const phrase = q.join(' ');
  return songs
    .map((s) => {
      const tags = words(s.tags).join(' ');
      if (styleOnly) {
        // "lofi" should find "lo-fi", "hiphop" should find "hip hop": also compare with spaces/hyphens squashed out.
        const squashed = tags.replace(/ /g, '');
        const hit = q.every((w) => tags.split(' ').some((t) => t.startsWith(w))) || squashed.includes(q.join(''));
        return { s, score: hit ? 1 + (tags.includes(phrase) ? 1 : 0) : 0 };
      }
      const title = words(s.title);
      const artist = words(`${s.artist} ${s.handle}`);
      let score = 0;
      for (const w of q) {
        if (title.includes(w)) score += 3;
        else if (title.some((t) => t.startsWith(w))) score += 2;
        if (artist.includes(w)) score += 2;
        if (tags.split(' ').includes(w)) score += 1;
      }
      if (words(s.title).join(' ').includes(phrase)) score += 3;
      return { s, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.s.plays - a.s.plays)
    .map((r) => r.s);
}

// ---------------------------------------------------------------------------
// OPTIONAL: Suno's own search, with a __client token from a throwaway account.
// ---------------------------------------------------------------------------
function createAuth(clientToken, log) {
  let jwt = null;
  let jwtExpires = 0;
  let broken = false;
  let warned = false;

  async function token() {
    if (jwt && Date.now() < jwtExpires - 30000) return jwt;
    let lastErr = null;
    for (const host of AUTH_HOSTS) {
      try {
        const headers = { Cookie: `__client=${clientToken}`, Origin: 'https://suno.com', Referer: 'https://suno.com/' };
        const client = await getJson(`${host}/v1/client?_clerk_js_version=${CLERK_VERSION}`, { headers });
        const sessionId = client.response?.last_active_session_id || client.response?.sessions?.[0]?.id;
        if (!sessionId) throw new Error('the __client token has no signed-in session (expired, or you signed out in that browser)');
        const t = await getJson(`${host}/v1/client/sessions/${sessionId}/tokens?_clerk_js_version=${CLERK_VERSION}`, { method: 'POST', headers });
        if (!t.jwt) throw new Error('no token came back');
        jwt = t.jwt;
        try {
          jwtExpires = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).exp * 1000;
        } catch {
          jwtExpires = Date.now() + 50000;
        }
        return jwt;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  /** Suno's own search (public songs). Returns null when the token can't be used, so callers fall back. */
  async function search(term, limit = 20) {
    if (broken) return null;
    try {
      const data = await getJson(`${API}/search/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}` },
        body: { search_queries: [{ name: 'public_song', search_type: 'public_song', term, from_index: 0, rank_by: 'most_relevant' }] },
      });
      return findClips(data).map(toSong).filter(Boolean).slice(0, limit);
    } catch (err) {
      if (!warned) log(`Suno search with your __client token didn't work (${err.message}) — using the public lists instead. See "BROADER SEARCH" in README.txt.`);
      warned = true;
      if (err.status === 401 || err.status === 403 || /session|token/.test(err.message)) broken = Date.now(); // tried again after an hour
      return null;
    }
  }

  return {
    search: async (term, limit) => {
      if (broken && Date.now() - broken > 60 * 60 * 1000) {
        broken = false;
        warned = false;
      }
      return search(term, limit);
    },
    check: async () => {
      try {
        await token();
        return true;
      } catch (err) {
        log(`Your __client token didn't sign in (${err.message}). Searches use the public lists instead.`);
        return false;
      }
    },
  };
}

/** Every clip-shaped object in a search response, whatever shape the response has. */
function findClips(node, out = [], seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const x of node) findClips(x, out, seen);
  } else if (typeof node.id === 'string' && node.status && (node.video_url || node.audio_url || node.metadata)) {
    out.push(node);
  } else {
    for (const v of Object.values(node)) findClips(v, out, seen);
  }
  return out;
}

module.exports = { findSunoLink, resolveLink, getSong, getPool, searchPool, createAuth, toSong };
