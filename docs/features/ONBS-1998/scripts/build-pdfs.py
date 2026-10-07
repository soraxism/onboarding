# -*- coding: utf-8 -*-
"""ONBS-1998 の Markdown ドキュメントを PDF 化する（ISMS 資料・配布用）

実行:
    python3 -m venv .venv && .venv/bin/pip install markdown
    .venv/bin/python docs/features/ONBS-1998/scripts/build-pdfs.py

Markdown → スタイル付き HTML → Chrome のヘッドレス印刷で PDF を作る。
出力先は docs/features/ONBS-1998/pdf/。内容を変えるときは Markdown を直して再実行する。
振り返りシートは xlsx が正のため対象外。
"""
import os
import re
import subprocess
import tempfile
import markdown

BASE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUTDIR = os.path.join(BASE, "pdf")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# (Markdown ファイル, PDF 名, 表紙の副題, 取扱区分)
DOCS = [
    ("README.md", "00_訓練の概要と準備.pdf",
     "資料の構成・実施設定・事前準備", "社内資料"),
    ("2026-09-07_incident-drill-facilitator-script.md", "01_ファシリテーター用進行台本.pdf",
     "準備から当日の進行・振り返りまでの手順", "取扱注意 ／ ファシリテーターのみ"),
    ("2026-09-07_incident-drill-slack-inject.md", "02_Slack投入用テキスト.pdf",
     "当日 Slack へ投稿する文面集（コピー用）", "取扱注意 ／ ファシリテーターのみ"),
    ("2026-09-07_incident-drill-handout.md", "03_参加者配布資料.pdf",
     "訓練で扱った論点の解説と、押さえておきたい法令の要点", "参加者へ配布可 ／ 訓練終了後"),
    ("2026-10-02_drill-report.md", "04_訓練実施報告.pdf",
     "実施結果・よくできていたこと・見つかった空白", "参加者へ配布可 ／ ISMS記録"),
    ("2026-10-02_drill-record.md", "05_訓練実施記録.pdf",
     "時系列・測定結果・投票結果", "ISMS記録"),
    ("2026-10-02_audit-submission.md", "06_ISMS審査_提出資料一覧.pdf",
     "提出資料の一覧・実施概要・主な結果・今後の対応", "ISMS審査 提出用"),
    ("2026-10-06_incident-response-flow.md", "07_インシデント対応フロー_ドラフト.pdf",
     "フェーズ別の対応手順・役割別チェックリスト・要決定事項", "ドラフト ／ レビュー用"),
]

# PDF 版では、Markdown へのリンク・言及を PDF のファイル名に置き換える
PDF_NAMES = {
    "README.md": "00_訓練の概要と準備.pdf",
    "2026-09-07_incident-drill-facilitator-script.md": "01_ファシリテーター用進行台本.pdf",
    "2026-09-07_incident-drill-slack-inject.md": "02_Slack投入用テキスト.pdf",
    "2026-09-07_incident-drill-handout.md": "03_参加者配布資料.pdf",
    "2026-10-02_drill-report.md": "04_訓練実施報告.pdf",
    "2026-10-02_drill-record.md": "05_訓練実施記録.pdf",
    "2026-10-02_audit-submission.md": "06_ISMS審査_提出資料一覧.pdf",
    "2026-10-06_incident-response-flow.md": "07_インシデント対応フロー_ドラフト.pdf",
}
# PDF 版に載せない行（Markdown の原稿そのものを指す行）
DROP_LINE_IF = "2026-09-07_incident-drill-retrospective-sheet.md]("


def to_pdf_refs(text, self_md):
    """Markdown 内のファイル参照を PDF 版の名前へ置き換える"""
    text = "\n".join(l for l in text.split("\n") if DROP_LINE_IF not in l)

    def link(m):
        label, target = m.group(1), m.group(2).lstrip("./")
        if target in PDF_NAMES:
            name = PDF_NAMES[target]
            return name + "（本書）" if target == self_md else name
        if target.endswith(".xlsx"):
            return os.path.basename(target)
        return label

    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, text)
    for md_name, pdf_name in PDF_NAMES.items():
        text = text.replace("`" + md_name + "`", pdf_name).replace(md_name, pdf_name)
    return text


