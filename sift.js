/* ==========================================================================
   SIFT — how a picture nobody labelled finds out where it belongs
   --------------------------------------------------------------------------
   The founding archive arrived with its belonging already written: somebody
   looked at each plate and read it for whether it shows a single body, a
   social scene, or a shared myth. A stranger's upload has none of that. It is
   pixels, with no title, no keywords, and nobody to read it.

   So it is placed twice.

     1. BY RESEMBLANCE, immediately. Twenty-three numbers are taken off the
        picture — mean and spread of tone and saturation, edge energy at two
        scales, mean RGB, an eight-bin hue histogram weighted by saturation, a
        six-bin tone histogram. The same twenty-three are recomputed here for
        every plate already in the archive, from the atlas, so both are
        measured with one ruler. The upload's seven nearest neighbours vote
        their own affinities and the picture inherits the average.

        This is the whole argument in one function. A picture with no stated
        allegiance is assigned the allegiance of whatever it happens to look
        like, by a room that was already in the room.

     2. BY READING, if it can. CLIP is fetched from a CDN and the picture is
        scored against three prompt bundles for self / other / fiction. It is
        slow the first time and needs a network, so it runs after the fact and
        revises the row if it lands. When it cannot run, the vote stands.

   The perceptual features match ../cloud/build/rebuild.py exactly in intent —
   same statistics, same bin counts — but nothing here reads that file's
   numbers. They are recomputed in the browser so an upload and a founding
   plate are never measured differently.
   ========================================================================== */

'use strict';

