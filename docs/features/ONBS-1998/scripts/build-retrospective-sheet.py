# -*- coding: utf-8 -*-
"""ONBS-1998 机上訓練 振り返りシート（xlsx）を生成する

実行:
    python3 -m venv .venv && .venv/bin/pip install openpyxl
    .venv/bin/python docs/features/ONBS-1998/scripts/build-retrospective-sheet.py

内容を変えるときは、このスクリプトを直してから再生成する（xlsx を直接編集しない）。
文言の正は docs/features/ONBS-1998/2026-09-07_incident-drill-retrospective-sheet.md。
"""
import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "2026-09-07_incident-drill-retrospective-sheet.xlsx")

NAVY, BLUE, LIGHT, GRAY, YELLOW = "1F3864", "305496", "D9E2F3", "F2F2F2", "FFF2CC"
thin = Side(style="thin", color="A6A6A6")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)


def title(ws, row, text, span=6):
    c = ws.cell(row=row, column=1, value=text)
    c.font = Font(bold=True, size=16, color=NAVY)
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    ws.row_dimensions[row].height = 26
    return row + 1


def section(ws, row, text, span=6):
    c = ws.cell(row=row, column=1, value=text)
    c.font = Font(bold=True, size=12, color="FFFFFF")
    c.fill = PatternFill("solid", fgColor=BLUE)
    c.alignment = Alignment(vertical="center", indent=1)
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    ws.row_dimensions[row].height = 22
    return row + 1


def note(ws, row, text, span=6):
    c = ws.cell(row=row, column=1, value=text)
    c.font = Font(size=10, color="595959", italic=True)
    c.alignment = Alignment(vertical="top", wrap_text=True)
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    ws.row_dimensions[row].height = 15 * (1 + text.count("\n"))
    return row + 1


def header(ws, row, labels, start_col=1):
    for i, label in enumerate(labels):
        c = ws.cell(row=row, column=start_col + i, value=label)
        c.font = Font(bold=True, color="FFFFFF", size=11)
        c.fill = PatternFill("solid", fgColor=NAVY)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BORDER
    ws.row_dimensions[row].height = 30
    return row + 1


def body(ws, row, values, start_col=1, height=None, fill=None, bold_col=None):
    for i, v in enumerate(values):
        c = ws.cell(row=row, column=start_col + i, value=v)
        c.alignment = Alignment(vertical="top", wrap_text=True)
        c.border = BORDER
        if fill:
            c.fill = PatternFill("solid", fgColor=fill)
        if bold_col is not None and i == bold_col:
            c.font = Font(bold=True)
    if height:
        ws.row_dimensions[row].height = height
    return row + 1


def blanks(ws, row, ncols, count, start_col=1, height=22, fill=None):
    for _ in range(count):
        row = body(ws, row, [None] * ncols, start_col=start_col, height=height, fill=fill)
    return row


def widths(ws, spec):
    for col, w in spec.items():
        ws.column_dimensions[col].width = w


def dv(ws, options, cells):
    d = DataValidation(type="list", formula1='"' + ",".join(options) + '"', allow_blank=True)
    ws.add_data_validation(d)
    d.add(cells)


def setup(ws, landscape=False):
    ws.sheet_view.showGridLines = False
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    if landscape:
        ws.page_setup.orientation = "landscape"
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0


