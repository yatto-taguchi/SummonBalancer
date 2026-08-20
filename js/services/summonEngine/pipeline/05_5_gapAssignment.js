import { hasSkill } from '../utils/skillUtils.js?v=3';
import { toTimestamp, isStaffBlocked, isStaffInLesson, isStaffWorkingAtTime } from '../utils/timeUtils.js?v=3';
import { Reservation } from '../../../models/reservation.js?v=3';
import { getRankPriority } from '../../../models/staff.js?v=3';

/**
 * Phase 5.5: 隙間配置フェーズ (Gap Assignment & SP Special Summon)
 * 
 * 1. 通常の隙間ヘルプ (Level 1 Assistant to Shortage)
 * 2. SP特殊召喚（スワップ） (Assistant to Stylist's Shampoo, Stylist to Shortage)
 * 3. 余裕のないマンセルへの隙間ヘルプ
 */
export function executeGapAssignment(state) {
  let nextState = state.clone();

  if (!nextState.timeSlots) return nextState;

  // 全スタッフリストの準備
  const assistants = (nextState.master?.staff || nextState.staff || []).filter(s => s.type === 'assistant' && s.isWorking);
  const stylists = (nextState.master?.staff || nextState.staff || []).filter(s => s.type === 'stylist' && s.isWorking);

  let currentTracker = { ...(nextState.tracker || {}) };
  let currentOngoingTasks = { ...(nextState.ongoingTasks || {}) };
  const staffIndexMap = nextState.master?.staffIndexMap || {};

  // スタイリスト候補をランク逆順（下位ランクから先に拾う）でソート
  const sortedStylists = [...stylists].sort((a, b) => {
    // 1. ランク逆順（junior=4→stylist=3→top_stylist=2→owner=1）
    const rankA = getRankPriority(a.rank);
    const rankB = getRankPriority(b.rank);
    if (rankA !== rankB) return rankB - rankA;
    // 2. 優先トグル（OFFを先、ONを後回し）
    const prioA = a.prioritySummon ? 1 : 0;
    const prioB = b.prioritySummon ? 1 : 0;
    if (prioA !== prioB) return prioA - prioB;
    // 3. UI表示リストの下から（配列インデックス降順）
    const idxA = staffIndexMap[a.id] ?? 0;
    const idxB = staffIndexMap[b.id] ?? 0;
    return idxB - idxA;
  });

  // 時間枠をソートして処理 (Tick順)
  const sortedTimes = Object.keys(nextState.timeSlots).sort();

  sortedTimes.forEach(timeStr => {
    // フリーズ境界のスキップ
    const [tH, tM] = timeStr.split(':').map(Number);
    const tickMinsFrom9 = (tH - 9) * 60 + tM;
    const timeMs = toTimestamp(tickMinsFrom9); // 9:00基準の分数
    
    if (nextState.freezeBoundary !== null && tickMinsFrom9 <= nextState.freezeBoundary) {
      return; // 確定済みはスキップ
    }

    const timeSlot = nextState.timeSlots[timeStr];
    if (!timeSlot) return;

    // このTickで現在空いているアシスタントのIDプール
    // 仕様書セクション2「勤務時間外の絶対排除」: 勤務時間外のアシスタントはプールから除外
    let freeAssistantIds = new Set(
      assistants
        .filter(a => isStaffWorkingAtTime(a, timeStr))
        .map(a => a.id)
    );
    timeSlot.assignments.forEach(a => {
      if (a.assistantId !== 'MANNCELL_STANDBY' && a.assistantId !== '__none__') {
        freeAssistantIds.delete(a.assistantId);
      }
    });

    // このTickですでに隙間ヘルプ/SP特殊召喚にアサインされたスタイリストを追跡
    const busyGapStylists = new Set();

    // ─── 対象の抽出 ───
    const shortfalls = [];
    
    if (timeSlot.unassignedReqs && timeSlot.unassignedReqs.length > 0) {
      timeSlot.unassignedReqs.forEach(unreq => {
        const req = timeSlot.requirements.find(r => r.id === unreq.requirementId);
        // 隙間ヘルプの対象外（シャンプー等の一人でしか行えない技術）はスキップ
        if (req && !req.isHandoffProhibited && !req.isFinishing && !req.skipAssignment) {
          shortfalls.push({ type: 'normal', req, unreq });
        }
      });
    }

    // マンセルからのショートフォールを抽出
    const tickManncells = (nextState.manncellTicks || []).filter(m => m.timeStr === timeStr);
    tickManncells.forEach(m => {
      if (m.team && m.team.length <= m.teamSize - 1) {
        const mReqs = timeSlot.requirements.filter(r => m.reservationIds.includes(r.reservationId) && !r.isHandoffProhibited && !r.isFinishing);
        mReqs.forEach(req => {
          shortfalls.push({ type: 'mancell', req, manncell: m });
        });
      }
    });

    // ─── shortfall に対して Gap Help / SP Special Summon を試行 ───
    for (const shortfall of shortfalls) {
      const { req } = shortfall;
      let assignedAssistantId = null;
      let assignedStylistId = null;
      let usedSwapAssistantId = null;
      let isSpSpecialSummon = false;

      // 1. 直前アサイン（ソフトロック）の優先チェック
      const taskKey = `${req.reservationId}_${req.slotIndex}`;
      const ongoingId = currentOngoingTasks[taskKey];
      if (ongoingId && freeAssistantIds.has(ongoingId)) {
        const staffObj = assistants.find(a => a.id === ongoingId);
        // 【厳守事項3】最低スキルチェック ＋ 【追加修正】ブロック中ではないか確認 ＋ レッスン日確認
        if (staffObj && hasSkill(staffObj, req.requiredSkill, 1) && !isStaffBlocked(ongoingId, timeStr, currentTracker) && !isStaffInLesson(ongoingId, timeStr, nextState)) {
          assignedAssistantId = ongoingId;
        }
      }

      // 2. 直前アサインが無理なら、フリーなアシスタントを探す（通常の隙間ヘルプ）
      if (!assignedAssistantId) {
        const availableAssistants = Array.from(freeAssistantIds)
          .map(id => assistants.find(a => a.id === id))
          .filter(Boolean)
          .filter(a => !isStaffBlocked(a.id, timeStr, currentTracker))
          .filter(a => !isStaffInLesson(a.id, timeStr, nextState))
          .filter(a => isStaffWorkingAtTime(a, timeStr));  // 勤務時間外の絶対排除（念押し）
        // ソート：疲労度→リスト下位優先
        availableAssistants.sort((a, b) => {
          const loadA = currentTracker[a.id]?.totalAssignedSlots || 0;
          const loadB = currentTracker[b.id]?.totalAssignedSlots || 0;
          if (loadA !== loadB) return loadA - loadB;
          const idxA = staffIndexMap[a.id] ?? 0;
          const idxB = staffIndexMap[b.id] ?? 0;
          return idxB - idxA;
        });
        for (const a of availableAssistants) {
          // 【厳守事項3】レベル1で判定
          if (hasSkill(a, req.requiredSkill, 1)) {
            assignedAssistantId = a.id;
            break;
          }
        }
      }

      // 3. アシスタントが無理なら、階層的スワップ判定（SP特殊召喚・アシスタント放出）を試みる
    // 【第一段階】玉突きスワップ（アシスタントの放出）
    // （※アシスタントを放出できるスタイリストを探す）
    if (!assignedAssistantId) {
      for (const s of sortedStylists) {
        if (s.id === req.stylistId) continue;
        if (busyGapStylists.has(s.id)) continue;
        if (isStaffBlocked(s.id, timeStr, currentTracker)) continue;
        if (!isStaffWorkingAtTime(s, timeStr)) continue;  // 勤務時間外の絶対排除

        // 自分の今の時間帯のタスク
        const sReqs = timeSlot.requirements.filter(r => r.stylistId === s.id && !r.skipAssignment);
        if (sReqs.length === 0) continue; // 完全フリーなスタイリストはここでは対象外

        // 1. スタイリストsが「自分のすべてのタスクにおいてアシスタントに丸投げできているか（完全に手が空いているか）」を確認
        let isFullyDelegated = true;
        for (const myReq of sReqs) {
          if (myReq.isFinishing) {
            isFullyDelegated = false;
            break;
          }
          const existingAssign = timeSlot.assignments.find(a => a.requirementId === myReq.id && a.assistantId !== 'MANNCELL_STANDBY' && a.assistantId !== '__none__');
          // スタイリスト自身が担当している場合（アサインがない場合）は手が空いていない
          if (!existingAssign) {
            isFullyDelegated = false;
            break;
          }
          // すでにアシスタントではなく自分自身がアサインされている場合（他人のSP特殊召喚など）
          const assignedStaff = assistants.find(a => a.id === existingAssign.assistantId);
          if (!assignedStaff) {
            isFullyDelegated = false;
            break;
          }
        }

        if (!isFullyDelegated) continue; // 自分がタスクを抱えている場合は放出・召喚不可

        // 2. 完全に手が空いている場合、現在のアシスタントの誰かを放出（スワップ）できるか判定
        let swapPlan = null;
        for (const myReq of sReqs) {
          // 【条件A】スタイリスト自身がこのタスクを代行できるか（スキルチェック等）
          if (!hasSkill(s, myReq.requiredSkill, 1)) continue;
          
          // Handoff禁止タスクの途中交代チェック
          let isFirstTick = false;
          if (nextState.master?.reservations && nextState.master?.menus) {
            const res = nextState.master.reservations.find(r => r.id === myReq.reservationId);
            const allMenus = nextState.master.menus;
            const baseMenu = allMenus.find(m => m.id === res.menuItemId);
            const effectiveMenu = Reservation.getEffectiveMenu(res, allMenus);
            const menu = effectiveMenu || baseMenu;
            const slotDef = (menu?.assistantSlots || [])[myReq.slotIndex];
            
            if (res && slotDef) {
              const resStartMs = toTimestamp(res.startTime);
              const slotStartMs = resStartMs + (slotDef.startMinute || 0) * 60000;
              const currentTickMs = tickMinsFrom9 * 60000;
              if (currentTickMs === slotStartMs) {
                isFirstTick = true;
              }
            }
          }

          if (myReq.isHandoffProhibited && !isFirstTick) continue;

          // 放出対象のアシスタント
          const existingAssign = timeSlot.assignments.find(a => a.requirementId === myReq.id && a.assistantId !== 'MANNCELL_STANDBY' && a.assistantId !== '__none__');
          const targetAssistantId = existingAssign.assistantId;
          const targetAssistant = assistants.find(a => a.id === targetAssistantId);

          // 【条件B】放出対象のアシスタントが、不足箇所のスキルを満たしているか
          if (targetAssistant && hasSkill(targetAssistant, req.requiredSkill, 1)) {
            swapPlan = { reqId: myReq.id, releasedAssistantId: targetAssistantId };
            break; // 1人でも放出できればOK
          }
        }

        if (swapPlan) {
          // 玉突きスワップ成立（アシスタントの放出成功）
          // ※放出されたアシスタントの1人を不足箇所にアサインする
          assignedAssistantId = swapPlan.releasedAssistantId;
          
          // スタイリストは自身のタスクに戻るため、特殊召喚フラグは立てない
          // 状態の更新（アシスタントのアサインを剥がす）
          timeSlot.assignments = timeSlot.assignments.filter(a => a.requirementId !== swapPlan.reqId);
          
          break; // スワップ成立で探索終了
        }
      }
    }

    // 【第三段階】それでもダメなら、究極のSP特殊召喚
    if (!assignedAssistantId) {
      for (const s of sortedStylists) {
        if (s.id === req.stylistId) continue;
        if (busyGapStylists.has(s.id)) continue;
        if (isStaffBlocked(s.id, timeStr, currentTracker)) continue;
        if (!isStaffWorkingAtTime(s, timeStr)) continue;  // 勤務時間外の絶対排除
        
        // 【ルール】単独予約（Tier 2）のスタイリストは、自席を離れての直接救援（SP特殊召喚）を行わない
        const isSingleReservation = (timeSlot.stylistOverlapCounts[s.id] || 0) < 2;
        if (isSingleReservation) continue;

        const sReqs = timeSlot.requirements.filter(r => r.stylistId === s.id && !r.skipAssignment);
        if (sReqs.length === 0) continue;

        let isFullyDelegated = true;
        for (const myReq of sReqs) {
          if (myReq.isFinishing) {
            isFullyDelegated = false;
            break;
          }
          const existingAssign = timeSlot.assignments.find(a => a.requirementId === myReq.id && a.assistantId !== 'MANNCELL_STANDBY' && a.assistantId !== '__none__');
          if (!existingAssign) {
            isFullyDelegated = false;
            break;
          }
          const assignedStaff = assistants.find(a => a.id === existingAssign.assistantId);
          if (!assignedStaff) {
            isFullyDelegated = false;
            break;
          }
        }

        // 自分の全タスクがアシスタントに対応されており、かつ不足箇所のスキルを満たす場合のみ
        if (isFullyDelegated && hasSkill(s, req.requiredSkill, 1)) {
          // SP特殊召喚成立
          // ※バックトラッキング禁止: アシスタントのアサイン状態は一切剥がさない（そのまま維持）
          assignedStylistId = s.id;
          isSpSpecialSummon = true;
          busyGapStylists.add(s.id);
          break;
        }
      }
    }

      // ─── 結果の適用 ───
      const targetWorkerId = assignedAssistantId || assignedStylistId;
      if (targetWorkerId) {
        // 【厳守事項2】データ構造とUI層への分離
        // 【修正】隙間ヘルプは「不足の一時カバー」であり「解決」ではない。
        // unassignedReqs は残し、後続Phase（5.6等）が引き続き不足を検知可能にする。
        // 仕様書: 「赤枠（不足エラー）を共存させて表示する」

        const badge = isSpSpecialSummon ? 'sp_special_summon_gap' : 'gap_help';
        
        timeSlot.assignments.push({
          requirementId: req.id,
          assistantId: targetWorkerId,
          badges: [badge],
          isLocked: false
        });

        if (assignedAssistantId) {
          freeAssistantIds.delete(assignedAssistantId);
        }

        currentOngoingTasks[taskKey] = targetWorkerId;

        const updatedTracker = { ...(currentTracker[targetWorkerId] || { totalAssignedSlots: 0 }) };
        updatedTracker.totalAssignedSlots += 1;
        currentTracker[targetWorkerId] = updatedTracker;
      }
    }
  });

  nextState.tracker = currentTracker;
  nextState.ongoingTasks = currentOngoingTasks;
  
  return nextState;
}
