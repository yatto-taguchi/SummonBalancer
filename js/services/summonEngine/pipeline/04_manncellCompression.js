import { hasSkill } from '../utils/skillUtils.js?v=3';
import { isStaffBlocked } from '../utils/timeUtils.js?v=3';

export function executeManncellCompression(state) {
  let nextState = state.clone();

  if (!nextState.timeSlots) return nextState;

  const assistants = (nextState.master?.staff || []).filter(s => s.type === 'assistant');

  // 各Tickを独立して評価
  Object.keys(nextState.timeSlots).forEach(time => {
    // フリーズ境界以前のTickはマンセル判定をスキップ（確定済みデータを維持）
    const [fH, fM] = time.split(':').map(Number);
    const tickMinsFrom9 = (fH - 9) * 60 + fM;
    if (nextState.freezeBoundary !== null && tickMinsFrom9 <= nextState.freezeBoundary) {
      return;
    }

    const timeSlot = nextState.timeSlots[time];
    if (!timeSlot || !timeSlot.requirements || timeSlot.requirements.length === 0) return;

    // 1. 対象の特定: このTickで unassignedReqs を持つスタイリストを特定
    const targetStylistIds = new Set();
    if (timeSlot.unassignedReqs && timeSlot.unassignedReqs.length > 0) {
      timeSlot.unassignedReqs.forEach(unreq => {
        const req = timeSlot.requirements.find(r => r.id === unreq.requirementId);
        // 仕上げ（isFinishing）はマンセルの対象外（スタイリストのタスク）
        if (req && !req.isFinishing) {
          targetStylistIds.add(req.stylistId);
        }
      });
    }

    if (targetStylistIds.size === 0) return;

    const [h, m] = time.split(':').map(Number);
    const tickIndex = Math.floor((h * 60 + m) / 5);

    targetStylistIds.forEach(stylistId => {
      // 1. このスタイリストのアシスタント要件を抽出 (仕上げは除外するが、途中交代禁止タスクは重複計算に含める)
      // skipAssignment（__none__固定）の要件はマンセル対象から除外
      const allReqs = timeSlot.requirements.filter(r => r.stylistId === stylistId && !r.isFinishing && !r.skipAssignment);
      if (allReqs.length <= 1) return; // 要件が1つだけならチームローテーション不要（単なる人員不足）

      // 安定したローテーションのため、要件をソート（Tier順、ID順）
      allReqs.sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        return a.id.localeCompare(b.id);
      });

      const allReqIds = new Set(allReqs.map(r => r.id));

      // Phase 2 でアサインされたアシスタントを抽出（チーム結成）
      // ※Phase 3で召喚されたスタイリストはマンセルチームに含めない
      const teamAssignments = timeSlot.assignments.filter(a => allReqIds.has(a.requirementId));
      const teamAssistants = Array.from(new Set(
        teamAssignments
          .map(a => a.assistantId)
          .filter(id => {
            if (id === 'MANNCELL_STANDBY') return false;
            const staffObj = (state.master?.staffMap || {})[id];
            if (!staffObj || staffObj.type !== 'assistant') return false;
            // ブロックされている場合はマンセルのチームメンバーから除外
            if (isStaffBlocked(id, time, state.tracker)) return false;
            return true;
          })
      ));

      if (teamAssistants.length === 0) {
        // 1人も確保できていない場合は完全な不足。マンセル不可。
        return;
      }

      // 3. 【最重要】マンセル発動前の「トリアージ（贅沢防止と最低スキルの死守）」
      let maxRequiredLevel = 1;
      let hardestReq = null;
      allReqs.forEach(r => {
        if ((r.minSkillLevel || 1) >= maxRequiredLevel) {
          maxRequiredLevel = r.minSkillLevel || 1;
          hardestReq = r;
        }
      });

      // 結成されたチーム内に、最高難易度タスクをこなせる人材が1人でもいるかチェック
      const hasRequiredSkill = teamAssistants.some(assistantId => {
        const staffObj = (state.master?.staff || []).find(s => s.id === assistantId);
        return staffObj && hasSkill(staffObj, hardestReq.requiredSkill, maxRequiredLevel);
      });

      if (!hasRequiredSkill) {
        // スキル不足の場合はマンセルチーム解散（通常のアサインエラーとして残す）
        return;
      }

      // 4. 回転可能タスクの抽出（シャンプー等の固定タスクを除く）
      const rotatableReqs = allReqs.filter(r => !r.isHandoffProhibited);
      const rotatableReqIds = new Set(rotatableReqs.map(r => r.id));

      // unassignedReqs の中で、回転対象の要件を「レスキュー成功」として抽出
      const rescuedUnreqs = timeSlot.unassignedReqs.filter(unreq => rotatableReqIds.has(unreq.requirementId));

      // 抽出したものを unassignedReqs から削除（エラーを解除）
      timeSlot.unassignedReqs = timeSlot.unassignedReqs.filter(unreq => !rotatableReqIds.has(unreq.requirementId));

      // 救済できた未アサインタスクに対してのみ、ダミーIDをアサインする（既存アサインは維持）
      // 【固定アサイン保護】fixedAssistantId が設定されている要件で、既にそのスタッフが
      // アサイン成功している場合は MANNCELL_STANDBY で上書きしない
      const existingAssignMap = new Map();
      timeSlot.assignments.forEach(a => existingAssignMap.set(a.requirementId, a));

      rescuedUnreqs.forEach((unreq) => {
        const fullReq = timeSlot.requirements.find(r => r.id === unreq.requirementId);
        const existingAssign = existingAssignMap.get(unreq.requirementId);

        // 固定アサインが既に成功している場合はスキップ（保護）
        if (fullReq && fullReq.fixedAssistantId && existingAssign 
            && existingAssign.assistantId !== 'MANNCELL_STANDBY'
            && existingAssign.assistantId !== '__none__'
            && existingAssign.assistantId === fullReq.fixedAssistantId) {
          // 固定アサインを維持 — MANNCELL_STANDBY で上書きしない
          return;
        }

        // ダミーID（MANNCELL_STANDBY）をアサインすることでUI側にチーム対応中であることを伝達
        timeSlot.assignments.push({
          requirementId: unreq.requirementId,
          assistantId: 'MANNCELL_STANDBY'
        });
      });

      // UI描画用にマンセル発動を記録 (全タスクを対象とする)
      // 固定スタッフの抽出: このスタイリストの要件の中で fixedAssistantId が設定されているものを収集
      const fixedStaffIds = [];
      allReqs.forEach(r => {
        if (r.fixedAssistantId && r.fixedAssistantId !== '__none__' && !r.skipAssignment) {
          if (!fixedStaffIds.includes(r.fixedAssistantId)) {
            fixedStaffIds.push(r.fixedAssistantId);
          }
        }
      });

      if (!nextState.manncellTicks) nextState.manncellTicks = [];
      nextState.manncellTicks.push({
        stylistId,
        timeStr: time,
        teamSize: allReqs.length,
        team: teamAssistants,
        fixedStaffIds: fixedStaffIds, // 固定スタッフID群（不動の軸）
        reservationIds: Array.from(new Set(allReqs.map(r => r.reservationId)))
      });

    });
  });

  return nextState;
}