# ============================================================
# 実績（2026-10-02 実施分）— Slack のタイムスタンプから復元
# ============================================================
TIMELINE = [
    ("14:23", "空", "鈴木さんへ役割のDMを送付（当事者エンジニア役）", "DM"),
    ("14:42", "空", "オープニング告知（ルール4つ・役割・空は休み設定・共有チャンネル想定を明示）", "訓練チャンネル"),
    ("14:43", "空", "無罰宣言を投稿", "訓練チャンネル"),
    ("15:00", "空（A社 田中役）", "インジェクト① 第一報。@椎名 宛に投稿", "訓練チャンネル"),
    ("15:02", "椎名", "一次応答「確認いたします」（第一報から約2分）", "訓練チャンネル"),
    ("15:04", "藤原", "椎名へ「椎名さんもDLして実際に含まれているか確認して」と指示", "訓練チャンネル"),
    ("15:05", "空", "「このチャンネルはA社との共有チャンネル想定」と注意（以降、社内会話は流れず）", "訓練チャンネル"),
    ("15:07", "椎名", "A社へCSVの共有を依頼", "訓練チャンネル"),
    ("15:10", "空（A社役）", "「YYY社・XXX社・ZZZ社は弊社の顧客名ではない」と回答", "訓練チャンネル"),
    ("15:10", "椎名", "藤原さんへ事象を報告し判断を仰ぐ（第一報から約10分）", "藤原さんtimes"),
    ("15:12", "藤原", "「エンドユーザーの会社は分からないが、どう特定したのか」と確認", "藤原さんtimes"),
    ("15:15", "藤原", "「いったんエンジニアに事象確認を。お客さんには確認する旨の連絡を」と指示", "藤原さんtimes"),
    ("15:17", "椎名", "鈴木・文へ調査を依頼（第一報から約17分）", "CS-engineer"),
    ("15:19", "鈴木", "「すぐ確認します」", "CS-engineer"),
    ("15:20", "椎名", "CSチームへ、他クライアントから同様の連絡が来ていないか確認を依頼", "CSチャンネル"),
    ("15:21", "空（A社役）", "インジェクト④ 二次拡散（共有フォルダに保存・10名程度が閲覧可）を前倒しで投入", "訓練チャンネル"),
    ("15:22", "空", "鈴木さんへインジェクト②（調査中間報告）をDMで送付", "DM"),
    ("15:23", "鈴木", "【調査中間報告】を投稿（原因・48,000行・全顧客が使える機能）", "CS-engineer"),
    ("15:24", "宇野", "「発生時期は？ 気づいていない顧客がいるかもしれないのでログを確認する」", "CSチャンネル"),
    ("15:25", "椎名", "「全社的に個人情報が漏洩している可能性がある」とCSへ共有", "CSチャンネル"),
    ("15:28", "木淵", "「担当クライアントのCSVをいくつかダウンロードして確認してみます」（※実行はされず）", "CSチャンネル"),
    ("15:28", "吉田", "顧客周知メールの下書き作成を申し出（実システムの操作はしないと明記）", "CSチャンネル"),
    ("15:29", "鈴木", "「9/17 11:30頃のリリース以降」と発生期間を特定", "CS-engineer"),
    ("15:31", "藤原", "確認したい5点を列挙（いつから/全アカウント対象か/閲覧範囲/再現条件/CSV以外）", "CSチャンネル"),
    ("15:32", "空", "インジェクト③ 集計結果を投稿（他社プロダクト3件・1,240名・計5社）", "訓練チャンネル"),
    ("15:34", "空", "投票を投稿（報告対象かどうか）", "訓練チャンネル"),
    ("15:35", "椎名", "藤原の5点への回答を整理して共有", "CSチャンネル"),
    ("15:36", "山崎", "「ENT顧客から優先して対応が走る。顧客対応を優先度MAXで」", "CSチャンネル"),
    ("15:39", "宇野", "影響顧客の確認シートを作成し、記入を依頼", "CSチャンネル"),
    ("15:40", "武藤", "「すぐ修正できるか。まずは出血を止めるのが最優先」と止血を提起", "CSチャンネル"),
    ("15:43", "鈴木", "全顧客対象・全顧客が見える状態・影響はCSVダウンロードのみ、と回答", "CS-engineer"),
    ("15:44", "鈴木", "「修正作業中。数分で可能」", "CSチャンネル"),
    ("15:47", "椎名", "吉田へ顧客周知メールの下書き作成を依頼", "CSチャンネル"),
    ("15:48", "鈴木", "修正リリース完了（第一報から約48分）", "CSチャンネル"),
    ("15:48", "宇野", "「計5社とは何か。優先的にその4社を確認すべきでは」", "CSチャンネル"),
    ("15:49", "武藤", "「5社に加え、その5社に自社情報を見られた可能性のある顧客も影響範囲」", "CSチャンネル"),
    ("15:50", "椎名", "藤原へA社向け連絡文面の確認を依頼", "CSチャンネル"),
    ("15:53", "椎名", "A社向けの報告文案を作成", "CSチャンネル"),
    ("15:56", "宇野", "混入チェック用のClaudeスキル（/internal-share-test）を作成し共有（※実データでは未実行）", "CSチャンネル"),
    ("15:56", "吉田", "全顧客向け周知メール（第1報）の文面を作成", "CSチャンネル"),
    ("15:57", "椎名", "「メールは全社に発報、個別報告はCSVをDLした5社へ」と提案", "CSチャンネル"),
    ("15:59", "武藤", "「報告は全社。直接影響があった顧客には個別に」と合意", "CSチャンネル"),
    ("16:00", "椎名", "鈴木へ、5社と閲覧された可能性のある顧客の洗い出しを依頼", "CSチャンネル"),
    ("16:00", "空", "【本日はここまで】訓練終了を宣言", "訓練チャンネル"),
    ("16:01", "藤原", "A社向け文面を修正して返す", "CSチャンネル"),
    ("16:37", "空", "配布資料（PDF）を配布", "訓練チャンネル"),
    ("16:43", "空", "投票の答え合わせを投稿", "訓練チャンネル"),
    ("16:56", "空", "省略したインジェクト⑤（B社からの問い合わせ）を参考共有", "訓練チャンネル"),
    ("17:10", "宇野", "「この項目は個人情報に当たるのか」と質問（議論が継続）", "訓練チャンネル"),
    ("17:13", "空", "アンケート（Googleフォーム）を依頼", "訓練チャンネル"),
    ("17:48", "椎名", "対応したスレッドの一覧を投稿（5本・3チャンネル）", "訓練チャンネル"),
]

