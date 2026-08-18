/* ==========================================================================
   STORE — the archive's memory, which is not in this file
   --------------------------------------------------------------------------
   Supabase over plain fetch. No client library, because the whole lineage of
   these pieces is "no dependencies" and PostgREST is only HTTP with a header
   on it.

   Reading is open to everyone: anon may SELECT from `contributions` and
   nothing else. Writing is not — there is no INSERT policy at all, and the
   only way a row appears is through the `contribute` RPC, which runs as the
   definer, checks the invitation code against a table anon cannot see, and
   refuses everything else. So the key below being public costs nothing.
   ========================================================================== */

'use strict';

const Store = (function () {
  const C = window.COMMONS_CONFIG || {};
  const on = !!(C.url && C.anonKey);
  const base = on ? C.url.replace(/\/+$/, '') : '';

  /* Supabase has two generations of public key and they want different
     headers. The old one is a JWT — `eyJ…` — and PostgREST reads the role out
     of it, so it goes in Authorization as a bearer token. The new one is an
     opaque `sb_publishable_…` string that the gateway trades for a role before
     PostgREST ever sees it; it belongs in `apikey` and nowhere else, and
     presenting it as a bearer token is asking the JWT parser to read something
     that is not a JWT. Both forms are accepted here, and which one you pasted
     into config.js decides the shape of the request. */
  const isJWT = /^eyJ/.test(C.anonKey || '');

  const headers = () => {
    const h = { apikey: C.anonKey, 'Content-Type': 'application/json' };
    if (isJWT) h.Authorization = 'Bearer ' + C.anonKey;
    return h;
  };

  async function get(path) {
    const r = await fetch(base + '/rest/v1/' + path, { headers: headers() });
    if (!r.ok) throw new Error('archive read failed — ' + r.status + ' ' + (await r.text()).slice(0, 180));
    return r.json();
  }

  async function rpc(fn, args) {
    const r = await fetch(base + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers: headers(), body: JSON.stringify(args),
    });
    const t = await r.text();
    let body = null;
    try { body = t ? JSON.parse(t) : null; } catch (e) { body = t; }
    if (!r.ok) {
      // Postgres RAISE comes back as {message: "..."}; surface it as written,
      // because those messages are the piece talking to a contributor.
      const m = body && body.message ? body.message : ('rejected — ' + r.status);
      throw new Error(String(m).replace(/^[A-Z0-9]+:\s*/, ''));
    }
    return body;
  }

  // Columns worth having, in the order the field wants them. `thumb` is the
  // heavy one — a 256 px JPEG as a data URI, ~16 kB — so pages are small.
  //
  // `clip` is stored on every read picture and deliberately not asked for
  // here. Nothing on the stage uses it; it exists so the archive can be
  // re-centred later against its own accumulated mean, which is a job for a
  // script that selects the column on purpose. Fetching three floats per row
  // on every page load to never look at them is not free at a thousand rows.
  const COLS = 'id,created_at,ar,aff,feat,rgb,method,title';

  return {
    on,

    /* one page of the archive, oldest first — so the cloud accretes in the
       order it was given, and a reload shows the same growth again */
    async page(offset, limit) {
      const q = `contributions?select=${COLS},thumb&order=created_at.asc` +
        `&offset=${offset | 0}&limit=${limit | 0}`;
      return get(q);
    },

    /* anything added since a given row's timestamp — the live update */
    async since(iso) {
      const q = `contributions?select=${COLS},thumb&order=created_at.asc` +
        `&created_at=gt.${encodeURIComponent(iso)}&limit=48`;
      return get(q);
    },

    async count() {
      const r = await fetch(base + '/rest/v1/contributions?select=id&limit=1', {
        headers: Object.assign(headers(), { Prefer: 'count=exact', Range: '0-0' }),
      });
      if (!r.ok) throw new Error('archive count failed — ' + r.status);
      const cr = r.headers.get('content-range') || '';
      const n = parseInt(cr.split('/')[1], 10);
      return Number.isFinite(n) ? n : 0;
    },

    /* hand one picture to the archive. Returns the new row's id. */
    async submit(code, rec) {
      return rpc('contribute', {
        p_code: code,
        p_thumb: rec.thumb,
        p_ar: rec.ar,
        p_feat: rec.feat,
        p_aff: rec.aff,
        p_rgb: rec.rgb,
        p_method: rec.method,
        p_title: rec.title || null,
      });
    },

    /* CLIP finishing after the fact: revise where a picture belongs. The raw
       three scores ride along so the archive can be re-centred later without
       asking anyone to give the same picture twice. */
    async refine(code, id, aff, method, clip) {
      return rpc('refine', {
        p_code: code, p_id: id, p_aff: aff, p_method: method, p_clip: clip || null,
      });
    },
  };
})();
