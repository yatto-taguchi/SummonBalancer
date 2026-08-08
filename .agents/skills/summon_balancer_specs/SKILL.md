---
name: summon_balancer_specs
description: ユーザーが「仕様書を読んで」と指示した際に呼び出されるスキル。Summon Balancerの仕様、現場ルール、アサインロジック、アーキテクチャ(SSOT)について調べる際に呼び出される
---
# Summon Balancer 開発完全バイブル & 公式ルールブック

Summon Balancerの仕様やルール（マンセル、特殊召喚、UIとエンジンの分離など）に関する疑問が生じた場合、またはアサインエンジンの改修・デバッグを行う場合は、必ず以下のリファレンスドキュメントを参照してください。

- `references/system_rulebook.md`: アシスタント自動振り分けアプリの公式ルールブック（現場ルール、マンセル、SP特殊召喚など）
- `references/architecture_ssot.md`: 開発完全バイブル (SSOT & Architecture v1.3) （純粋関数の徹底、EngineStateデータ構造、5分Tickベースの処理、UI分離ルールなど）

このスキルがトリガーされた際は、まず `view_file` ツールを用いて上記リファレンスファイルの内容を確認し、仕様と現場の絶対ルールに反しない実装・回答を行ってください。