MEASURE_COMMON = {
    "第一報の投稿から、誰かが気づいて反応するまでの経過時間": "約2分（15:00:07 → 15:02:11 椎名）",
    "第一報から、藤原さん（ISMS管理者）に届くまでの経過時間": "約10分（15:10 椎名→藤原さんtimes）",
    "「漏えいの疑い」として扱うと決まるまでの経過時間": "約16分（15:15 藤原が調査と顧客連絡を指示）",
    "椎名さん（CS）→ 鈴木さん（エンジニア）へ調査依頼が渡った時刻": "15:17（第一報から約17分）",
    "鈴木さんの報告は、依頼されて出たか / 自発的に出たか": "依頼された（15:17 依頼 → 15:23 報告）",
    "証跡保全の指示が出た時点": "なし（誰からも出なかった）",
    "「過去分も確認する」に到達した時点": "15:20（椎名が他クライアントへの確認を依頼）／15:24（宇野がログ確認を提案）",
    "他社プロダクト3社（データの持ち主）への連絡方針が決まった時点": "未決（全社メール＋DLした5社への個別報告までは15:59に決定。混入元3社への連絡は議題に上がらず）",
    "ダウンロード機能を止める判断が出た時点": "機能停止はせず修正で対応（15:40 武藤が止血を提起 → 15:48 修正リリース完了）",
    "A社以外の利用者にも影響があると気づいた時点": "15:23（鈴木の報告「全顧客が使える機能」）→ 15:25 椎名が「全社的に漏洩の可能性」と共有",
}

MEASURE_REMOTE = {
    "社内対応用チャンネルを作ったか": "作らなかった（既存の藤原さんtimes / CS-engineer / CSチャンネルの3か所に分散）",
    "参加者がハドルを立てたか。立てるまでの時間 ★今回の最重要データ": "立たなかった（確認済み）。全編テキストのみで進行した",
    "ハドルを立てた人": "—",
    "ハドルに記録役（空）が呼ばれたか（ルール3）": "該当なし（ハドルが立たなかったため）",
    "ハドルに招集された人の範囲（呼ばれなかった人がいたか）": "該当なし",
    "催促（15分ルール）を使ったか": "使わなかった（2分で反応があったため不要）",
    "普段 空さんが担う事実確認を、誰が引き取ったか": "椎名（CS）がハブとして一次受け・調査依頼・顧客連絡を担当。宇野・武藤・山崎・吉田が自発的に参加",
    "「空さんに聞けば分かる」で止まった回数": "0回（進行の確認のみ 16:02 鈴木）",
    "藤原さんが自分から「無罰」の方針を口にしたか": "言わなかった",
    "A社との共有チャンネルに社内の議論を書いてしまった回数": "1回（15:04 藤原→椎名への指示。15:05 に空が注意し、以降は発生せず）",
    "チャンネル宣言なしの DM が発生した回数": "0回（確認できる範囲）",
    "ハドル・DMだけで決まり、Slackに書き戻されなかった判断の数": "0件（ハドルなし）",
    "実システム（管理画面 / 本番DB / コード）を開こうとした回数": "0回（実行なし）。15:28 木淵さんが「CSVをDLして確認してみます」と発言したが実行せず。吉田さんは下書きのみ、宇野さんのチェック用スキルも実データでは未実行。ルール2は全員が守った",
}