CSS = """
@page { size: A4; margin: 18mm 15mm 20mm 15mm;
  @bottom-center { content: counter(page); } }
* { box-sizing: border-box; }
body { font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
  font-size: 9.6pt; line-height: 1.75; color: #1a1a1a; margin: 0; }
.cover { border-bottom: 3px solid #1F3864; padding-bottom: 14px; margin-bottom: 22px; }
.cover .ticket { font-size: 8.5pt; letter-spacing: .14em; color: #305496; font-weight: 700; }
.cover h1 { font-size: 19pt; margin: 0 0 6px; color: #1F3864; line-height: 1.35; }
.cover .sub { font-size: 10.5pt; color: #444; margin-bottom: 10px; }
.cover .tags { font-size: 8.5pt; color: #555; }
.cover .tag { display: inline-block; border: 1px solid #adb5bd; border-radius: 3px;
  padding: 2px 8px; margin-right: 6px; }
.cover .tag.warn { border-color: #c0392b; color: #c0392b; font-weight: 700; }
h1 { font-size: 15pt; color: #1F3864; border-bottom: 2px solid #D9E2F3;
  padding-bottom: 5px; margin: 26px 0 12px; page-break-after: avoid; }
h2 { font-size: 13pt; color: #1F3864; border-left: 5px solid #305496; padding-left: 9px;
  margin: 22px 0 10px; page-break-after: avoid; }
h3 { font-size: 11.2pt; color: #22364f; margin: 17px 0 8px; page-break-after: avoid; }
h4 { font-size: 10.2pt; color: #22364f; margin: 14px 0 6px; page-break-after: avoid; }
p { margin: 7px 0; }
ul, ol { margin: 7px 0 7px 1.25em; padding-left: .6em; }
li { margin: 3px 0; }
strong { color: #10263f; }
code { font-family: "SF Mono", Menlo, monospace; font-size: 8.6pt;
  background: #f1f3f5; padding: 1px 4px; border-radius: 3px; }
pre { background: #f8f9fa; border: 1px solid #dee2e6; border-left: 4px solid #305496;
  border-radius: 4px; padding: 10px 12px; margin: 10px 0; overflow-wrap: break-word;
  white-space: pre-wrap; page-break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 8.4pt; line-height: 1.6; }
blockquote { border-left: 4px solid #ffc107; background: #fffdf5; margin: 10px 0;
  padding: 7px 13px; color: #3d3d3d; page-break-inside: avoid; }
blockquote p { margin: 4px 0; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 8.8pt;
  page-break-inside: avoid; }
th { background: #1F3864; color: #fff; font-weight: 700; text-align: left;
  padding: 6px 8px; border: 1px solid #b8c4d6; }
td { padding: 5px 8px; border: 1px solid #ccd3de; vertical-align: top; }
tr:nth-child(even) td { background: #f7f9fc; }
hr { border: none; border-top: 1px solid #dee2e6; margin: 20px 0; }
a { color: #305496; text-decoration: none; }
.footer-note { margin-top: 26px; padding-top: 9px; border-top: 1px solid #dee2e6;
  font-size: 8pt; color: #777; }
"""


def build_html(md_path, subtitle, handling):
    with open(md_path, encoding="utf-8") as f:
        text = f.read()
    text = to_pdf_refs(text, os.path.basename(md_path))
    # 先頭の H1 は表紙に出すので本文からは落とす
    lines = text.split("\n")
    if lines and lines[0].startswith("# "):
        heading = lines[0][2:].strip()
        text = "\n".join(lines[1:]).lstrip("\n")
    else:
        heading = subtitle
    html_body = markdown.markdown(
        text, extensions=["tables", "fenced_code", "sane_lists", "nl2br"])
    warn = "warn" if "取扱注意" in handling else ""
    return f"""<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8">
<title>{heading}</title><style>{CSS}</style></head><body>
<div class="cover">
  <h1>{heading}</h1>
  <div class="sub">{subtitle}</div>
  <div class="tags">
    <span class="tag {warn}">{handling}</span>
    <span class="tag">実施日 2026-10-02（金）15:00 - 16:00</span>
    <span class="tag">株式会社STANDS</span>
  </div>
</div>
{html_body}
<div class="footer-note">個人情報漏えい 机上訓練 ／ 出典: {os.path.basename(md_path)}
（Markdown が正。PDF は配布・保管用の写し）</div>
</body></html>"""


def main():
    os.makedirs(OUTDIR, exist_ok=True)
    for md_name, pdf_name, subtitle, handling in DOCS:
        md_path = os.path.join(BASE, md_name)
        html = build_html(md_path, subtitle, handling)
        with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False,
                                         encoding="utf-8") as tmp:
            tmp.write(html)
            tmp_path = tmp.name
        out = os.path.join(OUTDIR, pdf_name)
        subprocess.run([
            CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
            "--run-all-compositor-stages-before-draw", "--virtual-time-budget=4000",
            f"--print-to-pdf={out}", f"file://{tmp_path}",
        ], check=True, capture_output=True)
        os.unlink(tmp_path)
        print(f"{pdf_name}  ({os.path.getsize(out) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
