# -*- coding: utf-8 -*-
"""将 fields.json 同步为 fields-data.js（供 field-manager.html 直接双击打开时加载）"""
import json
from pathlib import Path

root = Path(__file__).parent
data = json.loads((root / "fields.json").read_text(encoding="utf-8"))
(root / "fields-data.js").write_text(
    "window.FIELD_DICTIONARY = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n",
    encoding="utf-8",
)
print(f"OK: {len(data)} fields -> fields-data.js")
