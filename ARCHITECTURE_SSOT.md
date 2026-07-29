# サモンバランサー アーキテクチャ SSOT (Single Source of Truth)

本ドキュメントは、サモンバランサー（SummonEngine）のコアとなる状態管理、およびアサインメント戦略に関する絶対的な基準（バイブル）です。

## 1. データ構造の刷新 (v1.1)

従来の `slots`（配列）ベースの管理から、時間枠ごとの要件（Requirements）を管理する `timeSlots` オブジェクトベースへとデータ構造を刷新しました。

### 背景と目的
- **柔軟性の向上**: 予約単位ではなく「時間枠」単位で全体を俯瞰することで、スタイリストの掛け持ち状態を正確に把握しやすくなりました。
- **イミュータビリティの強化**: `state.master` に静的なデータ（予約、スタッフ、メニュー）を隔離し、動的なデータ（`timeSlots`, `tracker`）と完全に分離しました。これにより、純粋関数としての各フェーズ（パイプライン）の実装が容易になり、予期せぬ副作用を防ぎます。

### EngineState の構造
```javascript
{
  master: {
    reservations: [], // 静的な予約リスト
    staff: [],        // 静的なスタッフリスト
    menus: []         // 静的なメニューリスト
  },
  tracker: {
    totalAssignedSlots: {} // アシスタントID -> 割り当てられた枠数のカウント（疲労度計算用）
  },
  timeSlots: {
    "09:00": {
      time: "09:00",
      stylistOverlapCounts: { "stylist1": 2, ... },
      requirements: [
        { id: "req_09:00_res1_t1", reservationId: "res1", stylistId: "st1", requiredSkill: "shampoo", minSkillLevel: 5, tier: 1 },
        { id: "req_09:00_res1_t3", reservationId: "res1", stylistId: "st1", requiredSkill: "color", minSkillLevel: 1, tier: 3 }
      ],
      assignments: [
        // アサイン成功時
        { requirementId: "req_09:00_res1_t1", assistantId: "ast1" }
      ],
      unassignedReqs: [
        // アサイン失敗時
        { requirementId: "req_09:00_res1_t3", reason: "no_free_staff" }
      ],
      freePoolStaffIds: ["ast2", "ast3"], // その時間帯に空いているアシスタントのIDリスト
      freeTimeTasks: {}
    },
    "09:30": { ... }
  },
  workloads: {}, // 既存システム互換用 (時間ベースの稼働量)
  alerts: []
}
```

## 2. 処理フロー（パイプライン）

エンジンは 30分間隔（例: 09:00〜19:00）のループを基本とし、以下のフェーズを順次実行します。

### Phase 1: 要件定義 (01_requirementPhase.js)
1. 各時間帯に対して、重なる予約を `timeUtils.js`（分數変換）を用いて正確に判定。
2. スタイリストの掛け持ち列数を計算。
3. 掛け持ち数に応じた優先度付きの枠（Requirements）を生成し、`timeSlots` へ追加。
   - 掛け持ち≧2の場合: Tier 1 (死守枠/高スキル), Tier 3 (追加枠/低スキル)
   - 掛け持ち＝1の場合: Tier 2 (通常枠)

### Phase 2: 初回アサイン (02_primaryAssign.js)
貪欲法（Greedy）による割り当てを行います。
1. **Tierソート**: `requirements` を Tier（1 → 2 → 3）の昇順で処理。絶対に落とせない枠を優先。
2. **スタッフ選定**: `freePoolStaffIds` からスキルを満たす候補者を以下の優先順位で選出。
   - **第1条件 (贅沢防止)**: `minSkillLevel` に最も近い（スキルレベルが低い）者を優先。
   - **第2条件 (疲労度考慮)**: `tracker.totalAssignedSlots` が少ない者を優先。
   - **第3条件**: リスト順など。
3. **状態更新**:
   - 成功: `assignments` に追加、`freePoolStaffIds` から削除、`tracker` のカウントアップ。
   - 失敗: `unassignedReqs`（赤枠予備軍）に退避。

---
*このファイルは設計変更が発生した際に必ず更新すること。*
