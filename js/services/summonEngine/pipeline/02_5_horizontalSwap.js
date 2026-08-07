import { hasSkill } from '../utils/skillUtils.js?v=3';

/**
 * Phase 2.5: 後方スイープ（Backward Sweep — 1-hop チェーンスワップ）
 *
 * Phase 2（基本配置）が全Tickを処理し終えた後に実行する最適化フェーズ。
 *
 * 問題:
 *   Phase 2 は各Tickを独立に処理するため、交代禁止タスク（シャンプー等）が
 *   アシスタントを長時間ロックし、後のTickで不足を引き起こすケースがある。
 *   例: 10:00でなぎがシャンプー(交代禁止)に入る → 10:40でなぎ不在 → 不足発生
 *
 * 解決:
 *   不足Tickから「過去をたどって」ロックの原因となったタスクチェーンを特定し、
 *   チェーン全体を空いている別のアシスタントに移行する。
 *   これにより元のアシスタントが解放され、不足が解消される。
 *
 * 設計原則:
 *   - 不足がないTick群は即スキップ（O(1)）
 *   - 1-hop のみ（多段連鎖スワップは行わない）
 *   - チェーン長が1の場合は従来の水平スワップと同等に機能（統合）
 *   - EngineState のイミュータブル原則を遵守（state.clone() + スプレッド構文）
 *   - 交代禁止タスクもチェーン全体を置き換えるため、途中交代は発生しない
 */
