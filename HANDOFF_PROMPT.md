# 🔄 Summon Balancer 作業再開プロンプト（2026-07-30時点）

以下をそのままAIに貼り付けてください。

---

## 📋 プロジェクト概要と現在地

あなたは「Summon Balancer」というサロン（美容室）向けのアシスタント自動配置エンジンを開発しています。
スタイリストの予約に対して、アシスタント（シャンプー・カラー等の施術補助）を自動で最適に割り当てるWebアプリです。

### 技術スタック
- フロントエンド: バニラJS（フレームワークなし）、HTML/CSS
- サーバー: Node.js（ローカルのみ、`node server.js` で起動）
- データ: LocalStorage + `data/store.json`

### ワークスペース
- パス: `m:\Summon Balancer`（またはクローン先のパス）
- Gitの最新コミット: `feat: UIアラート最適化 & タイムライン・フリーズ実装`

---

## 🏗️ アーキテクチャ（SSOT準拠）

コアエンジンは `js/services/summonEngine/` に6段階のパイプラインとして実装されています。

```
index.js (SummonEngineクラス・エントリーポイント・UIアダプター層)
├── pipeline/01_requirementPhase.js   … 要件定義（5分Tick単位で必要スキルを抽出）
├── pipeline/02_primaryAssign.js      … 一次割り当て（フリーのアシスタントをアサイン）
├── pipeline/03_helpAndSpecialSummon.js … ヘルプ召喚・特殊召喚
├── pipeline/04_manncellCompression.js … マンセル圧縮（チーム対応の発動判定）
├── pipeline/05_fallbackReassign.js   … フォールバック再割り当て
├── pipeline/06_freeTimeAllocation.js … フリータイム割り当て（練習・掃除等）
├── EngineState.js                    … イミュータブルな状態オブジェクト
└── utils/                            … timeUtils, skillUtils, scoringUtils
```

### 絶対ルール（SSOT: 開発完全バイブル）
- **完全イミュータブル**: 各Phaseは `state.clone()` で新しいStateを作り、元のStateは破壊しない
- **純粋関数**: 各Phaseは `(state) => newState` の形式
- **UIアダプター層で吸収**: エンジンの5分刻み計算はストイックに維持。見た目の調整は `index.js` のUIアダプター部分で行う
- **シャンプーは途中交代禁止**: `isHandoffProhibited: true` のタスクはマンセル（チーム交代）の対象外

---

## ✅ 実装済みの機能（直近のセッションで完了）

### 1. マンセル（チーム対応）の緑枠表示改善
- **A案を採用**: エンジンの5分Tickデータから「関連予約が重なっている期間全体」を算出し、UIアダプター層で大きな緑枠ブロックとして描画
- 対象: `index.js` のUIアダプター部分（L210付近〜）

### 2. アラート制御の最適化
- **修正A（アラート統合）**: Phase 5 の `nextState.alerts.push()` を削除し、アラート生成をUIアダプター層（`index.js`）に一本化
- **修正C（予約単位マンセル抑制）**: 全timeSlotを走査して `MANNCELL_STANDBY` が付いている「予約ID」を `manncellReservationIds` セットに収集し、同じ予約内にマンセルが1つでも発動していればアラートを抑制
- UIアダプター冒頭で `state.alerts = []` にリセットしてから構築
- 判定: `if (!hasManncell && !manncellReservationIds.has(resId))` の二段階チェック

### 3. タイムライン・フリーズ
- `SummonEngine` クラスにコンストラクタ追加（`this.previousState = null`）
- `calculate()` メソッドに `options = { isToday, currentTime }` を追加
- 5分Tick丸め処理: `Math.floor(currentTime / 5) * 5`
- フリーズ境界以前のtimeSlots・tracker・alerts等を `previousState` から復元
- 全Phase (01〜06) にフリーズチェック追加（`state.freezeBoundary` 以前のTickをスキップ）
- `mainView.js` から `isToday`/`currentTime` を渡すように修正済み

### 4. クラッシュ修正
- `res.startTime` が数値（9:00基準の分数）であるのに `.split(':')` を呼んでいたバグを修正

---

## 🔴 残課題・次にやるべきこと

### 1. アラートの検証（最優先）
前回の修正（修正A + 修正C）でアラートが正しく抑制されているか、ブラウザで実際に確認する必要がある。
- マンセル内の不足（シャンプー等）でアラートが消えているか
- マンセル外の純粋な不足ではアラートが正しく出ているか
- 「✅ 全スロット配置完了」が正しい場面で表示されるか

### 2. 不足（赤枠）の表示と実態の検証
- 「⚠不足(15分)」等のテキストがブロック内に正しく赤色で表示されているか
- マンセル（チーム対応）でカバーされている場合、予約ブロック内の不足テキスト自体を消す/変えるべきか（現場の感覚と合っているか要確認）

### 3. マンセル発動条件の精度
- 「本当に人が足りないピンチの5分間」だけ正しくレスキューが発動しているか
- 不要なマンセル発動（全員アサイン済みなのにマンセル判定される等）が残っていないか

### 4. タイムライン・フリーズの動作検証
- 当日表示で過去のアサインが変化しないことの確認
- 未来日（`isToday = false`）で全ブロックが通常通り最適化計算されることの確認
- `previousState` のキャッシュが正しく動いているか

### 5. UI全般の見やすさ
- マンセルの緑枠内のテキスト（「なぎ＆らんらん（3マンセル）」等）が読みやすいか
- 不足のある箇所が一目でわかるか

---

## 📁 主要ファイルの場所

| ファイル | 役割 |
|---|---|
| `js/services/summonEngine/index.js` | エンジン本体 + UIアダプター層 |
| `js/services/summonEngine/EngineState.js` | イミュータブルな状態オブジェクト |
| `js/services/summonEngine/pipeline/01〜06_*.js` | 6段階パイプライン |
| `js/views/mainView.js` | メインビュー（エンジン呼び出し元・アラート描画） |
| `js/components/reservation.js` | 予約ブロックのUI描画 |
| `js/components/timeline.js` | タイムライン描画（マンセル緑枠含む） |
| `data/store.json` | 予約・スタッフ・メニューのマスターデータ |
| `ARCHITECTURE_SSOT.md` | 開発完全バイブル（SSOT） |

---

## ⚡ 起動方法
```bash
cd "m:\Summon Balancer"
node server.js
# ブラウザで http://localhost:8080 を開く
```

---

この情報をもとに、マンセルシステムの実装の続き（アラート検証・不足表示のデバッグ・フリーズ動作確認）を進めてください。
SSOTの「完全イミュータブル」「純粋関数」の原則を必ず守ってください。