const Sift = (function () {

  const FEAT_N = 23;

  /* ---------------------------------------------------------- features -- */

  // an image fitted inside 96x96 with its aspect kept, as the python does
  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { willReadFrequently: true });

  function sample(src, sx, sy, sw, sh) {
    const s = Math.min(96 / sw, 96 / sh, 1);
    const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
    work.width = w; work.height = h;
    wctx.fillStyle = '#fff'; wctx.fillRect(0, 0, w, h);
    wctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    return wctx.getImageData(0, 0, w, h);
  }

  // PIL's FIND_EDGES: a 3x3 laplacian, clamped, then averaged. Border pixels
  // are replicated rather than dropped — at 96 px that is 4% of the frame and
  // the alternative is a different length of vector for every aspect ratio.
  function edgeEnergy(gray, w, h) {
    let sum = 0;
    const at = (x, y) => gray[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = 8 * at(x, y)
          - at(x - 1, y - 1) - at(x, y - 1) - at(x + 1, y - 1)
          - at(x - 1, y) - at(x + 1, y)
          - at(x - 1, y + 1) - at(x, y + 1) - at(x + 1, y + 1);
        sum += v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    return sum / (w * h) / 255;
  }

  function blur(gray, w, h, sigma) {
    const r = Math.max(1, Math.ceil(sigma * 2));
    const k = new Float32Array(r * 2 + 1);
    let ks = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; ks += v; }
    for (let i = 0; i < k.length; i++) k[i] /= ks;
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += k[i + r] * gray[y * w + Math.min(w - 1, Math.max(0, x + i))];
      tmp[y * w + x] = s;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += k[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
      out[y * w + x] = s;
    }
    return out;
  }

  function featuresFromImageData(id) {
    const { data, width: w, height: h } = id;
    const n = w * h;
    const gray = new Float32Array(n);
    let lumS = 0, lumSS = 0, satS = 0, satSS = 0, rS = 0, gS = 0, bS = 0;
    const hue = new Float64Array(8), tone = new Float64Array(6);

    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = data[p] / 255, g = data[p + 1] / 255, b = data[p + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const sat = mx > 1e-6 ? d / (mx + 1e-6) : 0;

      gray[i] = lum * 255;
      lumS += lum; lumSS += lum * lum;
      satS += sat; satSS += sat * sat;
      rS += r; gS += g; bS += b;

      let hv = 0;
      if (d > 1e-9) {
        if (mx === r) hv = ((g - b) / d) % 6;
        else if (mx === g) hv = (b - r) / d + 2;
        else hv = (r - g) / d + 4;
        hv /= 6; if (hv < 0) hv += 1;
      }
      // weighted by saturation: a grey pixel has no opinion about hue
      hue[Math.min(7, Math.floor(hv * 8))] += mx > 1e-6 ? d / mx : 0;
      tone[Math.min(5, Math.floor(lum * 6))] += 1;
    }

    const lm = lumS / n, sm = satS / n;
    const lsd = Math.sqrt(Math.max(0, lumSS / n - lm * lm));
    const ssd = Math.sqrt(Math.max(0, satSS / n - sm * sm));

    const e1 = edgeEnergy(gray, w, h);
    const e2 = edgeEnergy(blur(gray, w, h, 2), w, h);

    let hs = 0; for (let i = 0; i < 8; i++) hs += hue[i];
    let ts = 0; for (let i = 0; i < 6; i++) ts += tone[i];

    const f = new Float64Array(FEAT_N);
    f[0] = lm; f[1] = lsd; f[2] = sm; f[3] = ssd; f[4] = e1; f[5] = e2;
    f[6] = rS / n; f[7] = gS / n; f[8] = bS / n;
    for (let i = 0; i < 8; i++) f[9 + i] = hue[i] / (hs + 1e-6);
    for (let i = 0; i < 6; i++) f[17 + i] = tone[i] / (ts + 1e-6);
    return f;
  }

  // mean colour, for nothing but the record
  function meanRGB(id) {
    const { data } = id; const n = data.length / 4;
    let r = 0, g = 0, b = 0;
    for (let p = 0; p < data.length; p += 4) { r += data[p]; g += data[p + 1]; b += data[p + 2]; }
    return [r / n / 255, g / n / 255, b / n / 255];
  }

  function read(src, sx, sy, sw, sh) {
    const id = sample(src, sx, sy, sw, sh);
    return { feat: featuresFromImageData(id), rgb: meanRGB(id) };
  }

  /* --------------------------------------------------------------- PCA -- */
  // 23 dimensions. A covariance matrix that small yields to power iteration
  // with deflation in a millisecond, and pulling in a linear algebra library
  // for it would be the only dependency in the piece.

  function covariance(X) {
    const n = X.length, d = FEAT_N;
    const C = Array.from({ length: d }, () => new Float64Array(d));
    for (let i = 0; i < n; i++) {
      const x = X[i];
      for (let a = 0; a < d; a++) { const xa = x[a]; for (let b = a; b < d; b++) C[a][b] += xa * x[b]; }
    }
    for (let a = 0; a < d; a++) for (let b = a; b < d; b++) { C[a][b] /= n; C[b][a] = C[a][b]; }
    return C;
  }

  function topVectors(C, k) {
    const d = C.length, out = [];
    const M = C.map(r => Float64Array.from(r));
    for (let c = 0; c < k; c++) {
      let v = new Float64Array(d);
      for (let i = 0; i < d; i++) v[i] = Math.sin(i * 12.9898 + c * 78.233);
      let lam = 0;
      for (let it = 0; it < 220; it++) {
        const w = new Float64Array(d);
        for (let a = 0; a < d; a++) { let s = 0; for (let b = 0; b < d; b++) s += M[a][b] * v[b]; w[a] = s; }
        let m = 0; for (let i = 0; i < d; i++) m += w[i] * w[i];
        m = Math.sqrt(m) || 1;
        for (let i = 0; i < d; i++) w[i] /= m;
        lam = m; v = w;
      }
      // fix the sign so a rebuild lays the cloud out the same way twice
      let big = 0; for (let i = 1; i < d; i++) if (Math.abs(v[i]) > Math.abs(v[big])) big = i;
      if (v[big] < 0) for (let i = 0; i < d; i++) v[i] = -v[i];
      out.push(v);
      for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) M[a][b] -= lam * v[a] * v[b];
    }
    return out;
  }

  /* ------------------------------------------------------------- state -- */
  // the ruler, fixed once from the founding archive. Contributions are
  // measured against it and never move it — otherwise every upload would
  // rearrange everyone else, and the piece would never sit still.

  let CAL = null;

  function calibrate(rawFeats, affs) {
    const n = rawFeats.length, d = FEAT_N;
    const mean = new Float64Array(d), sd = new Float64Array(d);
    for (const f of rawFeats) for (let i = 0; i < d; i++) mean[i] += f[i];
    for (let i = 0; i < d; i++) mean[i] /= n;
    for (const f of rawFeats) for (let i = 0; i < d; i++) { const q = f[i] - mean[i]; sd[i] += q * q; }
    for (let i = 0; i < d; i++) sd[i] = Math.sqrt(sd[i] / n) + 1e-9;

    const Z = rawFeats.map(f => {
      const z = new Float64Array(d);
      for (let i = 0; i < d; i++) z[i] = (f[i] - mean[i]) / sd[i];
      return z;
    });

    const W = topVectors(covariance(Z), 3);
    const proj = Z.map(z => W.map(w => { let s = 0; for (let i = 0; i < d; i++) s += z[i] * w[i]; return s; }));

    const amax = [0, 1, 2].map(c => Math.max(1e-9, ...proj.map(p => Math.abs(p[c]))));
    const lo2 = [0, 1].map(c => Math.min(...proj.map(p => p[c])));
    const hi2 = [0, 1].map(c => Math.max(...proj.map(p => p[c])));

    // how much of each chamber the founding archive already is. The vote is
    // divided by this, and the reason is in knn().
    const prior = [0, 0, 0];
    for (const a of affs) for (let l = 0; l < 3; l++) prior[l] += a[l] / affs.length;

    CAL = { mean, sd, W, amax, lo2, hi2, Z, aff: affs, prior };
    return CAL.Z.map(z => place(z));
  }

  function zscore(raw) {
    const z = new Float64Array(FEAT_N);
    for (let i = 0; i < FEAT_N; i++) z[i] = (raw[i] - CAL.mean[i]) / CAL.sd[i];
    return z;
  }

  // p3 is the position inside a chamber; p2 is the home cell on the lattice.
  // Both are clamped: a contribution far outside anything the founding archive
  // contains would otherwise be flung out of the frame entirely.
  function place(z) {
    const p = CAL.W.map(w => { let s = 0; for (let i = 0; i < FEAT_N; i++) s += z[i] * w[i]; return s; });
    const cl = (v, a, b) => v < a ? a : v > b ? b : v;
    return {
      p3: [0, 1, 2].map(c => cl(p[c] / CAL.amax[c], -1.35, 1.35)),
      p2: [0, 1].map(c => cl((p[c] - CAL.lo2[c]) / (CAL.hi2[c] - CAL.lo2[c] + 1e-9), -0.15, 1.15)),
    };
  }

  /* ------------------------------------------- belonging by resemblance -- */

  /* The correction is the interesting line here.

     Taken raw, this vote is useless: sixty-three per cent of the founding
     archive belongs to the fiction, so the seven nearest plates are usually
     mostly fiction whatever the picture is, and sixty-seven of sixty-nine
     plates come back fiction when each is tested against the others. The
     biggest chamber eats everything, which is a true enough sentence about
     echo chambers and a broken classifier.

     So the vote is divided by how much of each chamber there already is —
     asking not "what are its neighbours" but "what are its neighbours, more
     than the room already is". The exponent is the dial between those two
     readings. At 0 the majority swallows the room; at 1 the prior is fully
     cancelled and the placement gets noisy, because these twenty-three
     numbers were never going to tell a crowd from a lone figure. 0.7 lands
     the vote on almost exactly the archive's own proportions without
     collapsing into them.

     What it cannot do is see the subject. Colour statistics and edge energy
     read a nebula perfectly and a portrait not at all — a face and a crowd
     have the same histogram. That gap is not patched here: the honest fix
     would be a skin-tone detector, which would work better on some people
     than others, and a piece about who gets sorted where has no business
     shipping that. The reading is left to CLIP, which is allowed to arrive
     late and move the picture. */
  const PRIOR_POWER = 0.7;

  function knn(z, k) {
    k = k || 7;
    const d = [];
    for (let i = 0; i < CAL.Z.length; i++) {
      const a = CAL.Z[i]; let s = 0;
      for (let j = 0; j < FEAT_N; j++) { const q = z[j] - a[j]; s += q * q; }
      d.push([Math.sqrt(s), i]);
    }
    d.sort((a, b) => a[0] - b[0]);
    const near = d.slice(0, k);
    const tau = Math.max(1e-3, near[near.length - 1][0] * 0.6);
    const out = [0, 0, 0];
    let tot = 0;
    for (const [dist, i] of near) {
      const w = Math.exp(-dist / tau);
      tot += w;
      for (let l = 0; l < 3; l++) out[l] += w * CAL.aff[i][l];
    }
    for (let l = 0; l < 3; l++) {
      out[l] = (out[l] / (tot || 1)) / Math.pow(Math.max(CAL.prior[l], 1e-4), PRIOR_POWER);
    }
    const s = out[0] + out[1] + out[2] || 1;
    return { aff: out.map(x => x / s), neighbours: near.map(([, i]) => i) };
  }

  /* -------------------------------------------------- belonging by CLIP -- */
  // the same three prompt bundles ../cloud/cloud.js uses, so a picture read
  // here and a plate read there are asked the same question.

  const BUNDLES = [
    ['a portrait of one person', 'a single human figure alone', 'one body, one face, a self',
      'a lone figure in an empty place', 'a close-up of a human face'],
    ['a group of people together', 'a crowd', 'a family', 'two people interacting',
      'people watching each other', 'a social gathering'],
    ['deep space, a nebula, a galaxy', 'an advertisement or magazine page',
      'a myth, a symbol, a shared story', 'a monument or a postcard',
      'the cosmos, the sublime, the infinite', 'mass media imagery'],
  ];

  const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3';
  let clipKit = null, textAxes = null;

  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

  function unitRows(out) {
    const t = out.data ? out : out.image_embeds || out.text_embeds;
    const d = Array.from(t.data), k = t.dims[1], n = t.dims[0], r = [];
    for (let i = 0; i < n; i++) {
      const v = d.slice(i * k, i * k + k);
      const m = Math.hypot(...v) || 1;
      r.push(v.map(x => x / m));
    }
    return r;
  }

  /* transformers.js has no `CLIPModel.get_image_features`. There is a
     `CLIPModel` and it loads without complaint, but the object it returns
     carries neither `get_image_features` nor `get_text_features` — the two
     halves are separate classes, `CLIPVisionModelWithProjection` and
     `CLIPTextModelWithProjection`, returning `{image_embeds}` and
     `{text_embeds}` respectively, both [n, 512].

     Worth knowing because the python API does have those methods, and code
     written from memory of it fails at the last step after downloading forty
     megabytes — which is exactly how this was found. ../cloud/cloud.js still
     calls the methods that do not exist, so its CLIP mode has never run. */
  async function loadCLIP(say) {
    if (clipKit) return clipKit;
    say && say('fetching the reader…');
    const tf = await import(/* webpackIgnore: true */ CDN);
    tf.env.allowLocalModels = false;
    say && say('loading the model — slow once, cached after');
    const id = 'Xenova/clip-vit-base-patch32';
    const vision = await tf.CLIPVisionModelWithProjection.from_pretrained(id, { dtype: 'q8' });
    const text = await tf.CLIPTextModelWithProjection.from_pretrained(id, { dtype: 'q8' });
    const proc = await tf.AutoProcessor.from_pretrained(id);
    const tok = await tf.AutoTokenizer.from_pretrained(id);

    const axes = [];
    for (const b of BUNDLES) {
      axes.push(unitRows(await text(tok(b, { padding: true, truncation: true }))));
    }

    // assigned last, and only once every part of it works. Setting it earlier
    // means a failure half way leaves a kit that is memoised, incomplete, and
    // fails differently on the next call than it did on the first.
    textAxes = axes;
    clipKit = { tf, vision, proc };
    return clipKit;
  }

  async function embed(canvases) {
    const { tf, vision, proc } = clipKit;
    const raw = [];
    for (const cv of canvases) {
      raw.push(await tf.RawImage.fromBlob(await new Promise(r => cv.toBlob(r, 'image/png'))));
    }
    return unitRows(await vision(await proc(raw)));
  }

  const axisScores = e => textAxes.map(bundle => bundle.reduce((s, p) => s + dot(e, p), 0) / bundle.length);

  /* Cosine similarity has no zero. A picture scores about 0.2 against all
     three bundles and the differences that decide anything live in the third
     decimal, so the axes have to be centred on something before a softmax
     means what it looks like it means.

     ../cloud/ centres on the corpus: it reads all sixty-nine plates and
     z-scores each axis across them. This piece cannot — it does not have the
     plates, only their measurements, and CLIP wants pixels. So it centres each
     picture on itself: the three scores are z-scored against each other, which
     asks which of the three bundles this picture matches most relative to how
     it matches the others.

     The trade is real and worth naming. Cross-corpus centring knows that some
     bundles simply score higher on everything and subtracts it; this does not,
     so a systematic tilt in the prompts shows up as a systematic tilt in the
     archive. The raw three are kept on the row for exactly that reason — once
     enough pictures have been given, their own mean and spread can be measured
     and this can be re-centred properly, without asking anyone to upload
     anything twice. */
  async function clipAffinity(canvas, say) {
    await loadCLIP(say);
    say && say('reading the picture…');
    const a = axisScores((await embed([canvas]))[0]);
    const mu = (a[0] + a[1] + a[2]) / 3;
    const sd = Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / 3) || 1e-4;
    const e = a.map(x => Math.exp(((x - mu) / sd) * 1.1));
    const t = e[0] + e[1] + e[2];
    return { aff: e.map(x => x / t), raw: a };
  }

  return {
    FEAT_N, read, featuresFromImageData, calibrate, zscore, place, knn,
    clipAffinity,
    ready: () => !!CAL,
  };
})();
