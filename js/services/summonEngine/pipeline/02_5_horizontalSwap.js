import { hasSkill } from '../utils/skillUtils.js?v=3';

/**
 * Phase 5.6: 最終最適化（Backward Sweep — ハンドオフ解消 + 不足解消）
 *
 * Phase 1〜5.5 の全アサインが確定した後に実行するグローバル最適化フェーズ。
 *
 * 2つのパスで最適化を実行する:
 *
 *   Pass 1 — ハンドオフ検出:
 *     同一タスク（予約+スロット）を複数アシスタントがリレーする「細切れ」パターンを検出。
 *     メインアシスタント(A)のブロッキングチェーンを空きアシスタント(F)に移行し、
 *     Aがタスク全体を一人で担当できるようにする。
 *     例: しょ(10分)→なぎ(20分) → なぎ(30分)に統一
 *
 *   Pass 2 — 未アサイン解消:
 *     Phase 2〜5.5 で Tier 1 要件がアサインされなかったTick（unassignedReqs）について、
 *     忙しいアシスタントのブロッキングチェーンを空きアシスタントに移行し、不足を解消。
 *
 * 設計原則:
 *   - 不足もハンドオフもない場合は即スキップ（O(1)）
 *   - 1-hop のみ（多段連鎖スワップは行わない）
 *   - EngineState のイミュータブル原則を遵守（state.clone() + スプレッド構文）
 *   - 交代禁止タスクもチェーン全体を置き換えるため、途中交代は発生しない
 *   - Phase 5.5（隙間配置）の結果を含む全アサインを対象とする
 */
