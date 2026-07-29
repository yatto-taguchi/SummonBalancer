import { hasSkill } from '../utils/skillUtils.js?v=3';
import { isStaffFree, toTimestamp, formatTime } from '../utils/timeUtils.js?v=3';
import { compareAssistants } from '../utils/scoringUtils.js?v=3';

export function executeFallbackReassign(state) {
  let nextState = state.clone();

  const fb = nextState.freezeBoundary;
  const unassignedSlots = nextState.slots.filter(s => {
    if (s.status !== 'unassigned') return false;
    // フリーズ境界以前のスロットは再アサインの対象外
    if (fb !== null && typeof s.startTime === 'number' && s.startTime <= fb) return false;
    return true;
  });
  if (unassignedSlots.length === 0) return nextState;

  const assistants = nextState.staff.filter(s => s.type === 'assistant');
  const stylists = nextState.staff.filter(s => s.type === 'stylist');

  // 1. スタイリストの稼働時間（優先度用）を計算（フェーズ3と同じロジック）
  const stylistWorkload = {};
  stylists.forEach(s => stylistWorkload[s.id] = 0);
  nextState.reservations.forEach(r => {
    if (stylistWorkload[r.stylistId] !== undefined) {
      const duration = toTimestamp(r.endTime) - toTimestamp(r.startTime);
      stylistWorkload[r.stylistId] += duration;
    }
  });

  // 2. スロットのソート（開始時間順 -> 優先度順）
  const sortedSlots = [...unassignedSlots].sort((a, b) => {
    const timeA = toTimestamp(a.startTime);
    const timeB = toTimestamp(b.startTime);
    if (timeA !== timeB) return timeA - timeB; // 開始時間順

    const stylistA = stylists.find(s => s.id === a.stylistId);
    const stylistB = stylists.find(s => s.id === b.stylistId);
    
    const isOwnerOrPriorityA = stylistA && (stylistA.rank === 'owner' || stylistA.prioritySummon);
    const isOwnerOrPriorityB = stylistB && (stylistB.rank === 'owner' || stylistB.prioritySummon);
    
    // オーナー・優先トグルONは最優先
    if (isOwnerOrPriorityA && !isOwnerOrPriorityB) return -1;
    if (!isOwnerOrPriorityA && isOwnerOrPriorityB) return 1;

    // 稼働時間が長い人を優先
    const loadA = stylistA ? stylistWorkload[stylistA.id] : 0;
    const loadB = stylistB ? stylistWorkload[stylistB.id] : 0;
    return loadB - loadA;
  });

  // 3. 各スロットへの再アサイン処理
  for (const slot of sortedSlots) {
    // --- 候補者のフィルタリングと選出 ---
    let candidates = nextState.staff.filter(a => {
      // 自己召喚バグの防止（自分の予約には入れない）
      if (a.id === slot.stylistId) return false;
      // スキルチェック
      if (!hasSkill(a, slot.requiredSkill, slot.requiredProficiency)) return false;
      // 空き時間チェック
      if (!isStaffFree(a.id, slot.startTime, slot.endTime, nextState.slots, nextState.assignments, nextState.reservations)) return false;
      return true;
    });

    if (candidates.length === 0) {
      // フォールバックでもアサインできなかった場合
      // ※アラートはUIアダプター層（index.js）で一括生成するため、ここでは追加しない
      
      // UIで赤枠を描画させるため、stylistSummons にバッジなしで追加
      nextState.stylistSummons.push({
        stylistId: slot.stylistId,
        reservationId: slot.reservationId,
        slotIndex: slot.slotIndex,
        startTime: slot.startTime,
        endTime: slot.endTime,
        badge: false,
        isSpecialSummon: false
      });
      continue;
    }

    if (slot.fixedAssistantId) {
      const fixed = candidates.find(c => c.id === slot.fixedAssistantId);
      if (fixed) candidates = [fixed];
    } else {
      let previousAssigneeId = null;
      if (slot.slotIndex > 0 && nextState.assignments[slot.reservationId]) {
        previousAssigneeId = nextState.assignments[slot.reservationId][slot.slotIndex - 1];
      }
      candidates.sort((a, b) => compareAssistants(a, b, nextState, previousAssigneeId, slot));
    }

    const selectedAssistant = candidates[0];
    nextState = nextState.assignAssistant(slot.id, selectedAssistant.id);
  }

  // ※最終アラートの出力はUIアダプター層（index.js）で一括生成するため、ここでは行わない
  
  return nextState;
}