wb = Workbook()

# ============================== 表紙 ==============================
ws = wb.active
ws.title = "表紙・実施概要"
setup(ws)
widths(ws, {"A": 34, "B": 46, "C": 28, "D": 22, "E": 18, "F": 18})

r = 1
r = title(ws, r, "個人情報漏えい 机上訓練 振り返りシート（リモート / Slack版）")
c = ws.cell(row=r, column=1, value="このシートの目的は評価ではなく、対応フローの要件を洗い出すこと")
c.font = Font(size=11, color="595959")
ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
r += 2

r = section(ws, r, "実施概要")
r = header(ws, r, ["項目", "記入欄", "備考"] + [None] * 3)
rows = [
    ("実施日時", "2026-10-02（金）15:00 - 16:00", "インジェクト投入は 15:05 / 15:15 / 15:26 / 15:41。振り返り 15:47"),
    ("シナリオ", "管理画面のログインレポートCSVダウンロード機能の不具合で、他社プロダクトのデータが混入したCSVを顧客がダウンロードできていた", "先月のリリースから混入。全顧客が使える機能"),
    ("実施モード", "モードC Slack完結型", "主催側からは会議を設定しない（参加者が立てるのは自由）。開始・終了ともSlackで告知"),
    ("ファシリテーター", "空", "A社 田中さん役を兼ねる。開始告知で無罰宣言も行う。対応メンバーとしては「休暇で不在」の設定（属人化の測定を兼ねる）"),
    ("記録係", "空（ファシリテーター兼任）", "Slackに残らないもの（参加者が立てたハドル・DM）だけ訓練中に記録し、残りは終了後にSlackのタイムスタンプから復元する"),
    ("訓練用チャンネル", "#2026_個人情報漏えい訓練", "A社との共有チャンネル想定。開始告知でその旨を参加者へ明示する。トピックに【訓練用】ONBS-1998 机上訓練専用 と明記"),
    ("社内対応チャンネル", "作られなかった（既存3チャンネルに分散）", "藤原さんtimes / CS-engineer / CSチャンネル の5スレッド"),
    ("振り返りアンケート", "Googleフォーム（回答はスプレッドシートで管理）", "個人記入 A / B / C とその集約はこのブックには転記しない"),
    ("アクション管理", "2026-10-02_action-plan.md", "担当・期限・状態はそちらが正。このブックには持たない"),
]
mode_row = r + 2
for label, val, memo in rows:
    r = body(ws, r, [label, val, memo], height=24, bold_col=0)
    ws.cell(row=r - 1, column=1).fill = PatternFill("solid", fgColor=GRAY)
    ws.cell(row=r - 1, column=2).fill = PatternFill("solid", fgColor=YELLOW)
dv(ws, ["モードA 常時接続型", "モードB 解散型", "モードC Slack完結型"], f"B{mode_row}")
r += 1

r = section(ws, r, "シナリオの登場企業")
r = header(ws, r, ["呼び方", "立場", "備考"] + [None] * 3)
for who, stance, memo in [
    ("A社", "管理画面からCSVをダウンロードし、混入を指摘してきた顧客", "ファシリテーターが「A社 田中さん」役として投稿する"),
    ("他社プロダクト3社", "A社のCSVに混入していた、データの持ち主である顧客企業", "本シートの「3社」はこれ。報告主体（委託か自社取得か）の論点の主語"),
    ("計5社", "同じ期間に同じログインレポートをダウンロードした顧客（A社を含む）", "残り4社分の中身は未確定。影響範囲を確定できるかの論点"),
    ("B社", "上記3社のうちの1社", "インジェクト⑤で「A社経由で先に知った」として問い合わせてくる"),
    ("1,240名", "3社のエンドユーザー。情報が漏えいした該当者（法律上の「本人」）", "報告義務の件数は行数（48,000行）ではなくこちら。当社は該当者の連絡先を持たない（氏名とIDのみ）"),
]:
    r = body(ws, r, [who, stance, memo], height=26, bold_col=0)
