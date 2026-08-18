# The Commons

An archive that accepts.

One Gray–Scott lattice carries three reagents — *perception of self*,
*perception of others*, *the collective fiction*. They share a grid, each one
bends the others' feed rate, and the fiction is reflexive: the more of it there
is, the harder it pulls. Every picture the archive holds is pinned to a cell of
that lattice. Where its layer is active the picture is drawn inward and
enlarged; where the layer has died back it is flung out to the periphery and
shrinks.

The room opens empty. It fills only with what people give it, and what they
give it stays.

---

## Where this came from

This is a fork of `cloud`, a closed piece that runs the same field over a fixed
set of sixty-nine photographs. That piece is not published here — its archive
is personal — and it is untouched by this one. What was taken from it is the
field, its parameters, and its judgement.

**Its judgement, not its pictures.** Each of those sixty-nine plates was read
by a person for whether it shows a single body, a social scene, or a shared
myth. `assets/founding.json` is fourteen kilobytes of what was concluded:
twenty-three measurements per plate and the belonging assigned to it. No
pixels, no filenames, no photographs.

Which leaves the room empty and its criteria intact. There is nothing on the
stage when the page opens, and the first picture given to it is still sorted by
an archive of sixty-nine judgements it will never be shown — the ruler that
decides where you belong, held by a population that has left.

---

## Running it

Serve the folder — `file://` blocks the fetch that reads `assets/founding.json`.

```
cd commons
python3 -m http.server 8000
```

then open <http://localhost:8000>. It runs with no database configured; the
field turns, the room is empty, and it says so if you try to contribute. Space
pauses. Drag to orbit, scroll to zoom, shift-drag to pan.

---

## What is actually happening

### The field is unchanged

Every number in section 1 of `commons.js` is the value `cloud` opens on,
flattened out of that piece's `SPEC` into a plain object. The control panel is
gone, because this one is a room rather than an instrument. To dial new values,
open that piece, tune them there with the sliders, and paste the numbers
across.

One parameter is not a constant here. `cloud` sets the field underlay at
`0.085`, which is right when a thousand plates carry the eye and the field only
has to be felt underneath them; an empty commons at `0.085` is a blank page. So
the underlay is raised in proportion to how empty the room is and hands the
composition back as it fills. By two dozen plates it is at the cloud's value
exactly, and from there the two pieces match.

### Where a stranger's picture goes

An upload arrives with no stated allegiance. It is pixels, with no title, no
keywords, and nobody to read it. So it is placed twice.

**By resemblance, immediately.** Twenty-three numbers come off the picture:
mean and spread of tone and saturation, edge energy at two scales, mean RGB, an
eight-bin hue histogram weighted by saturation, a six-bin tone histogram. The
founding archive's twenty-three were computed by the same code — that is what
`founding.json` holds — so both are measured with one ruler. The upload's seven
nearest neighbours vote their own affinities and it inherits the average.

That is the whole argument in one function. A picture with no stated allegiance
is assigned the allegiance of whatever it happens to look like, by a room that
was already in the room.

**By reading, if it can.** CLIP is fetched from a CDN and the picture scored
against three prompt bundles for self / other / fiction — the same three the
cloud uses, so a picture read here and a plate read there are asked the same
question. It is slow the first time, so it runs *after* the contribution is
already in, and revises the row if it lands. When it cannot run, the vote
stands and the piece says so.

### Two things the vote gets wrong, one on purpose

Taken raw, the neighbour vote is useless. Sixty-three per cent of the founding
archive belongs to the fiction, so the seven nearest plates are mostly fiction
whatever the picture is. Tested leave-one-out, **sixty-seven of sixty-nine come
back fiction**. The biggest chamber eats everything — a true enough sentence
about echo chambers, and a broken classifier.

So the vote is divided by how much of each chamber there already is, raised to
a power. The exponent is the dial between two readings of the same question: at
0 it asks "what are its neighbours" and the majority swallows the room; at 1
the prior is fully cancelled. `PRIOR_POWER = 0.7` lands the vote on 9 / 21 / 39
against the archive's own curated 9 / 16 / 44 — the same shape, without
collapsing into it.

What no exponent fixes is that these twenty-three numbers **cannot see the
subject**. They read a nebula perfectly and a portrait not at all; a face and a
crowd have the same histogram. Every portrait and every group photograph is
misplaced by resemblance alone. That gap is deliberately not patched: the cheap
fix is a skin-tone detector, it would work better on some people than others,
and a piece about who gets sorted where has no business shipping one. The
reading is left to CLIP, which is allowed to arrive late and move the picture.

### Belonging is not fixed anyway

`capture` is on, at the cloud's value. A plate sitting where another layer's
reagent has grown loud is dragged toward *that* chamber regardless of how it
was classified. The chambers keep re-sorting the room as the room grows, and a
picture placed in the fiction on Tuesday can be in *other* on Thursday because
the field moved under it. Nothing in the database changes when that happens.

A contribution arriving also stamps a small burst of reagent into the chamber
that took it, so the field notices the gift rather than the gift merely
appearing inside it.

### As the archive grows

The sprite count is held near 1250 — one plate wants many copies, six hundred
want two — so the cloud keeps its density and its long tail instead of becoming
a wall. The contribution atlas doubles as it fills, 16 slots then 64 then 256,
and 4096 px is the ceiling because that is what the weakest GPU worth
supporting will hold. At 256 given plates, `build/absorb.py` bakes them down.

