#!/usr/bin/env python3
"""data_src/*.txt を解析して data.js（window.EC_DATA）を生成する。

書式（1行1要素）:
  # ...                       コメント
  @L 番号 | タイトル          Lecture の開始
  @pg ページ                 以降の要素の掲載ページ
  @E ID | 出典 | 日本語       表現の開始
  = 英語形                   表現の英語形（複数可）
  ! 注意                     表現の注意書き（複数可）
  x 誤り                     表現の誤用例（複数可）
  @S 出典 | 日本文            例文の開始
  > 英文                     例文の英文（複数可）
  ~ ID : 断片 ; 断片          例文が使っている表現と、英文中の該当箇所
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data_src"
OUT = ROOT / "data.js"

# 原則番号 → Lecture（本文の目次から。62〜70 は本文スキャンがないため「その他」）
PRINCIPLE_LECTURE = [
    (1, 11, "01"), (12, 18, "02"), (19, 25, "03"), (26, 33, "04"), (34, 39, "05"),
    (40, 47, "06"), (48, 55, "07"), (56, 61, "08"), (62, 63, "09"), (64, 70, "10"),
]
EXTRA_LECTURES = []

# 本の原則（P）→ まとめの行（R）。対応する行に解説・誤用・例文を統合する。
# ここにない P は単独の原則カードとして残る。
MERGE = {
    "P1-1": "R1-1", "P1-2": "R1-3", "P2-1": "R2-1", "P2-2": "R2-2",
    "P3-1": "R3-1", "P3-2": "R3-2", "P3-3": "R3-3",
    "P4-1": "R4-1", "P4-2": "R4-2", "P4-3": "R4-3",
    "P5-1": "R5-1", "P5-2": "R5-2", "P5-3": "R5-3",
    "P6-1": "R6-1", "P6-2": "R6-1", "P6-3": "R6-2", "P6-4": "R6-3",
    "P7-1": "R7-1", "P7-2": "R7-3",
    "P8-1": "R8-1", "P8-2": "R8-2", "P8-3": "R8-3", "P8-4": "R8-4",
    "P9-1": "R9-1", "P9-2": "R9-2", "P10-1": "R10-1", "P10-2": "R10-1",
    "P11-1": "R11-1", "P11-2": "R11-2", "P11-3": "R11-3", "P11-4": "R11-4", "P11-5": "R11-5",
    "P12-1": "R12-1", "P12-2": "R12-2",
    "P13-1": "R13-1", "P13-2": "R13-3", "P13-3": "R13-2",
    "P14-1": "R14-1", "P14-2": "R14-1", "P14-3": "R14-2", "P14-4": "R14-3",
    "P15-1": "R15-1", "P15-2": "R15-2", "P15-3": "R15-3", "P15-4": "R15-4",
    "P16-1": "R16-1", "P16-2": "R16-3",
    "P17-1": "R17-2", "P17-2": "R17-1", "P17-3": "R17-1",
    "P18-1": "R18-1", "P18-2": "R18-2", "P19-1": "R19-1", "P19-2": "R19-2",
    "P20-1": "R20-1", "P20-2": "R20-2",
    "P21-1": "R21-1", "P21-2": "R21-2", "P21-3": "R21-3", "P21-4": "R21-4", "P21-5": "R21-5",
    "P22-1": "R22-1", "P22-2": "R22-2", "P22-3": "R22-3", "P22-4": "R22-4", "P22-5": "R22-5",
    "P23-1": "R23-1", "P23-2": "R23-2",
    "P24-1": "R24-1", "P24-2": "R24-2", "P24-3": "R24-3", "P25-1": "R25-1", "P25-2": "R25-2",
    "P26-1": "R26-1", "P26-2": "R26-2", "P26-3": "R26-3",
    "P27-1": "R27-1", "P27-2": "R27-2", "P27-3": "R27-3", "P27-4": "R27-4",
    "P28-1": "R28-1", "P28-2": "R28-2", "P29-1": "R29-2", "P29-2": "R29-3",
    "P30-1": "R30-1", "P30-2": "R30-2", "P30-3": "R30-3",
    "P31-1": "R31-1", "P31-2": "R31-1", "P31-3": "R31-2", "P31-4": "R31-3",
    "P32-1": "R32-1", "P32-2": "R32-2", "P32-3": "R32-3",
    "P33-1": "R33-1", "P33-2": "R33-2", "P33-3": "R33-3",
    "P34-1": "R34-1", "P34-2": "R34-2", "P34-3": "R34-3", "P34-4": "R34-4",
    "P35-1": "R35-1", "P35-2": "R35-2", "P35-3": "R35-3", "P35-4": "R35-4",
    "P36-1": "R36-1", "P36-2": "R36-2", "P36-3": "R36-3", "P36-4": "R36-4",
    "P37-1": "R37-1", "P37-2": "R37-2", "P37-3": "R37-3", "P37-4": "R37-4",
    "P38-1": "R38-1", "P38-2": "R38-2", "P38-3": "R38-3",
    "P39-1": "R39-1", "P39-2": "R39-2", "P39-3": "R39-3",
    "P40-1": "R40-1", "P40-2": "R40-2", "P40-3": "R40-3",
    "P41-1": "R41-1", "P41-2": "R41-2", "P41-3": "R41-3", "P42-1": "R42-1", "P42-2": "R42-2",
    "P43-1": "R43-1", "P43-2": "R43-2", "P43-3": "R43-3",
    "P44-1": "R44-1", "P44-2": "R44-2", "P45-1": "R45-1", "P45-2": "R45-2", "P45-3": "R45-3",
    "P46-1": "R46-1", "P46-2": "R46-2", "P47-1": "R47-1", "P48-1": "R48-1", "P48-3": "R48-3",
    "P49-1": "R49-1", "P49-2": "R49-2", "P49-3": "R49-3", "P50-1": "R50-1", "P50-2": "R50-2",
    "P51-1": "R51-1", "P51-2": "R51-3", "P51-3": "R51-4", "P52-1": "R52-1", "P52-2": "R52-2",
    "P53-1": "R53-1", "P54-1": "R54-1", "P54-2": "R54-2",
    "P57-1": "R57-1", "P57-2": "R57-2", "P57-3": "R57-3", "P58-1": "R58-1", "P58-2": "R58-2", "P59-1": "R59-1", "P59-2": "R59-2", "P60-1": "R60-1", "P60-2": "R60-2", "P61-1": "R61-1", "P61-2": "R61-2", "P62-1": "R62-1", "P62-2": "R62-2", "P62-3": "R62-3", "P62-4": "R62-4", "P63-1": "R63-1", "P63-2": "R63-2", "P63-3": "R63-3", "P69-1": "R69-1", "P69-2": "R69-2", "P70-1": "R70-1", "P70-2": "R70-2", "P70-3": "R70-3", "P70-4": "R70-4",
}


def lecture_of_principle(n):
    for lo, hi, no in PRINCIPLE_LECTURE:
        if lo <= n <= hi:
            return no
    return None


def parse_principles(path):
    """原則のまとめ（@R 番号 | タイトル / 日本語 | 英語の型 | 注意）を表現として読む。"""
    out, n, title, k = {}, None, None, 0
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("@R"):
            n, title = [s.strip() for s in line[2:].split("|", 1)]
            n, k = int(n), 0
            continue
        jp, form, note = [s.strip() for s in line.split("|", 2)]
        k += 1
        exp_id = f"R{n}-{k}"
        out[exp_id] = {
            "id": exp_id, "label": f"原則{n}", "group": title, "jp": jp, "kind": "rule",
            "lecture": lecture_of_principle(n), "page": None,
            "forms": [form], "notes": [note] if note else [], "wrong": [], "book": [],
        }
    return out


def merge_book_rules(expressions, principles):
    """本の原則エントリをまとめの行へ統合し、ID の付け替え表を返す。"""
    remap = {}
    for pid, rid in MERGE.items():
        p, r = expressions.pop(pid, None), principles.get(rid)
        if not p or not r:
            continue
        r["book"].append({"label": p["label"], "page": p["page"], "jp": p["jp"],
                          "forms": p["forms"], "notes": p["notes"], "wrong": p["wrong"]})
        r["page"] = r["page"] or p["page"]
        remap[pid] = rid
    for rid, r in principles.items():
        if not r["page"]:
            del r["page"]
    return remap


def kind_of(exp_id):
    if exp_id.startswith("P"):
        return "rule"
    if exp_id.startswith("F"):
        return "phrase"
    if exp_id.startswith("C"):
        return "column"
    return "note"


def parse(files):
    lectures, expressions, sentences = [], {}, []
    errors = []
    for path in files:
        part = int(re.search(r"(\d+)", path.stem).group(1))
        lecture, page, cur = None, None, None
        for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            where = f"{path.name}:{n}"
            tag, _, rest = line.partition(" ")
            rest = rest.strip()
            if tag == "@L":
                no, title = [s.strip() for s in rest.split("|", 1)]
                lecture = no
                lectures.append({"no": no, "title": title, "part": part})
                cur = None
            elif tag == "@pg":
                page = int(rest)
            elif tag == "@E":
                exp_id, label, jp = [s.strip() for s in rest.split("|", 2)]
                if exp_id in expressions:
                    errors.append(f"{where}: 重複 ID {exp_id}")
                cur = {
                    "id": exp_id, "label": label, "jp": jp, "kind": kind_of(exp_id),
                    "lecture": lecture, "page": page, "forms": [], "notes": [], "wrong": [],
                }
                expressions[exp_id] = cur
            elif tag == "@S":
                label, jp = [s.strip() for s in rest.split("|", 1)]
                cur = {
                    "id": f"S{len(sentences) + 1}", "label": label, "jp": jp,
                    "lecture": lecture, "page": page, "en": [], "links": [],
                    "main": label.startswith("例題"),
                }
                sentences.append(cur)
            elif tag == "=" and cur and "forms" in cur:
                cur["forms"].append(rest)
            elif tag == "x" and cur and "forms" in cur:
                cur["wrong"].append(rest)
            elif tag == "!":
                target = cur if cur and "notes" in cur else None
                if target is None:
                    errors.append(f"{where}: 表現の外の注意書き")
                else:
                    target["notes"].append(rest)
            elif tag == ">" and cur and "en" in cur:
                cur["en"].append(rest)
            elif tag == "~" and cur and "links" in cur:
                exp_id, _, frags = rest.partition(":")
                cur["links"].append({
                    "exp": exp_id.strip(),
                    "frags": [f.strip() for f in frags.split(";") if f.strip()],
                    "where": where,
                })
            else:
                errors.append(f"{where}: 解釈できない行: {line[:40]}")
    return lectures, expressions, sentences, errors


def find_fragment(text, frag):
    """英文中の断片の位置（単語境界つき、大文字小文字は区別→無視の順）。"""
    pat = r"(?<![A-Za-z])" + re.escape(frag) + r"(?![A-Za-z])"
    m = re.search(pat, text) or re.search(pat, text, re.I)
    return (m.start(), m.end()) if m else None


def resolve_links(expressions, sentences, errors, remap):
    for s in sentences:
        for link in s["links"]:
            link["exp"] = remap.get(link["exp"], link["exp"])
        spans = [[] for _ in s["en"]]
        for link in s["links"]:
            if link["exp"] not in expressions:
                errors.append(f"{link['where']}: 未定義の表現 {link['exp']}")
                continue
            for frag in link["frags"]:
                hit = False
                for i, text in enumerate(s["en"]):
                    pos = find_fragment(text, frag)
                    if pos:
                        spans[i].append([pos[0], pos[1], link["exp"]])
                        hit = True
                if not hit:
                    errors.append(f"{link['where']}: 英文に見つからない断片 「{frag}」")
        s["spans"] = spans
        s["exps"] = list(dict.fromkeys(l["exp"] for l in s["links"] if l["exp"] in expressions))
        del s["links"]


def main():
    files = sorted(SRC.glob("part*.txt"))
    lectures, expressions, sentences, errors = parse(files)
    principles = parse_principles(SRC / "principles.txt")
    remap = merge_book_rules(expressions, principles)
    resolve_links({**expressions, **principles}, sentences, errors, remap)
    # 同じ Lecture 番号が複数分冊に出てくるので 1 つにまとめる
    seen, merged_lectures = set(), []
    for l in lectures + EXTRA_LECTURES:
        if l["no"] not in seen:
            seen.add(l["no"])
            merged_lectures.append(l)
    # 表示順：Lecture ごとに「原則（まとめ）→ 本の表現」
    order = {l["no"]: i for i, l in enumerate(merged_lectures)}
    rules = sorted(principles.values(), key=lambda e: (order.get(e["lecture"], 99), int(e["id"][1:].split("-")[0]), int(e["id"].split("-")[1])))
    others = list(expressions.values())
    all_exps = []
    for l in merged_lectures:
        all_exps += [e for e in rules if e["lecture"] == l["no"]]
        all_exps += [e for e in others if e["lecture"] == l["no"]]
    data = {
        "lectures": merged_lectures,
        "expressions": all_exps,
        "sentences": sentences,
    }
    OUT.write_text(
        "window.EC_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"lectures={len(merged_lectures)} expressions={len(all_exps)} (原則 {len(rules)}) sentences={len(sentences)}")
    for e in errors:
        print("WARN", e)
    return 1 if errors and "--strict" in sys.argv else 0


if __name__ == "__main__":
    sys.exit(main())