r += 1

r = section(ws, r, "役割の割り当て")
r = header(ws, r, ["役割", "担当", "訓練中の立場"] + [None] * 3)
for role, who, stance in [
    ("ファシリテーター", "空", "シナリオを保持。A社田中さん役としてSlackに書き込む。答えは言わない。対応メンバーとしては不在（休暇設定）"),
    ("統括判断者", "藤原（ISMS管理者）", "実際に判断を下させる。代弁しない。シナリオを知らない訓練対象（事前共有しない。無罰宣言も依頼しない）"),
    ("一次受け", "椎名（CS）", "A社からのSlackを最初に受け取る"),
    ("調査担当", "鈴木（エンジニア）", "「該当の集計ロジックを先月改修したエンジニア」役。開始直前にDMで役の情報を渡す。②③はこの人のDM経由で投入する"),
    ("調査担当", "文（エンジニア）", "役の情報は渡さない（何も知らない状態で参加）。調査担当の中の分担は割り当てない（誰が事実確認を引き取るかが観測点）"),
    ("記録係", "空（ファシリテーター兼任）", "時系列と、詰まった箇所を書き出す"),
    ("オブザーバー", "経営層1名（可能なら）", "発言せずチャンネルを見る。公表判断の当事者になるため見ておく"),
]:
    r = body(ws, r, [role, who, stance], height=26, bold_col=1)
r += 1

r = section(ws, r, "運用方法")
for t in [
    "Part 1 は終了後に Slack のタイムスタンプから埋める（canvas は作らない。共有チャンネルに社内の時系列を貼らないため）",
    "参加者の個人記入（A / B / C）とその集約は Googleフォームの回答スプレッドシートで管理する。このブックには転記しない",
    "アクション（担当・期限・状態）は 2026-10-02_action-plan.md で管理する。このブックには持たない",
    "「うまくできたこと」は書かなくてよい。困ったこと・詰まったことだけを書く",
    "重複は消さない。複数人が挙げた項目 ＝ 優先度が高い項目",
    "モードC（Slack完結型）で実施する。主催側から会議を設定しないため、やり取りはほぼ全部 Slack に残る",
    "記録係はファシリテーター兼任。訓練中に手で書くのは Slack に残らないもの（参加者が立てたハドル・DM）だけにし、残りは終了後に Slack のタイムスタンプから埋める",
    "投票結果のスクリーンショットだけは、その場で撮る（リアクションは後から変えられるため）",
]:
    r = body(ws, r, ["・" + t, None, None], height=20)
    ws.merge_cells(start_row=r - 1, start_column=1, end_row=r - 1, end_column=3)
r += 1

r = section(ws, r, "シート構成")
r = header(ws, r, ["シート", "記入する人", "記入するタイミング"] + [None] * 3)
for a, b, cc in [
    ("Part1 時系列・測定値", "記録係", "終了後（訓練中はSlackに残らないものだけメモ）"),
    ("Part2 確認漏れチェック", "ファシリテーター", "アンケートの集約後"),
    ("（別管理）アンケート", "参加者全員", "Googleフォーム → 回答スプレッドシートで管理"),
    ("（別管理）アクション", "ファシリテーター", "2026-10-02_action-plan.md で管理"),
]:
    r = body(ws, r, [a, b, cc], height=20)

# ============================== Part1 ==============================
ws = wb.create_sheet("Part1 時系列・測定値")
setup(ws, landscape=True)
widths(ws, {"A": 9, "B": 16, "C": 70, "D": 18, "E": 20, "F": 16})

r = 1
r = title(ws, r, "Part 1. 時系列記録【終了後に Slack のタイムスタンプから復元】", span=4)
r = note(ws, r, "「どこで」列が重要。会議を立てないため大半は Slack に残るが、参加者が立てたハドルと DM で決まった判断は残らない。あとで「Slackに残っていない判断がいくつあったか」を数えるために使う。", span=4)
r += 1
r = header(ws, r, ["時刻", "誰が", "何を知った / 何をした", "どこで"])
first = r
for t, who, what, where in TIMELINE:
    r = body(ws, r, [t, who, what, where], height=22, fill="FFFFFF")