export function executeBackwardSweep(state) {
  const nextState = state.clone();

  if (!nextState.timeSlots) return nextState;

  const assistants = (nextState.master?.staff || []).filter(s => s.type === 'assistant');
  const assistantMap = new Map(assistants.map(a => [a.id, a]));
  const sortedTimes = Object.keys(nextState.timeSlots).sort();

  /** フリーズ境界チェック */
  const isFrozen = (time) => {
    if (nextState.freezeBoundary === null) return false;
    const [h, m] = time.split(':').map(Number);
    return ((h - 9) * 60 + m) <= nextState.freezeBoundary;
  };

  // ═══════════════════════════════════════════════════════
  //  Pass 1: ハンドオフ（細切れ）検出と解消
  // ═══════════════════════════════════════════════════════

  // Step 1: 全タスクキーごとにアサイン状況をグルーピング
  const taskAssignments = new Map(); // taskKey → [{time, timeIdx, assistantId, requirementId}]

  for (let i = 0; i < sortedTimes.length; i++) {
    const time = sortedTimes[i];
    if (isFrozen(time)) continue;
    const ts = nextState.timeSlots[time];
    if (!ts || !ts.assignments) continue;

    for (const assign of ts.assignments) {
      if (assign.assistantId === 'MANNCELL_STANDBY' || assign.assistantId === '__none__') continue;
      const req = (ts.requirements || []).find(r => r.id === assign.requirementId);
      if (!req) continue;
      const taskKey = `${req.reservationId}_${req.slotIndex}`;

      if (!taskAssignments.has(taskKey)) {
        taskAssignments.set(taskKey, []);
      }
      taskAssignments.get(taskKey).push({
        time, timeIdx: i, assistantId: assign.assistantId, requirementId: assign.requirementId
      });
    }
  }

  // Step 2: ハンドオフ検出と解消
  for (const [taskKey, entries] of taskAssignments) {
    entries.sort((a, b) => a.time.localeCompare(b.time));

    // 同一タスクに複数アシスタントが存在するか
    const uniqueAsts = new Set(entries.map(e => e.assistantId));
    if (uniqueAsts.size <= 1) continue; // ハンドオフなし → スキップ

    // 連続セグメントに分割
    const segments = [];
    let curSeg = null;
    for (const entry of entries) {
      if (!curSeg || curSeg.assistantId !== entry.assistantId) {
        curSeg = { assistantId: entry.assistantId, entries: [entry] };
        segments.push(curSeg);
      } else {
        curSeg.entries.push(entry);
      }
    }
    if (segments.length <= 1) continue;

    // 最長セグメントを「メインアシスタント(A)」として特定
    const sortedSegs = [...segments].sort((a, b) => b.entries.length - a.entries.length);
    const mainSeg = sortedSegs[0];
    const mainAstId = mainSeg.assistantId;
    const mainAst = assistantMap.get(mainAstId);
    if (!mainAst) continue;

    // 各ギャップセグメント（メイン以外）を解消
    for (const gapSeg of sortedSegs.slice(1)) {
      const gapAstId = gapSeg.assistantId;

      // A がギャップ時間帯で何をしているか特定
      let blockingTaskKey = null;
      let blockingReq = null;

      for (const gapEntry of gapSeg.entries) {
        const ts = nextState.timeSlots[gapEntry.time];
        if (!ts) continue;
        for (const assign of ts.assignments) {
          if (assign.assistantId !== mainAstId) continue;
          const req = (ts.requirements || []).find(r => r.id === assign.requirementId);
          if (!req) continue;
          blockingTaskKey = `${req.reservationId}_${req.slotIndex}`;
          blockingReq = req;
          break;
        }
        if (blockingTaskKey) break;
      }

      if (!blockingTaskKey) continue; // A はギャップ時間帯に何もしていない

      // ── A のブロッキングチェーン全体を特定 ──
      const refIdx = gapSeg.entries[0].timeIdx;

      let chainStartIdx = refIdx;
      for (let i = refIdx - 1; i >= 0; i--) {
        if (isFrozen(sortedTimes[i])) break;
        const prevTS = nextState.timeSlots[sortedTimes[i]];
        if (!prevTS) break;
        const found = prevTS.assignments.some(a =>
          a.assistantId === mainAstId &&
          (prevTS.requirements || []).some(r => r.id === a.requirementId &&
            `${r.reservationId}_${r.slotIndex}` === blockingTaskKey)
        );
        if (found) { chainStartIdx = i; } else { break; }
      }

      let chainEndIdx = refIdx;
      for (let i = refIdx + 1; i < sortedTimes.length; i++) {
        if (isFrozen(sortedTimes[i])) break;
        const fwdTS = nextState.timeSlots[sortedTimes[i]];
        if (!fwdTS) break;
        const found = fwdTS.assignments.some(a =>
          a.assistantId === mainAstId &&
          (fwdTS.requirements || []).some(r => r.id === a.requirementId &&
            `${r.reservationId}_${r.slotIndex}` === blockingTaskKey)
        );
        if (found) { chainEndIdx = i; } else { break; }
      }

      const fullChainTicks = sortedTimes.slice(chainStartIdx, chainEndIdx + 1);
      const chainLength = fullChainTicks.length;

      // ── チェーン開始Tickで空きアシスタント(F)を探す ──
      const chainStartTS = nextState.timeSlots[fullChainTicks[0]];
      if (!chainStartTS) continue;

      const chainStartReq = (chainStartTS.requirements || []).find(r =>
        `${r.reservationId}_${r.slotIndex}` === blockingTaskKey
      );
      if (!chainStartReq) continue;

      // 候補 F をソート: 累計アサイン数が少ない順
      const candidateIds = [...(chainStartTS.freePoolStaffIds || [])];
      candidateIds.sort((idA, idB) => {
        const cA = nextState.tracker[idA]?.totalAssignedSlots || 0;
        const cB = nextState.tracker[idB]?.totalAssignedSlots || 0;
        return cA - cB;
      });

      let resolved = false;
      for (const freeId of candidateIds) {
        const freeAst = assistantMap.get(freeId);
        if (!freeAst) continue;

        // F がブロッキングタスクのスキルを満たすか
        if (!hasSkill(freeAst, chainStartReq.requiredSkill, chainStartReq.minSkillLevel)) continue;

        // F がチェーン全期間にわたって空いているか
        let freeForChain = true;
        for (const chainTime of fullChainTicks) {
          const chainTS = nextState.timeSlots[chainTime];
          if (!chainTS || !(chainTS.freePoolStaffIds || []).includes(freeAst.id)) {
            freeForChain = false;
            break;
          }
        }
        if (!freeForChain) continue;

        // ═══════════════════════════════════════════
        //  ハンドオフ解消スワップ成立！
        // ═══════════════════════════════════════════
        console.log(
          `[Phase 5.6 ハンドオフ解消] タスク ${taskKey}: ` +
          `${gapAstId}(${gapSeg.entries.length}Tick)→${mainAstId}(${mainSeg.entries.length}Tick) を検出。` +
          `${mainAstId} のブロック (${blockingTaskKey}, ${fullChainTicks[0]}〜${fullChainTicks[chainLength - 1]}) を ` +
          `${freeAst.id} に移行 → ハンドオフ解消`
        );

        const gapTimeSet = new Set(gapSeg.entries.map(e => e.time));

        // ── 1. 全チェーンTickで A → F に置き換え ──
        for (const chainTime of fullChainTicks) {
          const chainTS = nextState.timeSlots[chainTime];
          for (const ca of chainTS.assignments) {
            if (ca.assistantId !== mainAstId) continue;
            const caReq = (chainTS.requirements || []).find(r => r.id === ca.requirementId);
            if (caReq && `${caReq.reservationId}_${caReq.slotIndex}` === blockingTaskKey) {
              ca.assistantId = freeAst.id;
              break;
            }
          }
          // freePoolStaffIds: F を除外、非ギャップTickでは A を復帰
          chainTS.freePoolStaffIds = chainTS.freePoolStaffIds.filter(id => id !== freeAst.id);
          if (!gapTimeSet.has(chainTime) && !chainTS.freePoolStaffIds.includes(mainAstId)) {
            chainTS.freePoolStaffIds.push(mainAstId);
          }
        }

        // ── 2. ギャップTickで gapAst → A に置き換え ──
        for (const gapEntry of gapSeg.entries) {
          const gapTS = nextState.timeSlots[gapEntry.time];
          for (const ga of gapTS.assignments) {
            if (ga.assistantId !== gapAstId || ga.requirementId !== gapEntry.requirementId) continue;
            ga.assistantId = mainAstId;
            break;
          }
          // gapAst を解放（freePool に戻す）
          if (!gapTS.freePoolStaffIds.includes(gapAstId)) {
            gapTS.freePoolStaffIds.push(gapAstId);
          }
        }

        // ── 3. tracker の更新（スプレッド構文でイミュータブル） ──
        const gapLength = gapSeg.entries.length;

        // A: チェーン全体から外れ(-chainLength)、ギャップTickで復帰(+gapLength)
        //    ※ ギャップTickではタスク入替（ブロッキング→ハンドオフ）なのでカウント±0
        //    → 純減: -(chainLength - gapLength)
        const aTracker = nextState.tracker[mainAstId] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
        nextState.tracker = {
          ...nextState.tracker,
          [mainAstId]: {
            ...aTracker,
            totalAssignedSlots: Math.max(0, aTracker.totalAssignedSlots - (chainLength - gapLength))
          }
        };

        // gapAst: ギャップTickから解放 → -gapLength
        const gapTracker = nextState.tracker[gapAstId] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
        nextState.tracker = {
          ...nextState.tracker,
          [gapAstId]: {
            ...gapTracker,
            totalAssignedSlots: Math.max(0, gapTracker.totalAssignedSlots - gapLength)
          }
        };

        // F: チェーン全Tickに新規配置 → +chainLength
        const fTracker = nextState.tracker[freeAst.id] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
        nextState.tracker = {
          ...nextState.tracker,
          [freeAst.id]: {
            ...fTracker,
            totalAssignedSlots: fTracker.totalAssignedSlots + chainLength
          }
        };

        // ── 4. ongoingTasks の更新 ──
        if (!nextState.ongoingTasks) nextState.ongoingTasks = {};
        nextState.ongoingTasks[blockingTaskKey] = freeAst.id;
        nextState.ongoingTasks[taskKey] = mainAstId;

        resolved = true;
        break; // F が見つかったので候補探索終了
      }

      if (resolved) break; // このタスクのハンドオフは解消済み
    }
  }

  // ═══════════════════════════════════════════════════════
  //  Pass 2: unassignedReqs による不足解消（従来ロジック）
  // ═══════════════════════════════════════════════════════

  const shortfallTimeIndices = [];
  for (let i = 0; i < sortedTimes.length; i++) {
    const time = sortedTimes[i];
    if (isFrozen(time)) continue;
    const ts = nextState.timeSlots[time];
    if (ts && ts.unassignedReqs && ts.unassignedReqs.length > 0) {
      shortfallTimeIndices.push(i);
    }
  }

  for (const timeIdx of shortfallTimeIndices) {
    const shortfallTime = sortedTimes[timeIdx];
    const shortfallTS = nextState.timeSlots[shortfallTime];
    if (!shortfallTS || !shortfallTS.unassignedReqs || shortfallTS.unassignedReqs.length === 0) continue;

    const resolvedReqIds = new Set();

    for (const unassigned of [...shortfallTS.unassignedReqs]) {
      const shortfallReq = (shortfallTS.requirements || []).find(r => r.id === unassigned.requirementId);
      if (!shortfallReq || shortfallReq.fixedAssistantId || shortfallReq.skipAssignment) continue;

      let resolved = false;

      for (const assignment of shortfallTS.assignments) {
        if (assignment.assistantId === 'MANNCELL_STANDBY' || assignment.assistantId === '__none__') continue;
        const busyAst = assistantMap.get(assignment.assistantId);
        if (!busyAst) continue;
        if (!hasSkill(busyAst, shortfallReq.requiredSkill, shortfallReq.minSkillLevel)) continue;

        const busyReq = (shortfallTS.requirements || []).find(r => r.id === assignment.requirementId);
        if (!busyReq) continue;
        const busyTaskKey = `${busyReq.reservationId}_${busyReq.slotIndex}`;

        // チェーン全体を特定
        let chainStartIdx = timeIdx;
        for (let i = timeIdx - 1; i >= 0; i--) {
          if (isFrozen(sortedTimes[i])) break;
          const prevTS = nextState.timeSlots[sortedTimes[i]];
          if (!prevTS) break;
          const found = prevTS.assignments.some(a =>
            a.assistantId === busyAst.id &&
            (prevTS.requirements || []).some(r => r.id === a.requirementId &&
              `${r.reservationId}_${r.slotIndex}` === busyTaskKey)
          );
          if (found) { chainStartIdx = i; } else { break; }
        }

        let chainEndIdx = timeIdx;
        for (let i = timeIdx + 1; i < sortedTimes.length; i++) {
          if (isFrozen(sortedTimes[i])) break;
          const fwdTS = nextState.timeSlots[sortedTimes[i]];
          if (!fwdTS) break;
          const found = fwdTS.assignments.some(a =>
            a.assistantId === busyAst.id &&
            (fwdTS.requirements || []).some(r => r.id === a.requirementId &&
              `${r.reservationId}_${r.slotIndex}` === busyTaskKey)
          );
          if (found) { chainEndIdx = i; } else { break; }
        }

        const fullChainTicks = sortedTimes.slice(chainStartIdx, chainEndIdx + 1);
        const chainLength = fullChainTicks.length;

        const chainStartTS = nextState.timeSlots[fullChainTicks[0]];
        if (!chainStartTS) continue;
        const chainStartReq = (chainStartTS.requirements || []).find(r =>
          `${r.reservationId}_${r.slotIndex}` === busyTaskKey
        );
        if (!chainStartReq) continue;

        const candidateIds = [...(chainStartTS.freePoolStaffIds || [])];
        candidateIds.sort((a, b) =>
          (nextState.tracker[a]?.totalAssignedSlots || 0) - (nextState.tracker[b]?.totalAssignedSlots || 0)
        );

        for (const freeId of candidateIds) {
          const freeAst = assistantMap.get(freeId);
          if (!freeAst) continue;
          if (!hasSkill(freeAst, chainStartReq.requiredSkill, chainStartReq.minSkillLevel)) continue;

          let freeForChain = true;
          for (const chainTime of fullChainTicks) {
            const chainTS = nextState.timeSlots[chainTime];
            if (!chainTS || !(chainTS.freePoolStaffIds || []).includes(freeAst.id)) {
              freeForChain = false;
              break;
            }
          }
          if (!freeForChain) continue;

          // ═══ スワップ成立 ═══
          console.log(
            `[Phase 5.6 不足解消] ${busyAst.id} のブロック (${busyTaskKey}, ` +
            `${fullChainTicks[0]}〜${fullChainTicks[chainLength - 1]}) を ` +
            `${freeAst.id} に移行 → ${busyAst.id} を @${shortfallTime} の不足に配置`
          );

          for (const chainTime of fullChainTicks) {
            const chainTS = nextState.timeSlots[chainTime];
            for (const ca of chainTS.assignments) {
              if (ca.assistantId !== busyAst.id) continue;
              const caReq = (chainTS.requirements || []).find(r => r.id === ca.requirementId);
              if (caReq && `${caReq.reservationId}_${caReq.slotIndex}` === busyTaskKey) {
                ca.assistantId = freeAst.id;
                break;
              }
            }
            chainTS.freePoolStaffIds = chainTS.freePoolStaffIds.filter(id => id !== freeAst.id);
            if (chainTime !== shortfallTime && !chainTS.freePoolStaffIds.includes(busyAst.id)) {
              chainTS.freePoolStaffIds.push(busyAst.id);
            }
          }

          shortfallTS.assignments.push({
            requirementId: shortfallReq.id,
            assistantId: busyAst.id
          });

          const aTracker = nextState.tracker[busyAst.id] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
          nextState.tracker = {
            ...nextState.tracker,
            [busyAst.id]: { ...aTracker, totalAssignedSlots: Math.max(0, aTracker.totalAssignedSlots - (chainLength - 1)) }
          };
          const fTracker = nextState.tracker[freeAst.id] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
          nextState.tracker = {
            ...nextState.tracker,
            [freeAst.id]: { ...fTracker, totalAssignedSlots: fTracker.totalAssignedSlots + chainLength }
          };

          if (!nextState.ongoingTasks) nextState.ongoingTasks = {};
          nextState.ongoingTasks[busyTaskKey] = freeAst.id;
          const sfTaskKey = `${shortfallReq.reservationId}_${shortfallReq.slotIndex}`;
          nextState.ongoingTasks[sfTaskKey] = busyAst.id;

          resolvedReqIds.add(unassigned.requirementId);
          resolved = true;
          break;
        }
        if (resolved) break;
      }
    }

    if (resolvedReqIds.size > 0) {
      shortfallTS.unassignedReqs = shortfallTS.unassignedReqs.filter(
        u => !resolvedReqIds.has(u.requirementId)
      );
      console.log(`[Phase 5.6 不足解消] @${shortfallTime}: ${resolvedReqIds.size}件解消`);
    }
  }

  return nextState;
}
