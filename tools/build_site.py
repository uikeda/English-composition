#!/usr/bin/env python3
"""app/ のソースから index.html（リポジトリ用）と dist/artifact.html（単一ファイル版）を作る。"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
TITLE = "英作文 表現ノート"
FONTS = ("https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400"
         "&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=Zen+Old+Mincho:wght@400;700&display=swap")


def main():
    subprocess.run([sys.executable, str(ROOT / "tools" / "build_data.py")], check=True)
    body = (APP / "body.html").read_text(encoding="utf-8")
    css = (APP / "style.css").read_text(encoding="utf-8")
    js = (APP / "app.js").read_text(encoding="utf-8")
    data = (ROOT / "data.js").read_text(encoding="utf-8")

    index = f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{TITLE}</title>
<link rel="stylesheet" href="{FONTS}">
<link rel="stylesheet" href="app/style.css">
</head>
<body>
{body}
<script src="data.js"></script>
<script src="app/app.js"></script>
</body>
</html>
"""
    (ROOT / "index.html").write_text(index, encoding="utf-8")

    artifact = f"""<title>{TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="{FONTS}">
<style>
{css}
</style>
{body}
<script>
{data}
</script>
<script>
{js}
</script>
"""
    (ROOT / "dist").mkdir(exist_ok=True)
    (ROOT / "dist" / "artifact.html").write_text(artifact, encoding="utf-8")
    print("wrote index.html, dist/artifact.html")


if __name__ == "__main__":
    main()
