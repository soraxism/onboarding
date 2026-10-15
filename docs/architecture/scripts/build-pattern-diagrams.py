#!/usr/bin/env python3
"""配信タグ方式（onboarding-init）の機能構成図を 4 パターン分生成する。

出力: docs/architecture/2026-10-15_onboarding-feature-architecture-patterns.drawio

パターンは「カスタムレイヤーを使うか」「AI を使うか」の 2 軸の組み合わせ。
箱の数がパターンごとに変わるため、各レイヤーは要素数から等間隔に座標を計算している。
図を直接 draw.io で編集した場合は、このスクリプトを再実行すると上書きされる点に注意。
"""

from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "2026-10-15_onboarding-feature-architecture-patterns.drawio"

# スタイル ------------------------------------------------------------------
ACCENT = "rounded=1;arcSize=6;html=1;fillColor=#FFF4E8;strokeColor=#DD7B22;strokeWidth=2.2;align=left;verticalAlign=top;spacingLeft=10;spacingTop=6;fontSize=10.5;fontColor=#7A3E04;whiteSpace=wrap;"
PLAIN = "rounded=1;arcSize=6;html=1;fillColor=#FFFFFF;strokeColor=#9AA5B1;strokeWidth=1.3;align=left;verticalAlign=top;spacingLeft=10;spacingTop=6;fontSize=10.5;fontColor=#3E4C59;whiteSpace=wrap;"
DATA = "rounded=1;arcSize=6;html=1;fillColor=#FFFFFF;strokeColor=#7B96B8;strokeWidth=1.3;align=left;verticalAlign=top;spacingLeft=10;spacingTop=6;fontSize=10.5;fontColor=#33506E;whiteSpace=wrap;"
NOTE = "rounded=1;arcSize=6;html=1;dashed=1;dashPattern=6 4;fillColor=none;strokeColor=#B6BFC9;strokeWidth=1.2;align=left;verticalAlign=middle;spacingLeft=12;fontSize=10.5;fontColor=#52606D;whiteSpace=wrap;"
LAYER = "rounded=1;arcSize=2;html=1;fillColor=#F5F7FA;strokeColor=#CBD2D9;strokeWidth=1.5;align=left;verticalAlign=top;spacingLeft=14;spacingTop=8;fontSize=13;fontStyle=1;fontColor=#3E4C59;"
LAYER_DATA = "rounded=1;arcSize=2;html=1;fillColor=#EDF3F9;strokeColor=#B4C6D9;strokeWidth=1.5;align=left;verticalAlign=top;spacingLeft=14;spacingTop=8;fontSize=13;fontStyle=1;fontColor=#33506E;"
E_ACCENT = "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor=#DD7B22;strokeWidth=2.4;endArrow=blockThin;endFill=1;fontSize=13;fontStyle=1;fontColor=#7A3E04;labelBackgroundColor=#FFFFFF;"
E_ACCENT_THIN = "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor=#DD7B22;strokeWidth=1.8;endArrow=blockThin;endFill=1;"
E_PLAIN = "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;strokeColor=#9AA5B1;strokeWidth=1.3;endArrow=blockThin;endFill=1;fontSize=10;fontColor=#52606D;labelBackgroundColor=#FFFFFF;"


def esc(text):
    """draw.io の value 属性に入れる HTML 片へ変換する。"""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("\n", "&lt;br&gt;")
    )


def cell(cid, value, style, x, y, w, h):
    return (
        f'        <mxCell id="{cid}" value="{value}" style="{style}" vertex="1" parent="1">\n'
        f'          <mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry" />\n'
        f"        </mxCell>\n"
    )


def box(cid, title, body, style, x, y, w, h):
    value = f"&lt;b&gt;{esc(title)}&lt;/b&gt;&lt;br&gt;&lt;br&gt;{esc(body)}"
    return cell(cid, value, style, x, y, w, h)


