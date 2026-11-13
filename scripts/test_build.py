#!/usr/bin/env python3
"""A build sorrendje, a jobb fal fordítása és a path átadása, kis képekkel."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

import build


def write_jpeg(path: Path, size: tuple[int, int], color: tuple[int, int, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(path, "JPEG", quality=80)


class BuildTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        site = self.root / "site"
        (site / "images").mkdir(parents=True)
        (site / "index.html").write_text("<!DOCTYPE html><title>Aluljáró</title>\n", encoding="utf-8")
        (site / "styles.css").write_text("body{}\n", encoding="utf-8")
        (site / "app.js").write_text(
            "edition: Math.max(0, data.editions.length - 1),\n",
            encoding="utf-8",
        )
        (site / "site.yml").write_text(
            (build.ROOT / "site" / "site.yml").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        (site / "images" / "favicon.svg").write_text("<svg></svg>\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def add_visit(self, date: str, files: dict[str, tuple[int, int]], meta: str | None = None) -> None:
        folder = self.root / "latitasok" / date
        folder.mkdir(parents=True)
        for name, size in files.items():
            write_jpeg(folder / name, size, (20, 40, 60))
        if meta is not None:
            (folder / "bejaras.yml").write_text(meta, encoding="utf-8")

    def tunnel(self) -> dict:
        dist = build.build_site(self.root)
        text = (dist / "data.js").read_text(encoding="utf-8")
        payload = text.split("window.TUNNEL = ", 1)[1].rstrip().removesuffix(";")
        return json.loads(payload)

    def test_order_reverse_wall_and_path(self) -> None:
        self.add_visit(
            "2026-11-12",
            {"BAL_1.jpg": (60, 2800), "JOBB_1.jpg": (10, 10)},
            'date: "2026-11-12"\nnote: "Újabb."\n',
        )
        self.add_visit(
            "2026-01-02",
            {
                "BAL_1.jpg": (12, 20),
                "BAL_3.jpg": (12, 20),
                "JOBB_1.jpg": (12, 20),
                "JOBB_2.jpg": (12, 40),
            },
            """
date: "2026-01-02"
note: "Régebbi."
images:
  JOBB_2:
    path:
      - [2, 74]
      - [97, 26]
    scale: 2
""",
        )
        data = self.tunnel()
        self.assertEqual([item["date"] for item in data["editions"]], ["2026-01-02", "2026-11-12"])
        older = data["editions"][0]
        self.assertEqual(older["label"], "2026. január 2.")
        self.assertEqual(older["note"], "Régebbi.")
        self.assertEqual(
            older["images"]["left"],
            [
                "images/editions/2026-01-02/left-1.jpg",
                "images/editions/2026-01-02/left-3.jpg",
            ],
        )
        right = older["images"]["right"]
        self.assertEqual(right[0]["src"], "images/editions/2026-01-02/right-2.jpg")
        self.assertEqual(right[0]["path"], [[2, 74], [97, 26]])
        self.assertEqual(right[0]["scale"], 2)
        self.assertEqual(right[1], "images/editions/2026-01-02/right-1.jpg")
        newer = data["editions"][1]
        self.assertEqual(newer["label"], "2026. november 12.")
        self.assertEqual(newer["note"], "Újabb.")
        # 60×2800 kicsinyítve 1400 magas, a szélesség arányos.
        with Image.open(self.root / "dist/images/editions/2026-11-12/left-1.jpg") as image:
            self.assertEqual(image.size, (30, 1400))
        # A 10 px magas kép nem lesz felnagyítva.
        with Image.open(self.root / "dist/images/editions/2026-11-12/right-1.jpg") as image:
            self.assertEqual(image.size, (10, 10))
        self.assertEqual(data["walls"][0]["label"], "Bal oldal")
        self.assertEqual(data["site"]["title"], "Aluljáró")
        app = (build.ROOT / "site" / "app.js").read_text(encoding="utf-8")
        self.assertIn("data.editions.length - 1", app)

    def test_date_mismatch_and_missing_photo(self) -> None:
        self.add_visit("2026-11-12", {"BAL_1.jpg": (8, 8)}, 'date: "2026-11-13"\n')
        with self.assertRaises(build.BuildError):
            build.build_site(self.root)

    def test_unknown_image_key(self) -> None:
        self.add_visit(
            "2026-11-12",
            {"BAL_1.jpg": (8, 8)},
            "images:\n  BAL_9:\n    path:\n      - [0, 0]\n      - [1, 1]\n",
        )
        with self.assertRaises(build.BuildError):
            build.build_site(self.root)

    def test_visit_without_metadata_uses_the_folder_date(self) -> None:
        self.add_visit("2026-03-08", {"JOBB_4.jpg": (8, 8), "JOBB_1.jpg": (8, 8)})
        data = self.tunnel()
        edition = data["editions"][0]
        self.assertEqual(edition["date"], "2026-03-08")
        self.assertEqual(edition["label"], "2026. március 8.")
        self.assertEqual(edition["note"], "")
        self.assertEqual(
            edition["images"]["right"],
            [
                "images/editions/2026-03-08/right-4.jpg",
                "images/editions/2026-03-08/right-1.jpg",
            ],
        )
        self.assertEqual(edition["images"]["left"], [])


if __name__ == "__main__":
    unittest.main()