r = blanks(ws, r, 4, 6, fill="FFFFFF")
dv(ws, ["訓練チャンネル", "藤原さんtimes", "CS-engineer", "CSチャンネル", "ハドル", "DM", "その他"], f"D{first}:D{r-1}")
ws.freeze_panes = f"A{first}"
r += 1

r = section(ws, r, "測定値（共通）", span=4)
r = header(ws, r, ["項目", "記録", "記入の仕方"])
for item, how in [
    ("第一報の投稿から、誰かが気づいて反応するまでの経過時間", "分"),
    ("第一報から、藤原さん（ISMS管理者）に届くまでの経過時間", "分"),
    ("「漏えいの疑い」として扱うと決まるまでの経過時間", "分"),
    ("椎名さん（CS）→ 鈴木さん（エンジニア）へ調査依頼が渡った時刻", "訓練内時刻 / 渡らなければ「なし」"),
    ("鈴木さんの報告は、依頼されて出たか / 自発的に出たか", "依頼された / 自発 / 代理投稿になった"),
    ("証跡保全の指示が出た時点", "訓練内時刻 / 出なければ「なし」"),
    ("「過去分も確認する」に到達した時点", "訓練内時刻 / 到達しなければ「なし」"),
    ("他社プロダクト3社（データの持ち主）への連絡方針が決まった時点", "訓練内時刻 / 決まらなければ「未決」"),
    ("ダウンロード機能を止める判断が出た時点", "訓練内時刻 / 出なければ「なし」"),
    ("A社以外の利用者にも影響があると気づいた時点", "訓練内時刻 / 気づかなければ「なし」"),
]:
    r = body(ws, r, [item, MEASURE_COMMON.get(item), how], height=22)
    ws.cell(row=r - 1, column=2).fill = PatternFill("solid", fgColor=YELLOW)
r += 1

r = section(ws, r, "測定値（リモート特有）", span=4)
r = header(ws, r, ["項目", "記録", "記入の仕方"])
for item, how, mark in [
    ("社内対応用チャンネルを作ったか", "作った（　分後・チャンネル名　　　）/ 作らなかった", True),
    ("参加者がハドルを立てたか。立てるまでの時間 ★今回の最重要データ", "分後 / 立てなかった", True),
    ("ハドルを立てた人", "氏名", True),
    ("ハドルに記録役（空）が呼ばれたか（ルール3）", "呼ばれた / 呼ばれなかった", True),
    ("ハドルに招集された人の範囲（呼ばれなかった人がいたか）", "自由記述", False),
    ("催促（15分ルール）を使ったか", "使った（　分時点）/ 使わなかった", True),
    ("普段 空さんが担う事実確認を、誰が引き取ったか", "氏名 / 誰も引き取らなかった", True),
    ("「空さんに聞けば分かる」で止まった回数", "回", True),
    ("藤原さんが自分から「無罰」の方針を口にしたか（宣言自体は開始告知でファシリテーターが実施済み。これは責任者本人が言ったかの観測）", "言った（　分時点）/ 言わなかった", True),
    ("A社との共有チャンネルに社内の議論を書いてしまった回数", "回", True),
    ("チャンネル宣言なしの DM が発生した回数", "回", True),
    ("ハドル・DMだけで決まり、Slackに書き戻されなかった判断の数", "件", True),
    ("実システム（管理画面 / 本番DB / コード）を開こうとした回数", "回", False),
]:
    r = body(ws, r, [item, MEASURE_REMOTE.get(item), how], height=22)
    ws.cell(row=r - 1, column=2).fill = PatternFill("solid", fgColor=YELLOW)
    if mark:
        ws.cell(row=r - 1, column=1).font = Font(bold=True)
r += 1

r = section(ws, r, "判断が割れた論点", span=4)
r = note(ws, r, "参加者間で意見が分かれた点を、割れたまま記録する。まとめないこと。投票結果のスクリーンショットを保存する（Slackのリアクションは後から変わるため、その場で撮る）。", span=4)
r = header(ws, r, ["論点", "どう割れたか"])
r = body(ws, r, ["報告義務の有無（Slack投票の結果）", "対象 9名 / 非対象 1名 / 判断できない 1名（15:34 投稿、16:43 に答え合わせ）"], height=22)
r = body(ws, r, ["「個人情報に当たるか」の理解", "氏名があれば個人情報、という点が訓練後の質疑で共有された（17:10〜17:35）。ユーザーID＋企業名の扱いは未整理のまま"], height=36)
r = blanks(ws, r, 2, 5)