def edge(cid, src, tgt, style, label="", exit_xy=None, entry_xy=None, points=None, label_pos=None):
    geo_attr = f'x="{label_pos}" ' if label_pos is not None else ""
    s = style
    if exit_xy:
        s += f"exitX={exit_xy[0]};exitY={exit_xy[1]};exitDx=0;exitDy=0;"
    if entry_xy:
        s += f"entryX={entry_xy[0]};entryY={entry_xy[1]};entryDx=0;entryDy=0;"
    out = f'        <mxCell id="{cid}" value="{label}" style="{s}" edge="1" parent="1" source="{src}" target="{tgt}">\n'
    out += f'          <mxGeometry {geo_attr}relative="1" as="geometry">\n'
    if points:
        out += "            <Array as=\"points\">"
        out += "".join(f'<mxPoint x="{px}" y="{py}" />' for px, py in points)
        out += "</Array>\n"
    out += "          </mxGeometry>\n        </mxCell>\n"
    return out


def spread(count, left, total_width, item_width, gap):
    """レイヤー内に count 個を等間隔で並べたときの x 座標を返す。"""
    span = count * item_width + (count - 1) * gap
    start = left + (total_width - span) / 2
    return [round(start + i * (item_width + gap)) for i in range(count)]


def build_page(name, title, use_cl, use_ai):
    cells = ""

    # 番号の割り当て（①②③は固定。④以降はカスタムレイヤー → AI の順）
    num_cl = "④" if use_cl else ""
    num_ai = ("⑤" if use_cl else "④") if use_ai else ""

    # --- ヘッダー ---------------------------------------------------------
    cells += cell(
        "title", esc(title),
        "text;html=1;align=left;verticalAlign=middle;fontSize=22;fontStyle=1;fontColor=#1F2933;",
        20, 14, 700, 38)
    cells += cell(
        "subtitle",
        esc("配信タグ方式（onboarding-init）　／　ガイド＝ツアー・ポップアップ・ヒント・フロート　／　2026-10-15 時点"),
        "text;html=1;align=left;verticalAlign=middle;fontSize=11.5;fontColor=#52606D;",
        22, 56, 660, 24)

    flow = ["&lt;b&gt;貴社サイトでの動作の流れ&lt;/b&gt;"]
    flow.append("① 配信タグが配信 CDN から初期化スクリプト・ガイド本体（JS / CSS）を読み込む")
    flow.append("② 初期化 API へ、訪問者・ページに応じて表示するガイドを問い合わせ")
    flow.append("③ ガイドの表示・操作ログを計測ビーコンへ送信")
    if use_cl:
        flow.append(f"{num_cl} カスタムレイヤー タグが専用 JS を読み込み、独自 UI を表示")
    if use_ai:
        flow.append(f"{num_ai} AI チャット・AI ヒントが AI 応答基盤と通信し、やり取りをログに記録")
    cells += cell("flowNote", "&lt;br&gt;".join(esc(f) if i else f for i, f in enumerate(flow)),
                  "rounded=1;arcSize=6;html=1;fillColor=#FFF4E8;strokeColor=#DD7B22;strokeWidth=1.6;align=left;"
                  "verticalAlign=top;spacingLeft=12;spacingTop=6;fontSize=10;fontColor=#7A3E04;whiteSpace=wrap;",
                  740, 10, 460, 104)

    cells += cell("legend", "&lt;b&gt;凡例&lt;/b&gt;&lt;br&gt;&lt;br&gt;&lt;br&gt;&lt;br&gt;矢印は主要なデータの流れを示します",
                  "rounded=1;arcSize=6;html=1;fillColor=#FFFFFF;strokeColor=#CBD2D9;strokeWidth=1.3;align=left;"
                  "verticalAlign=top;spacingLeft=12;spacingTop=6;fontSize=10.5;fontColor=#52606D;whiteSpace=wrap;",
                  1220, 10, 320, 104)
    cells += cell("legendSw1", "", "rounded=0;html=1;fillColor=#FFF4E8;strokeColor=#DD7B22;strokeWidth=2;", 1232, 40, 20, 13)
    cells += cell("legendTx1", esc("貴社サイトへの配信に関わる構成"),
                  "text;html=1;align=left;verticalAlign=middle;fontSize=10.5;fontColor=#52606D;", 1258, 39, 270, 15)
    cells += cell("legendSw2", "", "rounded=0;html=1;fillColor=#FFFFFF;strokeColor=#9AA5B1;strokeWidth=1.3;", 1232, 58, 20, 13)
    cells += cell("legendTx2", esc("弊社側の管理・運用"),
                  "text;html=1;align=left;verticalAlign=middle;fontSize=10.5;fontColor=#52606D;", 1258, 57, 270, 15)

    # --- ブラウザ層 -------------------------------------------------------
    cells += cell("aBox", esc("エンドユーザーのブラウザ（貴社 Web サイト）"), LAYER, 20, 120, 1120, 305)

    ui_items = ["ツアー", "ポップアップ", "ヒント", "フロート"]
    if use_ai:
        ui_items.append("AI チャット")
    if use_cl:
        ui_items.append("カスタムレイヤーの独自 UI")
    cells += box("a5", "画面に表示されるガイド UI",
                 "／".join(ui_items) + "\n\n貴社サイトの既存の画面構造は変更せず、上に重ねて表示します",
                 ACCENT, 40, 165, 1080, 100)

    cells += box("a1", "① 配信タグ",
                 "貴社サイトに設置する script タグ 1 行\n初期化スクリプト（onboarding-init.js）を読み込む",
                 ACCENT, 40, 290, 340, 110)
    if use_cl:
        cells += box("a3", f"{num_cl} カスタムレイヤー タグ",
                     "貴社向けに個別開発した JS を読み込む script タグ\n専用 ID ごとに配信",
                     ACCENT, 400, 290, 340, 110)
        note_x, note_w, tag_count = 760, 360, "2 行"
    else:
        note_x, note_w, tag_count = 400, 720, "1 行"
    cells += cell("aNote",
                  esc(f"貴社サイトに設置いただくのは、この {tag_count} のタグのみです。\n"
                      f"既存ページの HTML・CSS・JavaScript の改修は必要ありません。"),
                  NOTE, note_x, 290, note_w, 110)

    # --- 運用層 -----------------------------------------------------------
    cells += cell("bBox", esc("運用（弊社・貴社ご担当者）"), LAYER, 1160, 120, 380, 305)
    cells += box("b1", "管理画面", "ガイドの作成・表示条件の設定・レポート閲覧", PLAIN, 1178, 170, 344, 110)
    cells += box("b2", "エディタ拡張／プレビュー拡張", "実際の画面上でのガイド作成と、公開前の表示確認", PLAIN, 1178, 295, 344, 110)

    # --- 配信基盤 ---------------------------------------------------------
    cells += cell("cBox", esc("Onboarding 配信基盤"), LAYER, 20, 480, 1120, 220)

    c_items = [
        ("cCdn", "配信アセット CDN",
         "初期化スクリプト\n（onboarding-init.js）\nガイド本体の JS / CSS・テーマ\n"
         "見た目を調整するカスタム CSS / JS"),
        ("cInit", "初期化 API",
         "・許可ドメインの認証\n・訪問者・ページによる表示判定\n"
         "・ガイド定義の返却\n　（ツアー／ポップアップ／\n　　ヒント／フロート）"),
    ]
    if use_cl:
        c_items.append(("cCl", "カスタムレイヤー CDN",
                        "貴社専用 JS の配信\n既存サイトと影響し合わないよう分離して動作"))
    if use_ai:
        c_items.append(("cAi", "AI 応答基盤",
                        "AI チャット・AI ヒントの応答を\nリアルタイムに返却\n（WebSocket 接続）\nやり取りの内容をログに記録"))
    c_items.append(("cBeacon", "計測ビーコン", "ガイドの表示・操作ログを受信"))

    n = len(c_items)
    width = {3: 345, 4: 255, 5: 200}[n]
    gap = {3: 25, 4: 20, 5: 20}[n]
    xs = spread(n, 20, 1120, width, gap)
    pos = {}
    for (cid, t, b), x in zip(c_items, xs):
        cells += box(cid, t, b, ACCENT, x, 525, width, 155)
        pos[cid] = (x, width)

    # --- 管理・編集基盤 ---------------------------------------------------
    cells += cell("cpBox", esc("管理・編集基盤"), LAYER, 1160, 480, 380, 220)
    cells += box("cp1", "管理 API", "ガイド・表示条件・配信設定の管理", PLAIN, 1178, 525, 344, 72)
    cells += box("cp2", "編集／同期 API", "拡張機能からのガイド編集・同期", PLAIN, 1178, 607, 344, 73)

    # --- 機能・処理 -------------------------------------------------------
    cells += cell("dBox", esc("機能・処理"), LAYER, 20, 730, 1520, 185)
    log_body = "計測ビーコンのログを定期的に集計し、管理画面のレポートへ反映"
    if use_ai:
        log_body = ("計測ビーコンのログと、AI チャット・AI ヒントの利用ログを\n定期的に集計し、管理画面のレポートへ反映")
    d_items = [
        ("d1", "ガイド配信制御",
         "・許可ドメインの認証／除外パスの判定\n・訪問者属性・URL による表示条件の判定\n・配信データのキャッシュ制御"),
        ("d2", "ガイド管理・公開", "管理画面・拡張機能で編集した内容を、配信用データへ反映"),
    ]
    if use_ai:
        d_items.append(("dAi", "AI 応答生成", "外部 AI サービスと連携し、問い合わせに対する回答を生成"))
    d_items.append(("dLog", "ログ集計・レポート生成", log_body))

    n = len(d_items)
    width = 490 if n == 3 else 355
    gap = 15
    xs = spread(n, 20, 1520, width, gap)
    for (cid, t, b), x in zip(d_items, xs):
        style = ACCENT if cid == "d1" else PLAIN
        cells += box(cid, t, b, style, x, 775, width, 120)
        pos[cid] = (x, width)

    # --- データ -----------------------------------------------------------
    cells += cell("eBox", esc("データ"), LAYER_DATA, 20, 945, 1520, 185)
    setting = "アカウント・プロダクト・表示条件・許可ドメイン・除外パス"
    if use_ai:
        setting += "・AI チャットの設定"
    log_data_body = "ガイドの表示・操作ログ、集計済みレポート"
    if use_ai:
        log_data_body = "ガイドの表示・操作ログ、AI チャット・AI ヒントの利用ログ、集計済みレポート"
    e_items = [
        ("e1", "ガイドデータ", "ツアー／ポップアップ／ヒント／フロートの定義、デザインテーマ、カスタム CSS・JS"),
        ("e2", "設定データベース", setting),
        ("e3", "配信キャッシュ", "ガイドデータ・設定情報を一時保持し、配信を高速化"),
        ("e4", "ログ／レポートデータ", log_data_body),
    ]
    xs = spread(4, 20, 1520, 355, 15)
    for (cid, t, b), x in zip(e_items, xs):
        cells += box(cid, t, b, DATA, x, 990, 355, 120)
        pos[cid] = (x, 355)

    # --- 矢印 -------------------------------------------------------------
    # ① 配信タグ → 配信アセット CDN / ② 配信タグ → 初期化 API
    cells += edge("ed1", "a1", "cCdn", E_ACCENT, "①", (0.25, 1), (0.5, 0),
                  [(125, 442), (pos["cCdn"][0] + pos["cCdn"][1] // 2, 442)])
    cells += edge("ed2", "a1", "cInit", E_ACCENT, "②", (0.6, 1), (0.5, 0),
                  [(244, 464), (pos["cInit"][0] + pos["cInit"][1] // 2, 464)])
    # ③ ガイド UI → 計測ビーコン（右端を回り込む）
    bx = pos["cBeacon"][0] + pos["cBeacon"][1] // 2
    cells += edge("ed3", "a5", "cBeacon", E_ACCENT, "③", (1, 0.6), (0.5, 0),
                  [(1148, 225), (1148, 500), (bx, 500)], label_pos=0.7)
    if use_cl:
        cells += edge("ed4", "a3", "cCl", E_ACCENT, num_cl, (0.5, 1), (0.5, 0),
                      [(570, 442), (pos["cCl"][0] + pos["cCl"][1] // 2, 442)])
    if use_ai:
        # ガイド UI 下端から、タグの隙間（x=390）を通して AI 応答基盤へ
        ax = pos["cAi"][0] + pos["cAi"][1] // 2
        cells += edge("ed5", "a5", "cAi", E_ACCENT, num_ai, (0.324, 1), (0.5, 0),
                      [(390, 486), (ax, 486)], label_pos=0.6)

    # 配信基盤 → 機能・処理
    cells += edge("ed6", "cInit", "d1", E_ACCENT_THIN, "", (0.5, 1), (0.4, 0))
    cells += edge("ed7", "cCdn", "d1", E_ACCENT_THIN, "", (0.5, 1), (0.15, 0))
    cells += edge("ed8", "cBeacon", "dLog", E_PLAIN, "", (0.5, 1), (0.4, 0))
    if use_ai:
        cells += edge("ed9", "cAi", "dAi", E_PLAIN, "", (0.5, 1), (0.5, 0))
        # AI のやり取りもログとして集計へ回る
        cells += edge("ed17", "cAi", "dLog", E_PLAIN, "", (0.85, 1), (0.75, 0))

    # 運用 → 管理・編集基盤 → ガイド管理・公開
    cells += edge("ed10", "bBox", "cpBox", E_PLAIN, esc("ガイドの作成・表示条件の設定"), (0.68, 1), (0.68, 0))
    d2x = pos["d2"][0] + pos["d2"][1] // 2
    cells += edge("ed11", "cpBox", "d2", E_PLAIN, esc("配信データへ反映"), (0.5, 1), (0.5, 0),
                  [(1350, 715), (d2x, 715)])

    # 機能・処理 → データ
    cells += edge("ed12", "d1", "e1", E_ACCENT_THIN, "", (0.35, 1), (0.35, 0))
    cells += edge("ed13", "d1", "e2", E_ACCENT_THIN, "", (0.9, 1), (0.25, 0),
                  [(pos["d1"][0] + round(pos["d1"][1] * 0.9), 932), (pos["e2"][0] + 89, 932)])
    cells += edge("ed14", "d1", "e3", E_ACCENT_THIN, "", (0.55, 1), (0.2, 0),
                  [(pos["d1"][0] + round(pos["d1"][1] * 0.55), 970), (pos["e3"][0] + 71, 970)])
    cells += edge("ed15", "d2", "e1", E_PLAIN, "", (0.2, 1), (0.8, 0),
                  [(pos["d2"][0] + round(pos["d2"][1] * 0.2), 947), (pos["e1"][0] + 284, 947)])
    cells += edge("ed16", "dLog", "e4", E_PLAIN, "", (0.5, 1), (0.5, 0))

    return (
        f'  <diagram id="pattern-{name}" name="{name}">\n'
        f'    <mxGraphModel dx="1600" dy="1200" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" '
        f'arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1200" math="0" shadow="0">\n'
        f"      <root>\n"
        f'        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n\n'
        f"{cells}"
        f"      </root>\n    </mxGraphModel>\n  </diagram>\n"
    )


PAGES = [
    ("1. ガイドのみ", "Onboarding 機能構成図 ｜ ガイドのみ", False, False),
    ("2. ガイド＋AI", "Onboarding 機能構成図 ｜ ガイド＋AI", False, True),
    ("3. ガイド＋カスタムレイヤー", "Onboarding 機能構成図 ｜ ガイド＋カスタムレイヤー", True, False),
    ("4. ガイド＋カスタムレイヤー＋AI", "Onboarding 機能構成図 ｜ ガイド＋カスタムレイヤー＋AI", True, True),
]

xml = '<mxfile host="app.diagrams.net" agent="Claude Code" version="24.7.17">\n'
xml += "".join(build_page(*p) for p in PAGES)
xml += "</mxfile>\n"

OUT.write_text(xml, encoding="utf-8")
print(f"written: {OUT} ({len(xml)} bytes, {len(PAGES)} pages)")
