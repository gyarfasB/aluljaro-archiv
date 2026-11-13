#!/usr/bin/env python3
"""Összerakja a dist/ oldalt a latitasok/ bejárásokból és a site/ vázból.

A panorámák a jóváhagyott lap méretére kerülnek: 1400 px magas, 4:4:4 JPEG,
minőség 82. Ennél nem nagyobbat a lap nem kér; külön mobil falkép nincs.
A fejléc 1000/2000-es képe statikus, azt csak másoljuk.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import shutil
import sys
from pathlib import Path

import yaml
from PIL import Image, ImageOps, UnidentifiedImageError

# A JOBB_2 nagyjából 195 megapixel. A határ efölött van, de egy hibás fájl
# még mindig megáll.
Image.MAX_IMAGE_PIXELS = 500_000_000

ROOT = Path(__file__).resolve().parents[1]
WEB_HEIGHT = 1400
JPEG_QUALITY = 82

MONTHS = [
    "január",
    "február",
    "március",
    "április",
    "május",
    "június",
    "július",
    "augusztus",
    "szeptember",
    "október",
    "november",
    "december",
]

DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
PHOTO_RE = re.compile(r"^(BAL|JOBB)_(\d+)\.jpe?g$", re.IGNORECASE)
META_NAMES = ("bejaras.yml", "bejaras.yaml", "bejaras.json")
SHELL_FILES = ("index.html", "styles.css", "app.js")
SITE_KEYS = ("title", "eyebrow", "lede", "flag", "place", "footnote")


class BuildError(Exception):
    pass


def fail(message: str) -> None:
    raise BuildError(message)


def hungarian_label(iso: str) -> str:
    year, month, day = (int(part) for part in iso.split("-"))
    return f"{year}. {MONTHS[month - 1]} {day}."


def parse_date(value: object, label: str) -> str:
    if isinstance(value, dt.datetime):
        value = value.date()
    if isinstance(value, dt.date):
        value = value.isoformat()
    text = str(value).strip()
    match = DATE_RE.fullmatch(text)
    if not match:
        fail(f"{label}: a dátum ÉÉÉÉ-HH-NN legyen, nem „{value}”.")
    year, month, day = (int(part) for part in match.groups())
    try:
        dt.date(year, month, day)
    except ValueError:
        fail(f"{label}: nincs ilyen nap ({text}).")
    return text


def normalize_photo_key(key: object, label: str) -> str:
    name = str(key).strip()
    lower = name.lower()
    if lower.endswith(".jpeg"):
        name = name[:-5]
    elif lower.endswith(".jpg"):
        name = name[:-4]
    match = re.fullmatch(r"(BAL|JOBB)_(\d+)", name, re.IGNORECASE)
    if not match:
        fail(f"{label}: ismeretlen képkulcs: {key}. BAL_3 vagy JOBB_2.jpg lehet.")
    return f"{match.group(1).upper()}_{int(match.group(2))}"


def as_number(value: object, label: str) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail(f"{label}: szám kell, nem {value!r}.")
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def parse_path(value: object, label: str) -> list[list[int | float]]:
    if not isinstance(value, list) or len(value) < 2:
        fail(f"{label}: a path legalább két [x, y] pont legyen.")
    points: list[list[int | float]] = []
    for index, point in enumerate(value, start=1):
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            fail(f"{label}: a path {index}. pontja nem [x, y].")
        x = as_number(point[0], f"{label}, x")
        y = as_number(point[1], f"{label}, y")
        points.append([x, y])
    return points


def load_metadata(folder: Path) -> dict:
    found = [folder / name for name in META_NAMES if (folder / name).is_file()]
    if len(found) > 1:
        names = ", ".join(path.name for path in found)
        fail(f"{folder.name}: több leíró fájl van ({names}). Egy elég.")
    if not found:
        return {}
    path = found[0]
    raw_text = path.read_text(encoding="utf-8")
    if path.suffix == ".json":
        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            fail(f"{folder.name}/{path.name}: hibás JSON ({exc}).")
    else:
        try:
            data = yaml.safe_load(raw_text)
        except yaml.YAMLError as exc:
            fail(f"{folder.name}/{path.name}: hibás YAML ({exc}).")
    if data is None:
        return {}
    if not isinstance(data, dict):
        fail(f"{folder.name}/{path.name}: a tartalom egy objektum legyen.")
    return data


def visit_record(folder: Path) -> dict:
    iso = parse_date(folder.name, folder.name)
    meta = load_metadata(folder)
    if "date" in meta and meta["date"] is not None:
        meta_date = parse_date(meta["date"], f"{folder.name} date")
        if meta_date != iso:
            fail(
                f"{folder.name}: a date ({meta_date}) nem egyezik a mappa nevével."
            )
    note = meta.get("note") or ""
    if not isinstance(note, str):
        fail(f"{folder.name}: a note szöveg legyen.")

    images_meta = meta.get("images") or {}
    if not isinstance(images_meta, dict):
        fail(f"{folder.name}: az images objektum legyen, a fájlnév a kulcs.")
    parsed_images: dict[str, dict] = {}
    for key, spec in images_meta.items():
        photo_key = normalize_photo_key(key, folder.name)
        if photo_key in parsed_images:
            fail(f"{folder.name}: a {photo_key} kétszer szerepel.")
        if not isinstance(spec, dict):
            fail(f"{folder.name} {photo_key}: a path egy path: lista alatt legyen.")
        unknown = set(spec) - {"path", "scale"}
        if unknown:
            fail(f"{folder.name} {photo_key}: ismeretlen mező: {', '.join(sorted(unknown))}.")
        parsed: dict = {}
        if "path" in spec:
            parsed["path"] = parse_path(spec["path"], f"{folder.name} {photo_key}")
        if "scale" in spec:
            scale = as_number(spec["scale"], f"{folder.name} {photo_key} scale")
            if not isinstance(scale, (int, float)) or scale <= 0:
                fail(f"{folder.name} {photo_key}: a scale legyen pozitív szám.")
            parsed["scale"] = scale
        if not parsed:
            fail(f"{folder.name} {photo_key}: üres bejegyzés. Kell path vagy scale.")
        parsed_images[photo_key] = parsed

    photos = discover_photos(folder)
    known = {f"{side}_{num}" for side, num, _path in photos}
    missing = sorted(set(parsed_images) - known)
    if missing:
        fail(f"{folder.name}: nincs ilyen kép a mappában: {', '.join(missing)}.")

    return {
        "id": iso,
        "date": iso,
        "label": hungarian_label(iso),
        "note": note,
        "photos": photos,
        "images_meta": parsed_images,
    }


def discover_photos(folder: Path) -> list[tuple[str, int, Path]]:
    photos: list[tuple[str, int, Path]] = []
    seen: dict[str, str] = {}
    for path in sorted(folder.iterdir(), key=lambda item: item.name):
        if path.name.startswith("."):
            continue
        if path.name.lower() in META_NAMES:
            continue
        if not path.is_file():
            fail(f"{folder.name}/{path.name}: csak képfájl kerülhet a bejárás mappájába.")
        match = PHOTO_RE.fullmatch(path.name)
        if not match:
            fail(
                f"{folder.name}/{path.name}: a név BAL_1.jpg vagy JOBB_2.jpg alakú legyen."
            )
        side = match.group(1).upper()
        number = int(match.group(2))
        key = f"{side}_{number}"
        if key in seen:
            fail(f"{folder.name}: a {key} kétszer van ({seen[key]} és {path.name}).")
        seen[key] = path.name
        photos.append((side, number, path))
    if not photos:
        fail(f"{folder.name}: nincs BAL_ vagy JOBB_ panoráma.")
    return photos


def load_visits(root: Path) -> list[dict]:
    visits_dir = root / "latitasok"
    if not visits_dir.is_dir():
        fail("Hiányzik a latitasok/ mappa.")
    folders = []
    for path in sorted(visits_dir.iterdir(), key=lambda item: item.name):
        if path.name.startswith("."):
            continue
        if not path.is_dir():
            fail(
                f"latitasok/{path.name}: a képek egy dátumos mappába kerüljenek, "
                "például latitasok/2026-11-12/."
            )
        if not DATE_RE.fullmatch(path.name):
            fail(f"latitasok/{path.name}: a mappa neve ÉÉÉÉ-HH-NN legyen.")
        folders.append(path)
    if not folders:
        fail("A latitasok/ mappában nincs egyetlen bejárás sem.")
    visits = [visit_record(folder) for folder in folders]
    visits.sort(key=lambda visit: visit["date"])
    return visits


def load_site(root: Path) -> tuple[dict, list[dict]]:
    path = root / "site" / "site.yml"
    if not path.is_file():
        fail("Hiányzik a site/site.yml.")
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        fail(f"site/site.yml: hibás YAML ({exc}).")
    if not isinstance(raw, dict):
        fail("site/site.yml: a tartalom egy objektum legyen.")
    for key in ("title", "eyebrow", "lede", "place", "footnote", "walls"):
        if key not in raw:
            fail(f"site/site.yml: hiányzik a {key}.")
    footnote = raw["footnote"]
    if not isinstance(footnote, dict) or not {"prefix", "text", "href"} <= set(footnote):
        fail("site/site.yml: a footnote prefix, text és href mezőt kér.")
    walls_raw = raw["walls"]
    if not isinstance(walls_raw, list) or not walls_raw:
        fail("site/site.yml: a walls legalább egy fal legyen.")
    walls = []
    for wall in walls_raw:
        if not isinstance(wall, dict) or "id" not in wall or "label" not in wall:
            fail("site/site.yml: minden falnak kell id és label.")
        walls.append({"id": wall["id"], "label": wall["label"]})
    ids = [wall["id"] for wall in walls]
    if ids != ["left", "right"]:
        fail("site/site.yml: a falak sorrendje left, majd right legyen.")
    site = {}
    for key in SITE_KEYS:
        if key in raw:
            site[key] = raw[key]
    for key, value in raw.items():
        if key not in site and key != "walls":
            site[key] = value
    return site, walls


def image_entry(src: str, spec: dict | None) -> str | dict:
    if not spec:
        return src
    entry: dict = {"src": src}
    if "path" in spec:
        entry["path"] = spec["path"]
    if "scale" in spec:
        entry["scale"] = spec["scale"]
    return entry


def resize_panorama(src: Path, dest: Path) -> tuple[int, int]:
    try:
        with Image.open(src) as opened:
            image = ImageOps.exif_transpose(opened)
            image = image.convert("RGB")
            width, height = image.size
            if height > WEB_HEIGHT:
                new_h = WEB_HEIGHT
                new_w = int(width * WEB_HEIGHT / height + 0.5)
                image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
            else:
                new_w, new_h = width, height
            dest.parent.mkdir(parents=True, exist_ok=True)
            image.save(
                dest,
                "JPEG",
                quality=JPEG_QUALITY,
                subsampling=0,
                optimize=True,
                progressive=True,
            )
    except Image.DecompressionBombError:
        fail(f"{src.name} túl nagy a kicsinyítéshez.")
    except UnidentifiedImageError:
        fail(f"{src.name} nem olvasható JPEG.")
    return new_w, new_h


def copy_shell(root: Path, dist: Path) -> None:
    site = root / "site"
    for name in SHELL_FILES:
        source = site / name
        if not source.is_file():
            fail(f"Hiányzik a site/{name}.")
        shutil.copy2(source, dist / name)
    images = site / "images"
    if not images.is_dir():
        fail("Hiányzik a site/images mappa.")
    shutil.copytree(images, dist / "images")
    # Unlisted helper. The exhibition pages do not link to it.
    helper = site / "kicsinyito"
    if helper.is_dir():
        shutil.copytree(helper, dist / "kicsinyito")


def publish_visit(visit: dict, dist: Path) -> dict:
    out_dir = dist / "images" / "editions" / visit["id"]
    left: list[tuple[int, str | dict]] = []
    right: list[tuple[int, str | dict]] = []
    for side, number, source in visit["photos"]:
        leaf = "left" if side == "BAL" else "right"
        filename = f"{leaf}-{number}.jpg"
        dest = out_dir / filename
        width, height = resize_panorama(source, dest)
        print(f"  {visit['id']}/{source.name} → {filename} ({width}×{height})", flush=True)
        web_src = f"images/editions/{visit['id']}/{filename}"
        entry = image_entry(web_src, visit["images_meta"].get(f"{side}_{number}"))
        (left if side == "BAL" else right).append((number, entry))
    # Bal fal: bejárattól a kijáratig. Jobb fal: fordítva, ahogy a lap mutatja.
    left.sort(key=lambda item: item[0])
    right.sort(key=lambda item: item[0], reverse=True)
    return {
        "id": visit["id"],
        "date": visit["date"],
        "label": visit["label"],
        "note": visit["note"],
        "images": {
            "left": [entry for _number, entry in left],
            "right": [entry for _number, entry in right],
        },
    }


def write_data(dist: Path, site: dict, walls: list[dict], editions: list[dict]) -> None:
    payload = {"site": site, "walls": walls, "editions": editions}
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    text = (
        "/* Generált fájl: a scripts/build.py írja a latitasok/ mappákból.\n"
        "   Ne szerkeszd kézzel. A legrégebbi bejárás van elöl; a lap a legújabbat nyitja meg. */\n"
        f"window.TUNNEL = {body};\n"
    )
    (dist / "data.js").write_text(text, encoding="utf-8")


def build_site(root: Path | None = None) -> Path:
    root = Path(root) if root is not None else ROOT
    dist = root / "dist"
    if dist.exists():
        shutil.rmtree(dist)
    dist.mkdir(parents=True)
    site, walls = load_site(root)
    visits = load_visits(root)
    copy_shell(root, dist)
    print("Bejárások (legrégebbi elöl, a lap a legújabbat nyitja):", flush=True)
    editions = []
    for visit in visits:
        edition = publish_visit(visit, dist)
        editions.append(edition)
        print(
            f"  {edition['date']}  bal: {len(edition['images']['left'])}  "
            f"jobb: {len(edition['images']['right'])}",
            flush=True,
        )
    write_data(dist, site, walls, editions)
    print(f"Kész: {dist}", flush=True)
    return dist


def main() -> int:
    try:
        build_site()
    except BuildError as exc:
        print(f"Hiba: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
