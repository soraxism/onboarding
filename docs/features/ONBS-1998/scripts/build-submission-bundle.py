# -*- coding: utf-8 -*-
"""ISMS審査の提出用に、PDF を1ファイルへ束ねる

実行:
    .venv/bin/python docs/features/ONBS-1998/scripts/build-pdfs.py
    .venv/bin/python docs/features/ONBS-1998/scripts/build-submission-bundle.py

提出資料一覧（鑑）を先頭に置き、計画 → 実施記録 → レビュー → 教育 の順で綴じる。
"""
import os
from pypdf import PdfWriter

BASE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
PDF = os.path.join(BASE, "pdf")
OUT = os.path.join(PDF, "ISMS審査_提出一式.pdf")

ORDER = [
    "06_ISMS審査_提出資料一覧.pdf",   # 鑑
    "00_訓練の概要と準備.pdf",         # 計画
    "01_ファシリテーター用進行台本.pdf",
    "02_Slack投入用テキスト.pdf",
    "05_訓練実施記録.pdf",             # 実施記録
    "04_訓練実施報告.pdf",             # レビュー
    "03_参加者配布資料.pdf",           # 教育
]

writer = PdfWriter()
page = 0
for name in ORDER:
    path = os.path.join(PDF, name)
    before = page
    writer.append(path)
    page = len(writer.pages)
    writer.add_outline_item(name.replace("", "").replace(".pdf", ""), before)
    print(f"{name}  p.{before + 1}-{page}")

with open(OUT, "wb") as f:
    writer.write(f)
print(f"\nsaved: {OUT}  （全{page}ページ）")
