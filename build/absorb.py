#!/usr/bin/env python3
"""
absorb.py — the point at which a contribution stops being a guest.

The browser can hold 256 given plates in its second atlas and no more; past
that the sheet is full and new pictures are refused a slot. This bakes what
has been given into `assets/atlas.jpg` + `assets/atlas.json` — the optional
wall that ships with the page — so those plates load with the site like any
published one, and the sheet is empty again.

There need not be a wall already. If `assets/atlas.jpg` is absent this makes
the first one; if it is present the given plates are appended to it.

What it does not touch is `assets/founding.json`. That file is the ruler and
the seven voters — the criteria a stranger's picture is sorted by — and it is
deliberately held still while the wall changes, so absorbing does not silently
move where every future contribution lands.

It reads the archive with the *anon* key out of config.js, which is all that is
needed, because reading is what anon is for. It writes nothing back: marking
the absorbed rows is one UPDATE, printed at the end for you to run yourself.

    cd commons/build
    python absorb.py --dry-run      # say what it would do, touch nothing
    python absorb.py

Needs Pillow:  python -m pip install pillow
"""

import argparse
import base64
import io
import json
import math
import os
import re
import sys
import urllib.request

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "assets")

LAYERS = ["self", "other", "coll"]
TILE_MAX = 320        # matches ../../cloud/build/rebuild.py
TILE_MIN = 128
ATLAS_MAX = 4096      # the weakest GPU worth supporting


def read_config():
    """Take the project URL and anon key straight out of config.js rather than
    asking for them again — there is one place they are written down."""
    src = open(os.path.join(ROOT, "config.js"), encoding="utf-8").read()
    url = re.search(r"url:\s*'([^']*)'", src)
    key = re.search(r"anonKey:\s*'([^']*)'", src)
    if not url or not key or not url.group(1) or not key.group(1):
        sys.exit("config.js has no url/anonKey yet — fill it in first.")
    return url.group(1).rstrip("/"), key.group(1)


def fetch(url, key):
    cols = "id,created_at,thumb,ar,aff,method,title"
    out, offset = [], 0
    while True:
        req = urllib.request.Request(
            "%s/rest/v1/contributions?select=%s&order=created_at.asc&offset=%d&limit=200"
            % (url, cols, offset),
            headers={"apikey": key, "Authorization": "Bearer " + key},
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            page = json.load(r)
        out += page
        if len(page) < 200:
            return out
        offset += 200


def existing_wall():
    """(list of (PIL image, metadata)) for whatever already ships with the page."""
    man_p = os.path.join(ASSETS, "atlas.json")
    img_p = os.path.join(ASSETS, "atlas.jpg")
    if not (os.path.exists(man_p) and os.path.exists(img_p)):
        return []
    man = json.load(open(man_p, encoding="utf-8"))
    sheet = Image.open(img_p).convert("RGB")
    out = []
    for it in man.get("items", []):
        u, v, du, dv = it["uv"]
        box = (round(u * sheet.width), round(v * sheet.height),
               round((u + du) * sheet.width), round((v + dv) * sheet.height))
        meta = {k: it[k] for k in ("src", "title", "kind", "aff") if k in it}
        out.append((sheet.crop(box), meta))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    wall = existing_wall()
    print("already on the wall : %d plates" % len(wall))

    url, key = read_config()
    rows = fetch(url, key)
    print("given since         : %d" % len(rows))
    if not rows:
        print("nothing to absorb.")
        return

    plates = list(wall)
    for r in rows:
        try:
            b64 = r["thumb"].split(",", 1)[1]
            im = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
        except Exception as e:
            print("  ! skipping %s: %s" % (r["id"], e))
            continue
        aff = [float(x) for x in r["aff"]]
        plates.append((im, dict(
            src="given/%s" % r["id"][:8],
            title=r.get("title") or "given",
            kind=r.get("title") or "unsorted",
            aff=[round(x, 4) for x in aff],
        )))

    n = len(plates)
    cols = max(1, math.ceil(math.sqrt(n)))
    tile = min(TILE_MAX, ATLAS_MAX // cols)
    if tile < TILE_MIN:
        print("\n!! %d plates at ATLAS_MAX=%d gives %d px tiles — they will look soft\n"
              "   when they scale up in the core. Thin the wall, or raise ATLAS_MAX\n"
              "   and check MAX_TEXTURE_SIZE on the machines you care about."
              % (n, ATLAS_MAX, tile))
    rows_n = (n + cols - 1) // cols
    print("new wall            : %d plates, %d cols at %d px -> %dx%d"
          % (n, cols, tile, cols * tile, rows_n * tile))

    if args.dry_run:
        print("\n--dry-run: nothing written.")
        return

    sheet = Image.new("RGB", (cols * tile, rows_n * tile), (255, 255, 255))
    items = []
    for i, (im, meta) in enumerate(plates):
        im = im.copy()
        im.thumbnail((tile, tile), Image.LANCZOS)
        w, h = im.size
        cx, cy = (i % cols) * tile, (i // cols) * tile
        ox, oy = (tile - w) // 2, (tile - h) // 2
        sheet.paste(im, (cx + ox, cy + oy))
        aff = meta.get("aff") or [0.33, 0.33, 0.34]
        items.append(dict(
            i=i,
            src=meta.get("src", "plate/%d" % i),
            title=meta.get("title", ""),
            kind=meta.get("kind", "unsorted"),
            aff=aff,
            chamber=LAYERS[max(range(3), key=lambda k: aff[k])],
            uv=[round((cx + ox) / sheet.width, 6), round((cy + oy) / sheet.height, 6),
                round(w / sheet.width, 6), round(h / sheet.height, 6)],
            ar=round(w / h, 4),
        ))

    # the previous pair is kept beside the new one; this is not reversible
    for name in ("atlas.jpg", "atlas.json"):
        p = os.path.join(ASSETS, name)
        if os.path.exists(p):
            os.replace(p, p + ".before-absorb")

    sheet.save(os.path.join(ASSETS, "atlas.jpg"), "JPEG",
               quality=84, optimize=True, progressive=True)
    with open(os.path.join(ASSETS, "atlas.json"), "w", encoding="utf-8") as fh:
        json.dump(dict(atlasSize=[sheet.width, sheet.height], tile=tile,
                       cols=cols, count=n, layers=LAYERS,
                       kinds=sorted({it["kind"] for it in items}),
                       items=items),
                  fh, separators=(",", ":"))

    kb = os.path.getsize(os.path.join(ASSETS, "atlas.jpg")) // 1024
    print("wrote               : assets/atlas.jpg (%d kB) + assets/atlas.json" % kb)
    if wall:
        print("previous pair kept as *.before-absorb")

    ids = ",".join("'%s'" % r["id"] for r in rows)
    print("\nCommit the new assets, then run this once in the SQL editor so the same\n"
          "pictures do not arrive a second time on top of the wall:\n\n"
          "  update public.contributions set absorbed = true\n"
          "   where id in (%s);\n" % ids)


if __name__ == "__main__":
    main()
