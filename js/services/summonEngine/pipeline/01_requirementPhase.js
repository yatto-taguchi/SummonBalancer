import { toTimestamp } from '../utils/timeUtils.js';
import { Reservation } from '../../../models/reservation.js';

/**
 * Step 1: 要件定義 (純粋関数)
 * @param {Object} state - 現在の EngineState (イミュータブル)
 * @param {string} timeStr - 処理対象の時間枠 (例: "10:00")
 * @param {number} timeMs - 処理対象の時間枠のミリ秒タイムスタンプ
 * @returns {Object} - 更新された新しい EngineState
 */
function defineRequirements(state, timeStr, timeMs) {
  // 1. 対象時間枠の初期状態を準備 (既存データがある場合は継承)
  const currentTimeSlot = (state.timeSlots && state.timeSlots[timeStr]) 
    ? state.timeSlots[timeStr] 
    : {
        time: timeStr,
        stylistOverlapCounts: {},
        requirements: [],
        assignments: [],
        unassignedReqs: [],
        freePoolStaffIds: [],
        freeTimeTasks: {}
      };

  // 2. 現在の時間枠に重なっている予約を抽出
  // timeUtils の toTimestamp を用いて内部的にミリ秒で確実な判定を行う
  const overlappingReservations = (state.master?.reservations || []).filter(res => {
    const startMs = toTimestamp(res.startTime);
    const endMs = toTimestamp(res.endTime);
    return startMs <= timeMs && timeMs < endMs;
  });

  // 3. 各スタイリストの掛け持ち列数を計算
  const overlapCounts = {};
  overlappingReservations.forEach(res => {
    overlapCounts[res.stylistId] = (overlapCounts[res.stylistId] || 0) + 1;
  });

  // 4 & 5. Requirementオブジェクトの生成とtier(優先度)の設定
  const requirements = [];
  overlappingReservations.forEach(res => {
    const overlap = overlapCounts[res.stylistId];
    
    // 予約のメニュー情報を取得
    const allMenus = state.master?.menus || [];
    const baseMenu = allMenus.find(m => m.id === res.menuItemId);
    const effectiveMenu = Reservation.getEffectiveMenu(res, allMenus);
    const menu = effectiveMenu || baseMenu;
    const slots = menu?.assistantSlots || [];
    const resStartMs = toTimestamp(res.startTime);

    slots.forEach((slot, index) => {
      const slotStartMs = resStartMs + (slot.startMinute || 0) * 60000;
      const slotEndMs = resStartMs + (slot.endMinute || 30) * 60000;

      // 現在の時間枠(timeMs)がこのスロットに重なっている場合のみ要件を生成
      if (slotStartMs <= timeMs && timeMs < slotEndMs) {
        const resEndMs = toTimestamp(res.endTime);
        // 予約終了の10分前〜終了までを「仕上げ」とする
        const isFinishing = (resEndMs - 10 * 60000 <= timeMs) && (timeMs < resEndMs);
        
        let tier = 2; // デフォルトはTier 2 (単独予約)
        let isStrictlyRequired = false;
        if (overlap >= 2) {
          tier = 1;
          isStrictlyRequired = true;
        }

        if (isFinishing) {
          requirements.push({
            id: `req_${timeStr}_${res.id}_slot${index}_finish`,
            reservationId: res.id,
            stylistId: res.stylistId,
            requiredSkill: 'finishing',
            minSkillLevel: 1,
            tier: 1, // 仕上げは最優先
            slotIndex: index,
            designatedStaffId: res.stylistId,
            isFinishing: true,
            isStrictlyRequired: true
          });
        } else {
          // 手動トグル（nonOverlapSummonEnabled === false）の判定
          // 単独予約（任意タスク）かつトグルがOFFの場合は要件自体を生成せず、完全に本人対応とする
          const isOptionalAndDisabled = !isStrictlyRequired && res.nonOverlapSummonEnabled === false;
          
          if (!isOptionalAndDisabled) {
            const requiredSkill = slot.requiredSkill || 'shampoo';
            requirements.push({
              id: `req_${timeStr}_${res.id}_slot${index}`,
              reservationId: res.id,
              stylistId: res.stylistId,
              requiredSkill: requiredSkill,
              minSkillLevel: slot.requiredProficiency || 1,
              tier: tier,
              slotIndex: index,
              isHandoffProhibited: ['shampoo', 'treatment', 'spa'].includes(requiredSkill),
              isStrictlyRequired: isStrictlyRequired
            });
          }
        }
      }
    });
  });

  // 6. 既存のstateを破壊せず、新しいstateオブジェクトを生成して返す
  return {
    ...state,
    timeSlots: {
      ...state.timeSlots,
      [timeStr]: {
        ...currentTimeSlot,
        stylistOverlapCounts: overlapCounts,
        requirements: requirements
      }
    }
  };
}

export function executeRequirementPhase(state) {
  let nextState = state.clone();
  
  if (!nextState.timeSlots) {
    nextState.timeSlots = {};
  }
  if (!nextState.master) {
    nextState.master = { reservations: nextState.reservations || [] };
  }

  // 営業時間 09:00 〜 19:00 の時間枠を30分刻みで生成してループ
  // UI側の予約データ仕様に合わせ、0 = 09:00, 600 = 19:00 として計算する
  // ループを5分間隔（m += 5）に変更
  const times = [];
  for (let m = 0; m <= 600; m += 5) {
    const h = 9 + Math.floor(m / 60);
    const min = m % 60;
    const timeStr = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    times.push({ str: timeStr, ms: toTimestamp(m) });
  }

  // 各時間枠に対して defineRequirements を実行
  times.forEach(time => {
    // フリーズ境界以前のTickは要件定義をスキップ（既存の確定済みデータを維持）
    const [tH, tM] = time.str.split(':').map(Number);
    const tickMinsFrom9 = (tH - 9) * 60 + tM;
    if (nextState.freezeBoundary !== null && tickMinsFrom9 <= nextState.freezeBoundary) {
      return;
    }
    nextState = defineRequirements(nextState, time.str, time.ms);
  });

  const finalState = state.clone();
  finalState.timeSlots = nextState.timeSlots;
  
  return finalState;
}
