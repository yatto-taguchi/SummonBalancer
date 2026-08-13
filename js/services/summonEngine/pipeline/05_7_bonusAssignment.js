import { hasSkill } from '../utils/skillUtils.js?v=3';
import { toTimestamp, isStaffBlocked } from '../utils/timeUtils.js?v=3';
import { Reservation } from '../../../models/reservation.js?v=3';

/**
 * Phase 5.7: お手伝いサポート (Bonus Assignment)
 * 余裕のあるプラスアルファの支援を行うフェーズ。
 * 疲労度を加算せず、単独タスク(不足エラーでないもの)に空きアシスタントをアサインする。
 */
export function executeBonusAssignment(state) {
  let nextState = state.clone();

  if (!nextState.timeSlots) return nextState;

  const assistants = (nextState.master?.staff || nextState.staff || []).filter(s => s.type === 'assistant' && s.isWorking);

  let currentTracker = { ...(nextState.tracker || {}) };
  let currentOngoingTasks = { ...(nextState.ongoingTasks || {}) };

  const sortedTimes = Object.keys(nextState.timeSlots).sort();

  sortedTimes.forEach(timeStr => {
    const [tH, tM] = timeStr.split(':').map(Number);
    const tickMinsFrom9 = (tH - 9) * 60 + tM;
    
    if (nextState.freezeBoundary !== null && tickMinsFrom9 <= nextState.freezeBoundary) {
      return;
    }

    const timeSlot = nextState.timeSlots[timeStr];
    if (!timeSlot) return;

    // このTickで現在完全に手が空いているアシスタントのIDプール
    let freeAssistantIds = new Set(assistants.map(a => a.id));
    timeSlot.assignments.forEach(a => {
      if (a.assistantId !== 'MANNCELL_STANDBY' && a.assistantId !== '__none__') {
        freeAssistantIds.delete(a.assistantId);
      }
    });

    if (freeAssistantIds.size === 0) return;

    const targetReqs = [];
    timeSlot.requirements.forEach(req => {
      if (req.skipAssignment) return; // アサイン不要は除外

      // 不足エラー(unassignedReqs)になっているものは対象外
      const isUnassignedError = timeSlot.unassignedReqs?.some(ur => ur.requirementId === req.id);
      if (isUnassignedError) return;

      const existingAssign = timeSlot.assignments.find(a => a.requirementId === req.id);
      
      // アシスタントがアサインされていない(__none__ アサイン、または存在しない)場合
      if (!existingAssign || existingAssign.assistantId === '__none__') {
        // 対象外メニューの除外: シャンプー、トリートメント、スパなどはスキップ
        const reqSkillLower = (req.requiredSkill || '').toLowerCase();
        if (reqSkillLower.includes('shampoo') || reqSkillLower.includes('シャンプー') ||
            reqSkillLower.includes('treatment') || reqSkillLower.includes('トリートメント') ||
            reqSkillLower.includes('spa') || reqSkillLower.includes('スパ') ||
            reqSkillLower.includes('ヘッドスパ')) {
          return;
        }

        targetReqs.push(req);
      }
    });

    for (const req of targetReqs) {
      if (freeAssistantIds.size === 0) break;

      let assignedAssistantId = null;

      // 1. 直前アサイン（ソフトロック）の優先チェック
      const taskKey = `${req.reservationId}_${req.slotIndex}`;
      const ongoingId = currentOngoingTasks[taskKey];
      if (ongoingId && freeAssistantIds.has(ongoingId)) {
        const staffObj = assistants.find(a => a.id === ongoingId);
        // 【追加修正】ブロック中ではないか確認
        if (staffObj && hasSkill(staffObj, req.requiredSkill, 1) && !isStaffBlocked(ongoingId, timeStr, currentTracker)) {
          assignedAssistantId = ongoingId;
        }
      }

      // 2. 直前アサインが無理なら、フリーなアシスタントを探す
      if (!assignedAssistantId) {
        const availableAssistants = Array.from(freeAssistantIds)
          .map(id => assistants.find(a => a.id === id))
          .filter(Boolean)
          .filter(a => !isStaffBlocked(a.id, timeStr, currentTracker));
        
        for (const a of availableAssistants) {
          if (hasSkill(a, req.requiredSkill, 1)) {
            assignedAssistantId = a.id;
            break;
          }
        }
      }

      if (assignedAssistantId) {
        // __none__ などの既存アサインがあれば一旦除去
        timeSlot.assignments = timeSlot.assignments.filter(a => a.requirementId !== req.id);

        timeSlot.assignments.push({
          requirementId: req.id,
          assistantId: assignedAssistantId,
          badges: ['bonus_help'],
          isLocked: false
        });

        freeAssistantIds.delete(assignedAssistantId);
        currentOngoingTasks[taskKey] = assignedAssistantId;

        // ボーナス行動であるため、state.tracker の totalAssignedSlots は加算しない。
      }
    }
  });

  // trackerは変更しないが参照はそのまま保持
  nextState.ongoingTasks = currentOngoingTasks;
  
  return nextState;
}
