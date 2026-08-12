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
        
        // 固定モード: fixedAssistants からこのスロットの固定情報を取得
        const fixedId = (res.fixedAssistants && res.fixedAssistants[index]) || null;
        
        let tier = 2; // デフォルトはTier 2 (単独予約)
        let isStrictlyRequired = false;
        if (overlap >= 2) {
          tier = 1;
          isStrictlyRequired = true;
        }

        // === 不在ブロック判定 ===
        // ルールブック「6. ブロック（一時不在）の絶対優先原則」
        // スタイリスト自身の予約が、そのスタイリストの不在ブロック時間と少しでも被っている場合、
        // 予約全体を通してアシスタントやヘルプのアサインを行わず、赤枠エラー（未アサイン）とする
        let isStylistBlocked = false;
        const resStartMs = toTimestamp(res.startTime);
        const trackerObj = state.tracker ? state.tracker[res.stylistId] : null;
        if (trackerObj && trackerObj.blockedTimes) {
          for (const block of trackerObj.blockedTimes) {
            const bStart = toTimestamp(block.startTime);
            const bEnd = toTimestamp(block.endTime);
            // 予約の時間帯とブロック時間帯が重なっているか
            if (resStartMs < bEnd && resEndMs > bStart) {
              isStylistBlocked = true;
              break;
            }
          }
        }

        // 不在ブロック中、または __none__ 固定（召喚不要）の場合: 要件は生成するが skipAssignment フラグを付与
        if (isStylistBlocked || fixedId === '__none__') {
          requirements.push({
            id: `req_${timeStr}_${res.id}_slot${index}`,
            reservationId: res.id,
            stylistId: res.stylistId,
            requiredSkill: slot.requiredSkill || 'shampoo',
            minSkillLevel: 1,
            tier: tier,
            slotIndex: index,
            fixedAssistantId: isStylistBlocked ? null : '__none__', // 不在の場合は手動OFFではない
            skipAssignment: true,  // アサイン不要（アサイン禁止）マーカー
            isStrictlyRequired: false  // 不要固定やブロック中は必須扱いにしない
          });
          return; // このスロットの処理はここで完了（forEachのreturn）
        }

        if (isFinishing) {
          // 仕上げスロット: 固定がある場合は固定を優先
          const finishReq = {
            id: `req_${timeStr}_${res.id}_slot${index}_finish`,
            reservationId: res.id,
            stylistId: res.stylistId,
            requiredSkill: 'finishing',
            minSkillLevel: 1,
            tier: 1, // 仕上げは最優先
            slotIndex: index,
            isFinishing: true,
            isStrictlyRequired: true
          };
          if (fixedId) {
            // ユーザー手動固定が優先（スタイリスト自動指定より上位）
            finishReq.fixedAssistantId = fixedId;
          } else {
            finishReq.designatedStaffId = res.stylistId;
          }
          requirements.push(finishReq);
        } else {
          // 通常スロット要件の生成
          // ※ アシスタント配置OFFは fixedAssistants[index] = '__none__' で管理され、
          //   上部の fixedId === '__none__' 分岐で skipAssignment として処理済み
            const requiredSkill = slot.requiredSkill || 'shampoo';
            const req = {
              id: `req_${timeStr}_${res.id}_slot${index}`,
              reservationId: res.id,
              stylistId: res.stylistId,
              requiredSkill: requiredSkill,
              minSkillLevel: slot.requiredProficiency || 1,
              tier: tier,
              slotIndex: index,
              isHandoffProhibited: ['shampoo', 'treatment', 'spa'].includes(requiredSkill),
              isStrictlyRequired: isStrictlyRequired
            };
            // 固定モード: fixedAssistantId を付与
            if (fixedId) {
              req.fixedAssistantId = fixedId;
            }
            requirements.push(req);
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
        time: timeStr, // ← 確実に time を持たせる
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
