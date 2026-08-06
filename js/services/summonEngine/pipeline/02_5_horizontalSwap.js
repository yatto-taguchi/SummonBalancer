import { hasSkill } from '../utils/skillUtils.js?v=3';

/**
 * Phase 2.5: 水平スワップ（1-hop 玉突き配置最適化）
 * 
 * Phase 2 の配置完了後に実行。各Tick内で「不足」が発生している場合にのみ発動し、
 * 「空いているアシスタント」と「既にアサイン済みのアシスタント」を1対1で入れ替えることで
 * 不足を解消する。スタイリスト召喚（Phase 3）に頼る前にアシスタント同士で解決する。
 * 
 * 設計原則:
 *   - 1-hop（1段階の入れ替え）のみ。多段の連鎖スワップは行わない
 *   - 不足がないTickはスキップ（計算量O(1)）
 *   - EngineStateのイミュータブル原則を遵守
 */
export function executeHorizontalSwap(state) {
  let nextState = state.clone();

  if (!nextState.timeSlots) return nextState;

  const assistants = (nextState.master?.staff || []).filter(s => s.type === 'assistant');
  const assistantMap = new Map(assistants.map(a => [a.id, a]));

  Object.keys(nextState.timeSlots).forEach(time => {
    // フリーズ境界以前のTickはスキップ（確定済みデータを維持）
    const [fH, fM] = time.split(':').map(Number);
    const tickMinsFrom9 = (fH - 9) * 60 + fM;
    if (nextState.freezeBoundary !== null && tickMinsFrom9 <= nextState.freezeBoundary) {
      return;
    }

    const timeSlot = nextState.timeSlots[time];
    if (!timeSlot) return;

    // 不足がない場合は即座にスキップ（軽量化の核心）
    if (!timeSlot.unassignedReqs || timeSlot.unassignedReqs.length === 0) return;

    // 空いているアシスタントのリスト（freePoolStaffIds に残っているもの）
    const freeIds = [...(timeSlot.freePoolStaffIds || [])];
    const freeAssistants = freeIds
      .map(id => assistantMap.get(id))
      .filter(Boolean);

    if (freeAssistants.length === 0) return;

    // スワップ対象外の要件を除外するフィルタ
    const isSwappableReq = (req) => {
      if (!req) return false;
      if (req.fixedAssistantId) return false;    // 固定モードは触らない
      if (req.skipAssignment) return false;       // __none__ 固定は触らない
      if (req.isHandoffProhibited) return false;  // 交代禁止タスクは途中交代不可
      return true;
    };

    // 解決済みの不足を追跡
    const resolvedReqIds = new Set();
    // 使用済みの空きアシスタントを追跡
    const usedFreeIds = new Set();

    // 各不足要件に対してスワップを試行
    for (const unassigned of timeSlot.unassignedReqs) {
      const shortfallReq = timeSlot.requirements.find(r => r.id === unassigned.requirementId);
      if (!shortfallReq) continue;
      // 不足要件自体がスワップ対象外なら（固定モード等）スキップ
      if (shortfallReq.fixedAssistantId || shortfallReq.skipAssignment) continue;

      let swapped = false;

      // 空きアシスタント F × アサイン済み要件 の全ペアを探索
      for (const freeAst of freeAssistants) {
        if (usedFreeIds.has(freeAst.id)) continue;

        for (const assignment of timeSlot.assignments) {
          // 特殊マーカーは除外
          if (assignment.assistantId === 'MANNCELL_STANDBY' || assignment.assistantId === '__none__') continue;

          const assignedReq = timeSlot.requirements.find(r => r.id === assignment.requirementId);
          if (!isSwappableReq(assignedReq)) continue;

          const assignedAst = assistantMap.get(assignment.assistantId);
          if (!assignedAst) continue;

          // 条件A: 空きアシスタント F が、アサイン済みタスクのスキルを満たすか
          if (!hasSkill(freeAst, assignedReq.requiredSkill, assignedReq.minSkillLevel)) continue;

          // 条件B: アサイン済みアシスタント A が、不足タスクのスキルを満たすか
          if (!hasSkill(assignedAst, shortfallReq.requiredSkill, shortfallReq.minSkillLevel)) continue;

          // === スワップ成立 ===
          console.log(`[Phase 2.5] 水平スワップ成立 @${time}: ` +
            `${freeAst.id}→${assignedReq.reservationId}(slot${assignedReq.slotIndex}), ` +
            `${assignedAst.id}→${shortfallReq.reservationId}(slot${shortfallReq.slotIndex})`);

          // 1. 既存アサインの担当者を F に置き換え
          assignment.assistantId = freeAst.id;

          // 2. 解放された A を不足箇所にアサイン
          timeSlot.assignments.push({
            requirementId: shortfallReq.id,
            assistantId: assignedAst.id
          });

          // 3. freePoolStaffIds から F を除外（A は元々プールにいないので操作不要）
          timeSlot.freePoolStaffIds = timeSlot.freePoolStaffIds.filter(id => id !== freeAst.id);

          // 4. tracker の更新（F に +1、A は既にカウント済みなので変更なし）
          const fTracker = nextState.tracker[freeAst.id] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
          nextState.tracker = {
            ...nextState.tracker,
            [freeAst.id]: {
              ...fTracker,
              totalAssignedSlots: fTracker.totalAssignedSlots + 1
            }
          };

          // 5. ongoingTasks の更新
          if (!nextState.ongoingTasks) nextState.ongoingTasks = {};
          const assignedTaskKey = `${assignedReq.reservationId}_${assignedReq.slotIndex}`;
          const shortfallTaskKey = `${shortfallReq.reservationId}_${shortfallReq.slotIndex}`;
          nextState.ongoingTasks[assignedTaskKey] = freeAst.id;
          nextState.ongoingTasks[shortfallTaskKey] = assignedAst.id;

          // マーキング
          resolvedReqIds.add(unassigned.requirementId);
          usedFreeIds.add(freeAst.id);
          swapped = true;
          break;
        }
        if (swapped) break;
      }
    }

    // 解決された不足要件を unassignedReqs から除去
    if (resolvedReqIds.size > 0) {
      timeSlot.unassignedReqs = timeSlot.unassignedReqs.filter(
        u => !resolvedReqIds.has(u.requirementId)
      );
      console.log(`[Phase 2.5] @${time}: ${resolvedReqIds.size}件の不足を水平スワップで解消`);
    }
  });

  return nextState;
}