# ============================== Part2 ==============================
ws = wb.create_sheet("Part2 確認漏れチェック")
setup(ws)
widths(ws, {"A": 5, "B": 18, "C": 62, "D": 6, "E": 20, "F": 40})

r = 1
r = title(ws, r, "Part 2. 確認漏れチェック【ファシリテーター】")
r = note(ws, r, "アンケート（Googleフォーム）の集約結果に以下が含まれているか確認する。含まれていなければ、別途フローへ反映する。★ はリモート／技術面で特に落としたくない項目。")
r += 1

items = [
    ("体制・判断", "一次受け（営業/CS）から責任者へのエスカレーション先は決まっているか", False),
    ("体制・判断", "特定の個人が不在でも初動が回るか（今日の「空さん不在」で詰まった箇所はどこか）", True),
    ("体制・判断", "「疑い」の段階で上げてよいという合意はあるか", False),
    ("体制・判断", "「知った時」を記録する運用はあるか", False),
    ("体制・判断", "証跡保全の手順はあるか", False),
    ("体制・判断", "委託／自社取得の契約上の整理を、誰が答えられるか", False),
    ("体制・判断", "法務・顧問弁護士への相談ルートと連絡先はあるか", False),
    ("体制・判断", "公表判断の権限者は決まっているか", False),
    ("体制・判断", "報道対応の窓口は決まっているか", False),
    ("リモート / Slack運用", "インシデント発生時にどこに集まるか決まっているか（専用チャンネルの命名規則・ハドル運用）", True),
    ("リモート / Slack運用", "DMで判断を閉じないルールはあるか", True),
    ("リモート / Slack運用", "顧客との共有チャンネルと社内チャンネルの使い分けルールはあるか", True),
    ("リモート / Slack運用", "音声で決めたことをSlackに書き戻すルールはあるか", True),
    ("リモート / Slack運用", "Slackが見られない時間帯・状況の代替連絡手段はあるか（電話番号リストの有無）", True),
    ("リモート / Slack運用", "夜間・休日の連絡経路はあるか", False),
    ("リモート / Slack運用", "Slack上の証跡（メッセージ・共有ファイル）を消さない・保全する手順はあるか", False),
    ("対外対応・技術", "顧客への通知文テンプレートはあるか", False),
    ("対外対応・技術", "削除依頼・削除証明の書式はあるか", False),
    ("対外対応・技術", "ログインレポートの各列のうち、どれが個人情報にあたるかを整理した資料はあるか", True),
    ("対外対応・技術", "カスタムクエリに顧客が何を入れているかを把握しているか（把握していないなら漏えい範囲を確定できない）", True),
    ("対外対応・技術", "集計ロジックのプロダクト絞り込みの誤りを、リリース前に検知する仕組みはあるか", True),
    ("対外対応・技術", "顧客のダウンロード操作ログは残っているか。影響範囲の確定に使えるか", True),
    ("対外対応・技術", "不具合の疑いがある機能を一時停止する判断は、誰の権限か", True),
]
r = header(ws, r, ["#", "区分", "確認項目", "★", "集約に含まれていたか", "メモ"])
first = r
for i, (cat, text, mark) in enumerate(items, start=1):
    r = body(ws, r, [i, cat, text, "★" if mark else None, None, None], height=24)
    ws.cell(row=r - 1, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws.cell(row=r - 1, column=4).alignment = Alignment(horizontal="center", vertical="center")
    ws.cell(row=r - 1, column=5).fill = PatternFill("solid", fgColor=YELLOW)
    if mark:
        ws.cell(row=r - 1, column=3).font = Font(bold=True)
dv(ws, ["含まれていた", "出ていない（問いかけた）", "出ていない（未対応）"], f"E{first}:E{r-1}")
ws.freeze_panes = f"A{first}"
r += 1
r = note(ws, r, "末尾3つ（リリース前の検知・ダウンロード操作ログ・機能の一時停止権限）は技術面の再発防止と止血の要。必ず議題に乗せる。")

wb.save(os.path.normpath(OUT))
print("saved:", os.path.normpath(OUT))