---

## Setting up the archive

Nothing above needs a database. This part does.

### 1. Make a Supabase project

<https://supabase.com> → new project. The free tier is far more than enough.

### 2. Run the schema

Project → **SQL Editor** → new query → paste all of `supabase/schema.sql` →
Run. Two tables, two functions.

The shape of it is what makes the key in step 4 safe to publish:

- anonymous visitors may `select` from `contributions` and **nothing else**;
- there is no insert, update or delete policy anywhere, so the published key
  cannot write a row however it is used;
- the only door is `contribute()`, which runs as the definer, checks the code
  against `invites` — a table anon cannot see exists — and refuses anything
  malformed, oversized, or more than thirty times an hour from one invitation;
- `invite` and `hidden` are revoked at column level, so a visitor cannot read
  who gave what even though the row itself is readable.

### 3. Hand out an invitation

```sql
insert into public.invites (code, label) values ('some-phrase', 'Ana');
```

One per person, so you can switch one off without switching everyone off:

```sql
update public.invites set active = false where code = 'some-phrase';
```

### 4. Fill in `config.js`

Project Settings → **API**. Take the **Project URL** and the **anon / public**
key — not the service key, which must never leave the dashboard.

```js
window.COMMONS_CONFIG = {
  url: 'https://xxxxxxxxxxxxxxxx.supabase.co',
  anonKey: 'eyJhbGciOi…',
  page: 24,
  poll: 45,
};
```

Both are meant to be public. The anon key is a published identifier, not a
secret; it is in the page source of every Supabase site on the web, and here it
can do nothing but read.

### 5. Try it

Reload, click **contribute**, enter the code, drop an image. It should tell you
which chamber took it, then go quiet and try to read it properly.

---

## Moderation

Contributions are invitation-only, which is the structural half. The other half
is one column:

```sql
-- take a picture down without destroying the record
update public.contributions set hidden = true where id = '…';

-- what has been given, without the pictures
select id, created_at, title, method, aff, invite
  from public.contributions order by created_at desc limit 50;
```

Hidden rows stop being served on the next page load. Nothing is cached beyond
the browser session.

---

## Putting pictures back

`assets/atlas.jpg` + `assets/atlas.json` are an optional pair. If they are
there, they are plates that ship with the page — a founding set you chose to
publish, or contributions baked down. Both absent is the normal state and not
an error.

What does **not** move when they appear is `founding.json`. That file stays the
ruler and the seven voters, held still while the wall changes, so publishing a
wall does not silently shift where every future contribution lands.

`build/absorb.py` writes that pair. It reads the archive with the anon key out
of `config.js`, appends the given plates to any wall already there, keeps the
previous pair as `*.before-absorb`, and prints one `update` for you to run in
the SQL editor so the same pictures do not arrive twice. It never writes to the
database itself.

```
cd commons/build
python absorb.py --dry-run     # say what it would do, touch nothing
python absorb.py
```

Needs Pillow: `python -m pip install pillow`.

---

## Files

```
commons/
  index.html          the stage, the title, the way in — that is all of it
  style.css           forked from cloud's and then almost entirely deleted
  config.js           your project URL and anon key
  store.js            Supabase over plain fetch; no client library
  sift.js             the 23 measurements, the PCA, the neighbour vote, CLIP
  commons.js          the field, the atlases, the contribution flow
  .nojekyll           keeps GitHub Pages out of the assets
  assets/
    founding.json     69 judgements and no photographs — the ruler
    atlas.jpg         optional: plates that ship with the page
    atlas.json        optional: their rectangles and belonging
  supabase/
    schema.sql        run once, in the SQL editor
  build/
    absorb.py         given plates -> the wall, when the sheet fills
```

`commons.js` is in numbered sections. Section 1 is every parameter, section 5
is the contribution atlas, section 10 is the way in, section 11 is what happens
to a picture once the archive has it.

---

## Known limits

Cost scales with plates × echoes, and the echo count is scaled down to hold the
sprite total near 1250, so the frame rate should stay roughly flat as the
archive grows. What does not stay flat is the initial load: every contribution
is a ~16 kB data URI in a row, so a thousand of them is 16 MB of JSON before
anything is on screen. They arrive paged, twenty-four at a time, and the cloud
fills in while the field is already turning — but past a few hundred it is time
to absorb.

CLIP needs a CDN and roughly 40 MB on first use, browser-cached after. It will
not run behind a strict content blocker, and the piece is written to carry on
without it rather than fail.

CLIP is also centred differently here than in `cloud`. That piece z-scores each
axis across all sixty-nine plates; this one has no plates to score, so it
centres each picture on itself — asking which of the three bundles it matches
most relative to how it matches the others. A systematic tilt in the prompts
therefore shows up as a systematic tilt in the archive. The three raw scores
are kept on every row for exactly that reason: once enough pictures have been
given, their own mean and spread can be measured and the archive re-centred
properly, without asking anyone to upload anything twice.

`0.7` in `sift.js` is the least defensible number in the piece. It is fitted to
sixty-nine plates and the correct value drifts as the archive's proportions
drift. It is one named constant, and the leave-one-out test that justifies it
is worth re-running once the given plates outnumber the founding ones.