export function executeBackwardSweep(state) {
  const nextState = state.clone();

  if (!nextState.timeSlots) return nextState;

  const assistants = (nextState.master?.staff || []).filter(s => s.type === 'assistant');
  const assistantMap = new Map(assistants.map(a => [a.id, a]));

  // 全Tickをソート済みリストとして保持（時間順）
  const sortedTimes = Object.keys(nextState.timeSlots).sort();

  // ── Step 1: 不足があるTickを収集 ──
  const shortfallTimeIndices = [];
  for (let i = 0; i < sortedTimes.length; i++) {
    const time = sortedTimes[i];

    // フリーズ境界チェック
    const [h, m] = time.split(':').map(Number);
    const tickMins = (h - 9) * 60 + m;
    if (nextState.freezeBoundary !== null && tickMins <= nextState.freezeBoundary) continue;

    const ts = nextState.timeSlots[time];
    if (ts && ts.unassignedReqs && ts.unassignedReqs.length > 0) {
      shortfallTimeIndices.push(i);
    }
  }

  // 不足なし → 即リターン（軽量化の核心）
  if (shortfallTimeIndices.length === 0) return nextState;

  // ── Step 2: 各不足Tickについて後方スイープ ──
  for (const timeIdx of shortfallTimeIndices) {
    const shortfallTime = sortedTimes[timeIdx];
    const shortfallTS = nextState.timeSlots[shortfallTime];
    if (!shortfallTS || !shortfallTS.unassignedReqs || shortfallTS.unassignedReqs.length === 0) continue;

    const resolvedReqIds = new Set();

    for (const unassigned of [...shortfallTS.unassignedReqs]) {
      const shortfallReq = shortfallTS.requirements.find(r => r.id === unassigned.requirementId);
      if (!shortfallReq) continue;
      // 固定モード・スキップ対象は除外
      if (shortfallReq.fixedAssistantId || shortfallReq.skipAssignment) continue;

      let resolved = false;

      // 不足Tickで忙しい各アシスタント(A)を検査:「Aが空けば不足を解消できるか?」
      for (const assignment of shortfallTS.assignments) {
        if (assignment.assistantId === 'MANNCELL_STANDBY' || assignment.assistantId === '__none__') continue;

        const busyAst = assistantMap.get(assignment.assistantId);
        if (!busyAst) continue;

        // A が不足タスクのスキルを持っているか
        if (!hasSkill(busyAst, shortfallReq.requiredSkill, shortfallReq.minSkillLevel)) continue;

        // A が現在やっているタスクの要件を特定
        const busyReq = shortfallTS.requirements.find(r => r.id === assignment.requirementId);
        if (!busyReq) continue;
        const busyTaskKey = `${busyReq.reservationId}_${busyReq.slotIndex}`;

        // ── A のタスクチェーン全体（過去＋未来）を特定 ──
        // 後方探索: shortfallTime から過去へ、同じ A × 同じタスクキー の連続を探す
        let chainStartIdx = timeIdx;
        for (let i = timeIdx - 1; i >= 0; i--) {
          const prevTS = nextState.timeSlots[sortedTimes[i]];
          if (!prevTS) break;
          const found = prevTS.assignments.some(a =>
            a.assistantId === busyAst.id &&
            prevTS.requirements.some(r => r.id === a.requirementId &&
              `${r.reservationId}_${r.slotIndex}` === busyTaskKey)
          );
          if (found) { chainStartIdx = i; } else { break; }
        }

        // 前方探索: shortfallTime から未来へ、同じチェーンの継続を探す
        let chainEndIdx = timeIdx;
        for (let i = timeIdx + 1; i < sortedTimes.length; i++) {
          const nextTS = nextState.timeSlots[sortedTimes[i]];
          if (!nextTS) break;
          const found = nextTS.assignments.some(a =>
            a.assistantId === busyAst.id &&
            nextTS.requirements.some(r => r.id === a.requirementId &&
              `${r.reservationId}_${r.slotIndex}` === busyTaskKey)
          );
          if (found) { chainEndIdx = i; } else { break; }
        }

        const fullChainTicks = sortedTimes.slice(chainStartIdx, chainEndIdx + 1);
        const chainLength = fullChainTicks.length;

        // ── チェーン開始Tickで空いているアシスタント(F)を探す ──
        const chainStartTS = nextState.timeSlots[fullChainTicks[0]];
        if (!chainStartTS) continue;

        // チェーン開始Tickのタスク要件（F に必要なスキルの判定用）
        const chainStartReq = chainStartTS.requirements.find(r =>
          `${r.reservationId}_${r.slotIndex}` === busyTaskKey
        );
        if (!chainStartReq) continue;

        // 候補 F をソート: 累計アサイン数が少ない順（お客様ファースト原則）
        const candidateFreeIds = [...(chainStartTS.freePoolStaffIds || [])];
        candidateFreeIds.sort((idA, idB) => {
          const countA = nextState.tracker[idA]?.totalAssignedSlots || 0;
          const countB = nextState.tracker[idB]?.totalAssignedSlots || 0;
          return countA - countB;
        });

        for (const freeId of candidateFreeIds) {
          const freeAst = assistantMap.get(freeId);
          if (!freeAst) continue;

          // F がチェーンタスクのスキルを持つか
          if (!hasSkill(freeAst, chainStartReq.requiredSkill, chainStartReq.minSkillLevel)) continue;

          // F がチェーン全期間にわたって空いているか確認
          let freeForEntireChain = true;
          for (const chainTime of fullChainTicks) {
            const chainTS = nextState.timeSlots[chainTime];
            if (!chainTS || !(chainTS.freePoolStaffIds || []).includes(freeAst.id)) {
              freeForEntireChain = false;
              break;
            }
          }
          if (!freeForEntireChain) continue;

          // ═══════════════════════════════════════════
          //  チェーンスワップ成立！
          // ═══════════════════════════════════════════
          console.log(
            `[Phase 2.5 Backward Sweep] チェーンスワップ成立: ` +
            `${busyAst.id} → ${freeAst.id} (タスク ${busyTaskKey}, ` +
            `${fullChainTicks[0]}〜${fullChainTicks[chainLength - 1]}, ${chainLength}Tick) ` +
            `→ ${busyAst.id} を @${shortfallTime} の不足に配置`
          );

          // ── 全チェーンTickで A → F に置き換え ──
          for (const chainTime of fullChainTicks) {
            const chainTS = nextState.timeSlots[chainTime];

            // アサインの担当者を A → F に変更
            for (const ca of chainTS.assignments) {
              if (ca.assistantId !== busyAst.id) continue;
              const caReq = chainTS.requirements.find(r => r.id === ca.requirementId);
              if (caReq && `${caReq.reservationId}_${caReq.slotIndex}` === busyTaskKey) {
                ca.assistantId = freeAst.id;
                break;
              }
            }

            // freePoolStaffIds の更新
            chainTS.freePoolStaffIds = chainTS.freePoolStaffIds.filter(id => id !== freeAst.id);
            if (chainTime !== shortfallTime && !chainTS.freePoolStaffIds.includes(busyAst.id)) {
              // shortfallTime 以外では A は解放（freePool に復帰）
              chainTS.freePoolStaffIds.push(busyAst.id);
            }
          }

          // ── shortfallTime で A を不足タスクにアサイン ──
          shortfallTS.assignments.push({
            requirementId: shortfallReq.id,
            assistantId: busyAst.id
          });

          // ── tracker の更新（イミュータブル） ──
          // A: チェーンから外れ(-N)、不足に配置(+1) → 純減 -(N-1)
          //    ただし shortfallTime の分は「タスク入替」なので±0 → 純減 -(chainLength-1)
          const aTracker = nextState.tracker[busyAst.id] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
          nextState.tracker = {
            ...nextState.tracker,
            [busyAst.id]: {
              ...aTracker,
              totalAssignedSlots: Math.max(0, aTracker.totalAssignedSlots - (chainLength - 1))
            }
          };

          // F: チェーン全Tickに新規配置(+chainLength)
          const fTracker = nextState.tracker[freeAst.id] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
          nextState.tracker = {
            ...nextState.tracker,
            [freeAst.id]: {
              ...fTracker,
              totalAssignedSlots: fTracker.totalAssignedSlots + chainLength
            }
          };

          // ── ongoingTasks の更新 ──
          if (!nextState.ongoingTasks) nextState.ongoingTasks = {};
          nextState.ongoingTasks[busyTaskKey] = freeAst.id;
          const shortfallTaskKey = `${shortfallReq.reservationId}_${shortfallReq.slotIndex}`;
          nextState.ongoingTasks[shortfallTaskKey] = busyAst.id;

          // マーキング
          resolvedReqIds.add(unassigned.requirementId);
          resolved = true;
          break; // F が見つかったので候補探索終了
        }
        if (resolved) break; // 不足が解消されたのでアシスタント探索終了
      }
    }

    // 解消された不足を unassignedReqs から除去
    if (resolvedReqIds.size > 0) {
      shortfallTS.unassignedReqs = shortfallTS.unassignedReqs.filter(
        u => !resolvedReqIds.has(u.requirementId)
      );
      console.log(`[Phase 2.5 Backward Sweep] @${shortfallTime}: ${resolvedReqIds.size}件の不足を解消`);
    }
  }

  return nextState;
}
