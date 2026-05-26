# -*- coding: utf-8 -*-
"""将 fields.json 同步为 fields-data.js（与线上保存 API 一致）"""
import json
from pathlib import Path

here = Path(__file__).resolve().parent
data = json.loads((here / "fields.json").read_text(encoding="utf-8"))
(here / "fields-data.js").write_text(
    "window.FIELD_DICTIONARY = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n",
    encoding="utf-8",
)
print(f"OK: {len(data)} fields -> {here / 'fields-data.js'}")
