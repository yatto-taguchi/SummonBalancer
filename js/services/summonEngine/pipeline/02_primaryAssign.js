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

    // 1. requirements のソート（処理順の決定）
    // 第1優先：既に継続中のアシスタントがいる要件（横取り防止）
    // 第2優先：Tier昇順（1 -> 2 -> 3）
    timeSlot.requirements.sort((a, b) => {
      const keyA = `${a.reservationId}_${a.slotIndex}`;
      const keyB = `${b.reservationId}_${b.slotIndex}`;
      const aHasOngoing = (nextState.ongoingTasks && nextState.ongoingTasks[keyA]) ? 1 : 0;
      const bHasOngoing = (nextState.ongoingTasks && nextState.ongoingTasks[keyB]) ? 1 : 0;
      
      if (aHasOngoing !== bHasOngoing) {
        return bHasOngoing - aHasOngoing; // 1(継続中)を優先
      }
      return a.tier - b.tier;
    });

    // 2. その時間枠で稼働可能なアシスタントのプールを初期化
    timeSlot.freePoolStaffIds = assistants.map(a => a.id);

    // 3. 各 requirement に対して貪欲法でアサイン
    timeSlot.requirements.forEach(req => {
      // ▼ スタイリスト指定（仕上げなど）の要件の場合
      if (req.designatedStaffId) {
        timeSlot.assignments.push({
          requirementId: req.id,
          assistantId: req.designatedStaffId
        });
        // 疲労度トラッカーの更新（イミュータブルな状態更新）
        const currentTracker = nextState.tracker[req.designatedStaffId] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
        nextState.tracker = {
          ...nextState.tracker,
          [req.designatedStaffId]: {
            ...currentTracker,
            totalAssignedSlots: currentTracker.totalAssignedSlots + 1
          }
        };
        return; // 次の requirement へ
      }

      // 候補者の抽出（スキル条件を満たす者）
      let candidates = timeSlot.freePoolStaffIds
        .map(id => assistants.find(a => a.id === id))
        .filter(a => a && hasSkill(a, req.requiredSkill, req.minSkillLevel));

      const taskKey = `${req.reservationId}_${req.slotIndex}`;
      const ongoingAssistantId = nextState.ongoingTasks ? nextState.ongoingTasks[taskKey] : null;

      // シャンプー等の途中交代禁止（ハードロック）
      if (req.isHandoffProhibited && ongoingAssistantId) {
        const isFree = candidates.some(a => a.id === ongoingAssistantId);
        if (isFree) {
          const ongoingAssistant = assistants.find(a => a.id === ongoingAssistantId);
          candidates = [ongoingAssistant]; // 担当者のみに絞る
        } else {
          candidates = []; // 他のスタッフで穴埋めせず、未アサインとして弾く
        }
      }

      if (candidates.length === 0) {
        // 候補者がいない場合は未アサイン枠（赤枠予備軍）へ退避
        timeSlot.unassignedReqs.push({
          requirementId: req.id,
          reason: "no_free_staff"
        });
        return;
      }

      // 4. 候補者の優先順位付け
      candidates.sort((a, b) => {
        // 第0条件: 継続性 (現在そのタスクを担当中のスタッフを最優先)
        // ※将来的に master.menus の canHandover を見るように拡張可能
        if (ongoingAssistantId) {
          if (a.id === ongoingAssistantId) return -1;
          if (b.id === ongoingAssistantId) return 1;
        }

        // 第1条件: 贅沢防止 (要求スキルレベルに最も近い＝レベルが低い者を優先)
        const aLevel = getSkillLevel(a, req.requiredSkill);
        const bLevel = getSkillLevel(b, req.requiredSkill);
        if (aLevel !== bLevel) {
          return aLevel - bLevel; // 昇順
        }

        // 第2条件: 疲労度考慮 (tracker[id].totalAssignedSlots が少ない者を優先)
        const aCount = nextState.tracker[a.id]?.totalAssignedSlots || 0;
        const bCount = nextState.tracker[b.id]?.totalAssignedSlots || 0;
        if (aCount !== bCount) {
          return aCount - bCount; // 昇順
        }

        // 第3条件: ID順（結果の安定性のため）
        return a.id.localeCompare(b.id);
      });

      const selected = candidates[0];

      // 5. アサインの確定と状態更新
      timeSlot.assignments.push({
        requirementId: req.id,
        assistantId: selected.id
      });

      // 継続性トラッカーの更新（次のTickでこのタスクを引き継ぐため）
      if (!nextState.ongoingTasks) nextState.ongoingTasks = {};
      nextState.ongoingTasks[`${req.reservationId}_${req.slotIndex}`] = selected.id;

      // プールから選出されたスタッフを削除
      timeSlot.freePoolStaffIds = timeSlot.freePoolStaffIds.filter(id => id !== selected.id);

      // 疲労度トラッカーの更新（イミュータブルな状態更新）
      const currentTracker = nextState.tracker[selected.id] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
      nextState.tracker = {
        ...nextState.tracker,
        [selected.id]: {
          ...currentTracker,
          totalAssignedSlots: currentTracker.totalAssignedSlots + 1
        }
      };
    });
  });

  return nextState;
}
