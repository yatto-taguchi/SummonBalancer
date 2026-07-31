import { hasSkill } from '../utils/skillUtils.js?v=3';

/**
 * Phase 3: 空きスタイリスト召喚＆特殊召喚（お昼・休憩交代）
 * 2段階アーキテクチャ:
 *   Step 3-1: 残りのアシスタントで未アサインタスクを消化
 *   Step 3-2: それでも残ったタスクに対し、空きスタイリストを召喚
 * @param {Object} timeSlotState - 対象時間枠の状態（イミュータブル）
 * @param {Object} master - EngineState.master（スタッフ情報など静的データ）
 * @param {Object} tracker - EngineState.tracker（各スタッフの疲労度・休憩状況）
 * @returns {Object} { newTimeSlotState, newTracker } 更新された状態
 */
export const summonStylistAndSpecial = (timeSlotState, master, tracker, ongoingTasks) => {
  // 1. 状態のディープコピー（イミュータブル原則の徹底）
  const newState = {
    ...timeSlotState,
    assignments: [...timeSlotState.assignments],
    unassignedReqs: [...timeSlotState.unassignedReqs],
    freePoolStaffIds: [...timeSlotState.freePoolStaffIds]
  };

  let currentTracker = { ...tracker };
  let currentOngoingTasks = { ...(ongoingTasks || {}) };

  // 未アサイン（赤枠）がない場合はそのまま通過
  if (newState.unassignedReqs.length === 0) {
    return { newTimeSlotState: newState, newTracker: currentTracker };
  }

  // 現在の時刻から「時 (Hour)」を抽出 (例: "11:30" -> 11)
  const hour = parseInt(newState.time.split(':')[0], 10);

  // ================================================================
  // Step 3-1: 残りのアシスタントで未アサインタスクの消化を試行
  // （アシスタント優先の原則を徹底するため、スタイリストより先に処理）
  // ================================================================
  const afterStep1Reqs = [];
  for (const unassigned of newState.unassignedReqs) {
    const fullReq = timeSlotState.requirements.find(r => r.id === unassigned.requirementId);
    if (!fullReq) continue;

    // === 固定モード保護【フォールバック禁止】 ===
    // fixedAssistantId が設定されている要件は Phase 2 Step -1 で最優先処理済み。
    // ここに来ているということは固定スタッフが使用不可（重複固定等）のケース。
    // 【SSOT準拠】代替アサインは行わず、未アサイン（赤枠エラー）として残す。
    if (fullReq.fixedAssistantId) {
      const fixedId = fullReq.fixedAssistantId;
      // freePool にまだいるか再チェック
      const isInFreePool = newState.freePoolStaffIds.includes(fixedId);
      if (isInFreePool) {
        // 固定スタッフがフリーなら最優先でアサイン
        newState.assignments.push({
          requirementId: fullReq.id,
          assistantId: fixedId,
          badges: [],
          isLocked: false
        });
        newState.freePoolStaffIds = newState.freePoolStaffIds.filter(id => id !== fixedId);
        const updatedTracker = {
          ...(currentTracker[fixedId] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false })
        };
        updatedTracker.totalAssignedSlots += 1;
        currentTracker = { ...currentTracker, [fixedId]: updatedTracker };
        const taskKey = `${fullReq.reservationId}_${fullReq.slotIndex}`;
        currentOngoingTasks[taskKey] = fixedId;
        continue; // 次のunassignedへ
      }
      // 【フォールバック禁止】固定スタッフが使用不可 → 代替アサインせず未アサインとして残す
      console.warn(`[Phase 3] 固定スタッフ ${fixedId} は Step 3-1 で使用不可。フォールバック禁止のため未アサインとして残します。`);
      continue; // 代替アサインせずそのまま残す
    }

    // === skipAssignment 保護 ===
    if (fullReq.skipAssignment) continue; // __none__ 固定は Phase 2 で処理済み

    // 交代禁止タスクのロック状態を確認
    const taskKey = `${fullReq.reservationId}_${fullReq.slotIndex}`;
    const lockedStaffId = currentOngoingTasks[taskKey] || null;

    // freePoolStaffIds に残っているアシスタントのみを候補とする
    let candidates = newState.freePoolStaffIds
      .map(id => master.staffMap[id])
      .filter(s => {
        if (!s || s.type !== 'assistant' || !hasSkill(s, fullReq.requiredSkill, fullReq.minSkillLevel)) {
          return false;
        }
        // ロックされているタスクなら、ロックされた本人以外は絶対に入れない（除外）
        if (fullReq.isHandoffProhibited && lockedStaffId && s.id !== lockedStaffId) {
          return false;
        }
        return true;
      });

    // ソフトロック（継続性）のための直前担当者を取得
    const ongoingAssistantId = currentOngoingTasks[taskKey] || null;

    // 候補者のソート：継続性を最優先（ソフトロック）し、次に疲労度（アサイン済み枠数）が低い順にソート
    candidates.sort((a, b) => {
      // 1. 交代可能・不可に関わらず、直前のTickでアサインされている人を最優先（細切れ防止）
      if (ongoingAssistantId) {
        if (a.id === ongoingAssistantId) return -1;
        if (b.id === ongoingAssistantId) return 1;
      }
      // 2. それ以外は疲労度が低い順にソート
      const loadA = currentTracker[a.id]?.totalAssignedSlots || 0;
      const loadB = currentTracker[b.id]?.totalAssignedSlots || 0;
      return loadA - loadB;
    });

    if (candidates.length > 0) {
      const selected = candidates[0];
      newState.assignments.push({
        requirementId: fullReq.id,
        assistantId: selected.id,
        badges: [],
        isLocked: false
      });
      // 使用したアシスタントをフリープールから除外
      newState.freePoolStaffIds = newState.freePoolStaffIds.filter(id => id !== selected.id);

      // trackerの更新（イミュータブル）
      const updatedTracker = {
        ...(currentTracker[selected.id] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false })
      };
      updatedTracker.totalAssignedSlots += 1;
      currentTracker = { ...currentTracker, [selected.id]: updatedTracker };

      // 継続性のための直前担当者更新
      currentOngoingTasks[taskKey] = selected.id;
    } else {
      // アシスタントでは対応不可 → Step 3-2（スタイリスト召喚）へ回す
      afterStep1Reqs.push(unassigned);
    }
  }

  // ================================================================
  // Step 3-2: 空きスタイリストの召喚（アシスタントでも足りなかったタスクのみ）
  // ================================================================
  const summonedStylistIds = new Set(); // 同一Tick内の重複召喚を防止
  const remainingReqs = [];

  for (const unassigned of afterStep1Reqs) {
    const fullReq = timeSlotState.requirements.find(r => r.id === unassigned.requirementId);
    if (!fullReq) continue;

    // === 固定モード保護【フォールバック禁止】（スタイリスト固定のリトライ） ===
    if (fullReq.fixedAssistantId) {
      const fixedId = fullReq.fixedAssistantId;
      // スタイリストが固定されているか確認
      const allStylists = (master.staff || []).filter(s => s.type === 'stylist' && s.isWorking);
      const fixedStylist = allStylists.find(s => s.id === fixedId);
      if (fixedStylist) {
        // 固定されたスタイリストの空き確認（overlap数が0）
        const overlap = newState.stylistOverlapCounts[fixedId] || 0;
        if (overlap === 0) {
          newState.assignments.push({
            requirementId: fullReq.id,
            assistantId: fixedId,
            badges: [],
            isLocked: false
          });
          const updatedTracker = {
            ...(currentTracker[fixedId] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false })
          };
          updatedTracker.totalAssignedSlots += 1;
          currentTracker = { ...currentTracker, [fixedId]: updatedTracker };
          const taskKey = `${fullReq.reservationId}_${fullReq.slotIndex}`;
          currentOngoingTasks[taskKey] = fixedId;
          continue;
        }
      }
      // 【フォールバック禁止】固定スタッフが使用不可 → 代替アサインせず未アサインとして残す
      console.warn(`[Phase 3] 固定スタッフ ${fixedId} は Step 3-2 でも使用不可。フォールバック禁止のため未アサインとして残します。`);
      continue; // 代替アサインせずそのまま残す
    }

    // === skipAssignment 保護 ===
    if (fullReq.skipAssignment) continue;

    // 交代禁止タスクのロック状態を確認
    const taskKey = `${fullReq.reservationId}_${fullReq.slotIndex}`;
    const lockedStaffId = currentOngoingTasks[taskKey] || null;

    let assignedId = null;
    let appliedBadges = [];
    let lunchUpdateStaffId = null;
    let breakUpdateStaffId = null;

    // 空きスタイリストのみを候補とする（重複防止・スキルチェック・自己召喚防止）
    const allStylists = (master.staff || []).filter(s => s.type === 'stylist' && s.isWorking);
    const candidates = allStylists.filter(s => {
      // ロックされているタスクなら、ロックされた本人以外は絶対に入れない（除外）
      if (fullReq.isHandoffProhibited && lockedStaffId && s.id !== lockedStaffId) {
        return false;
      }

      const overlap = newState.stylistOverlapCounts[s.id] || 0;
      return overlap === 0
        && s.id !== fullReq.stylistId         // 自己召喚防止
        && !summonedStylistIds.has(s.id)       // 同一Tick内の重複防止
        && hasSkill(s, fullReq.requiredSkill, fullReq.minSkillLevel); // スキルチェック
    });

    // ソフトロック（継続性）のための直前担当者を取得
    const ongoingAssistantId = currentOngoingTasks[taskKey] || null;

    // 候補者のソート：継続性を最優先（ソフトロック）し、次に疲労度（アサイン済み枠数）が低い順にソート
    candidates.sort((a, b) => {
      // 1. 交代可能・不可に関わらず、直前のTickでアサインされている人を最優先（細切れ防止）
      if (ongoingAssistantId) {
        if (a.id === ongoingAssistantId) return -1;
        if (b.id === ongoingAssistantId) return 1;
      }
      // 2. それ以外は疲労度（アサイン済み枠数）が低い順にソート
      const loadA = currentTracker[a.id]?.totalAssignedSlots || 0;
      const loadB = currentTracker[b.id]?.totalAssignedSlots || 0;
      return loadA - loadB;
    });

    // 候補者から最適なスタッフを選出（特殊召喚の判定を含む）
    for (const candidate of candidates) {
      const candidateTracker = currentTracker[candidate.id] || {};
      const originalStylistTracker = currentTracker[fullReq.stylistId] || {};

      let isLunchSummon = false;
      let isBreakSummon = false;

      // 特殊召喚①（お昼交代）の判定
      if (
        hour >= 11 &&
        originalStylistTracker?.hasLunch &&
        !candidateTracker?.hasLunch
      ) {
        isLunchSummon = true;
        lunchUpdateStaffId = candidate.id;
      }

      // 特殊召喚②（休憩交代）の判定
      if (
        hour >= 16 &&
        originalStylistTracker?.hasLunch &&
        originalStylistTracker?.hasBreak &&
        (!candidateTracker?.hasLunch || !candidateTracker?.hasBreak)
      ) {
        isBreakSummon = true;
        breakUpdateStaffId = candidate.id;
      }

      // 条件を満たすスタッフを確定
      assignedId = candidate.id;
      if (isLunchSummon) appliedBadges.push('special_summon_lunch');
      if (isBreakSummon) appliedBadges.push('special_summon_break');

      break; // 1人見つかれば即時ループ脱出（貪欲法）
    }

    // アサイン結果の反映
    if (assignedId) {
      newState.assignments.push({
        requirementId: fullReq.id,
        assistantId: assignedId,
        badges: appliedBadges,
        isLocked: false
      });

      // 召喚済みセットに追加（同一Tick内での再選出を防止）
      summonedStylistIds.add(assignedId);

      // trackerの更新（イミュータブル）
      const updatedStaffTracker = {
        ...(currentTracker[assignedId] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false })
      };
      updatedStaffTracker.totalAssignedSlots += 1;
      if (lunchUpdateStaffId === assignedId) updatedStaffTracker.hasLunch = true;
      if (breakUpdateStaffId === assignedId) updatedStaffTracker.hasBreak = true;
      currentTracker = { ...currentTracker, [assignedId]: updatedStaffTracker };

      // 継続性のための直前担当者更新
      currentOngoingTasks[taskKey] = assignedId;

    } else {
      // 誰も召喚できなかった場合、Tier 1(必須)のみエラーとして残し、Tier 2(任意)は破棄する
      if (fullReq.tier === 1) {
        remainingReqs.push(unassigned);
      }
    }
  }

  // 残存した赤枠リストで上書き (Phase 4 のマンセル圧縮へ回す)
  newState.unassignedReqs = remainingReqs;

  return { newTimeSlotState: newState, newTracker: currentTracker, newOngoingTasks: currentOngoingTasks };
};

export function executeHelpAndSpecialSummon(state) {
  let nextState = state.clone();
  
  if (!nextState.timeSlots) return nextState;

  // 各時間枠に対して Phase 3 を実行
  Object.keys(nextState.timeSlots).forEach(time => {
    // フリーズ境界以前のTickはヘルプ召喚をスキップ（確定済みデータを維持）
    const [fH, fM] = time.split(':').map(Number);
    const tickMinsFrom9 = (fH - 9) * 60 + fM;
    if (nextState.freezeBoundary !== null && tickMinsFrom9 <= nextState.freezeBoundary) {
      return;
    }

    const { newTimeSlotState, newTracker, newOngoingTasks } = summonStylistAndSpecial(
      nextState.timeSlots[time],
      nextState.master,
      nextState.tracker,
      nextState.ongoingTasks
    );
    
    // 全体の tracker をイミュータブルに更新
    nextState.tracker = newTracker;
    // ongoingTasks を更新
    nextState.ongoingTasks = newOngoingTasks;
    // timeSlot を上書き
    nextState.timeSlots[time] = newTimeSlotState;
  });
  
  return nextState;
}
