import { hasSkill } from '../utils/skillUtils.js?v=3';
import { isStaffFree, toTimestamp } from '../utils/timeUtils.js?v=3';

/**
 * 対象スタッフの特定スキルのレベルを取得する
 */
function getSkillLevel(staff, skillId) {
  if (staff.type === 'stylist') return 99; // スタイリストは上限扱い
  if (!staff.skills) return 0;
  const skill = staff.skills.find(s => s.id === skillId);
  return skill ? (skill.proficiency || 0) : 0;
}

export function executePrimaryAssign(state) {
  let nextState = state.clone();
  
  if (!nextState.timeSlots) return nextState;

  const assistants = (nextState.master?.staff || []).filter(s => s.type === 'assistant');
  const stylists = (nextState.master?.staff || []).filter(s => s.type === 'stylist');

  // 各スタイリストの当日の稼働率を事前計算 (総予約スロット数 / 120)
  const stylistUtilization = {};
  stylists.forEach(stylist => {
    let totalTicks = 0;
    (nextState.master?.reservations || []).forEach(res => {
      if (res.stylistId === stylist.id) {
        const start = typeof res.startTime === 'number' ? res.startTime : 0;
        const end = typeof res.endTime === 'number' ? res.endTime : 0;
        totalTicks += Math.max(0, (end - start) / 5);
      }
    });
    // 営業時間 10時間 = 600分 = 120 ticks
    stylistUtilization[stylist.id] = totalTicks / 120;
  });

  // 各時間枠（timeSlot）ごとに独立してアサインを計算
  Object.keys(nextState.timeSlots).forEach(time => {
    // フリーズ境界以前のTickはアサイン計算をスキップ（確定済みデータを維持）
    const [fH, fM] = time.split(':').map(Number);
    const tickMinsFrom9 = (fH - 9) * 60 + fM;
    if (nextState.freezeBoundary !== null && tickMinsFrom9 <= nextState.freezeBoundary) {
      return;
    }

    const timeSlot = nextState.timeSlots[time];
    if (!timeSlot || !timeSlot.requirements || timeSlot.requirements.length === 0) return;

    // 1. requirements を必須(strict)と任意(optional)に分割
    const strictReqs = timeSlot.requirements.filter(r => r.isStrictlyRequired || r.tier === 1);
    const optionalReqs = timeSlot.requirements.filter(r => !r.isStrictlyRequired && r.tier === 2);

    // 必須タスクのソート（第1優先：継続中、第2優先：ID順）
    strictReqs.sort((a, b) => {
      const keyA = `${a.reservationId}_${a.slotIndex}`;
      const keyB = `${b.reservationId}_${b.slotIndex}`;
      const aHasOngoing = (nextState.ongoingTasks && nextState.ongoingTasks[keyA]) ? 1 : 0;
      const bHasOngoing = (nextState.ongoingTasks && nextState.ongoingTasks[keyB]) ? 1 : 0;
      if (aHasOngoing !== bHasOngoing) return bHasOngoing - aHasOngoing;
      return a.id.localeCompare(b.id);
    });

    // 2. その時間枠で稼働可能なアシスタントのプールを初期化
    timeSlot.freePoolStaffIds = assistants.map(a => a.id);

    // 共通のアサイン処理関数 (isStrict = true ならばエラー時は unassignedReqs へ)
    const tryAssign = (req, isStrict) => {
      if (req.designatedStaffId) {
        timeSlot.assignments.push({
          requirementId: req.id,
          assistantId: req.designatedStaffId
        });
        const currentTracker = nextState.tracker[req.designatedStaffId] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
        nextState.tracker = {
          ...nextState.tracker,
          [req.designatedStaffId]: {
            ...currentTracker,
            totalAssignedSlots: currentTracker.totalAssignedSlots + 1
          }
        };
        return true;
      }

      let candidates = timeSlot.freePoolStaffIds
        .map(id => assistants.find(a => a.id === id))
        .filter(a => a && hasSkill(a, req.requiredSkill, req.minSkillLevel));

      const taskKey = `${req.reservationId}_${req.slotIndex}`;
      const ongoingAssistantId = nextState.ongoingTasks ? nextState.ongoingTasks[taskKey] : null;

      if (req.isHandoffProhibited && ongoingAssistantId) {
        const isFree = candidates.some(a => a.id === ongoingAssistantId);
        if (isFree) {
          const ongoingAssistant = assistants.find(a => a.id === ongoingAssistantId);
          candidates = [ongoingAssistant];
        } else {
          candidates = [];
        }
      }

      if (candidates.length === 0) {
        if (isStrict) {
          // Tier 1（必須タスク）のみPhase 3に回す。Tier 2は「本人対応」として静かに破棄
          timeSlot.unassignedReqs.push({
            requirementId: req.id,
            reason: "no_free_staff"
          });
        }
        return false;
      }

      candidates.sort((a, b) => {
        if (ongoingAssistantId) {
          if (a.id === ongoingAssistantId) return -1;
          if (b.id === ongoingAssistantId) return 1;
        }
        const aLevel = getSkillLevel(a, req.requiredSkill);
        const bLevel = getSkillLevel(b, req.requiredSkill);
        if (aLevel !== bLevel) return aLevel - bLevel;

        const aCount = nextState.tracker[a.id]?.totalAssignedSlots || 0;
        const bCount = nextState.tracker[b.id]?.totalAssignedSlots || 0;
        if (aCount !== bCount) return aCount - bCount;

        return a.id.localeCompare(b.id);
      });

      const selected = candidates[0];

      timeSlot.assignments.push({
        requirementId: req.id,
        assistantId: selected.id
      });

      if (!nextState.ongoingTasks) nextState.ongoingTasks = {};
      nextState.ongoingTasks[`${req.reservationId}_${req.slotIndex}`] = selected.id;

      timeSlot.freePoolStaffIds = timeSlot.freePoolStaffIds.filter(id => id !== selected.id);

      const currentTracker = nextState.tracker[selected.id] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
      nextState.tracker = {
        ...nextState.tracker,
        [selected.id]: {
          ...currentTracker,
          totalAssignedSlots: currentTracker.totalAssignedSlots + 1
        }
      };
      return true;
    };

    // Step 1: 必須タスクの消化
    strictReqs.forEach(req => tryAssign(req, true));

    // Step 2: 余力判定と任意タスク（tier: 2）への配置
    if (optionalReqs.length > 0) {
      // ソート: 継続中タスク > ①オーナーの予約 > ②スタイリストの稼働率が高い順
      optionalReqs.sort((a, b) => {
        const keyA = `${a.reservationId}_${a.slotIndex}`;
        const keyB = `${b.reservationId}_${b.slotIndex}`;
        const aHasOngoing = (nextState.ongoingTasks && nextState.ongoingTasks[keyA]) ? 1 : 0;
        const bHasOngoing = (nextState.ongoingTasks && nextState.ongoingTasks[keyB]) ? 1 : 0;
        if (aHasOngoing !== bHasOngoing) return bHasOngoing - aHasOngoing;

        const stylistA = stylists.find(s => s.id === a.stylistId);
        const stylistB = stylists.find(s => s.id === b.stylistId);
        const isOwnerA = stylistA?.rank === 'owner' ? 1 : 0;
        const isOwnerB = stylistB?.rank === 'owner' ? 1 : 0;
        if (isOwnerA !== isOwnerB) return isOwnerB - isOwnerA;
        
        const utilA = stylistUtilization[a.stylistId] || 0;
        const utilB = stylistUtilization[b.stylistId] || 0;
        return utilB - utilA;
      });

      optionalReqs.forEach(req => {
        const freeCount = timeSlot.freePoolStaffIds.length;
        if (freeCount === 0) return; // 空きがいなければ終了

        const stylist = stylists.find(s => s.id === req.stylistId);
        const isOwner = stylist?.rank === 'owner';
        const utilization = stylistUtilization[req.stylistId] || 0;

        let shouldAssign = false;
        if (utilization >= 0.5 || isOwner) {
          // 条件B: 稼働率50%以上またはオーナーなら1人でも余っていればアサイン
          shouldAssign = freeCount >= 1;
        } else {
          // 条件A: 稼働率50%未満なら2人以上余っている場合に限りアサイン
          shouldAssign = freeCount >= 2;
        }

        if (shouldAssign) {
          tryAssign(req, false);
        }
      });
    }
  });

  return nextState;
}
