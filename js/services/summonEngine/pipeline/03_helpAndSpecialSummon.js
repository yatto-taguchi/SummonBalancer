/**
 * Phase 3: 空きスタイリスト召喚＆特殊召喚（お昼・休憩交代）
 * @param {Object} timeSlotState - 対象時間枠の状態（イミュータブル）
 * @param {Object} master - EngineState.master（スタッフ情報など静的データ）
 * @param {Object} tracker - EngineState.tracker（各スタッフの疲労度・休憩状況）
 * @returns {Object} { newTimeSlotState, newTracker } 更新された状態
 */
export const summonStylistAndSpecial = (timeSlotState, master, tracker) => {
  // 1. 状態のディープコピー（イミュータブル原則の徹底）
  const newState = {
    ...timeSlotState,
    assignments: [...timeSlotState.assignments],
    unassignedReqs: [...timeSlotState.unassignedReqs],
    freePoolStaffIds: [...timeSlotState.freePoolStaffIds]
  };

  let currentTracker = { ...tracker };

  // 未アサイン（赤枠）がない場合はそのまま通過
  if (newState.unassignedReqs.length === 0) {
    return { newTimeSlotState: newState, newTracker: currentTracker };
  }

  // 現在の時刻から「時 (Hour)」を抽出 (例: "11:30" -> 11)
  const hour = parseInt(newState.time.split(':')[0], 10);
  const remainingReqs = [];

  // 2. 未アサインの要求ごとに空きスタイリストの召喚を試行
  for (const req of newState.unassignedReqs) {
    let assignedId = null;
    let appliedBadges = [];

    // hasLunch, hasBreak を更新する対象
    let lunchUpdateStaffId = null; 
    let breakUpdateStaffId = null;

    // 現在フリーなスタッフの中から、ジュニア(Lv1アシ)以外を候補とする
    const candidates = newState.freePoolStaffIds.filter(id => {
      const staff = master.staffMap[id];
      return staff && staff.rank !== 'junior'; 
    });

    // 疲労度（アサイン済み枠数）が低い順にソート
    candidates.sort((a, b) => {
      const loadA = currentTracker[a]?.totalAssignedSlots || 0;
      const loadB = currentTracker[b]?.totalAssignedSlots || 0;
      return loadA - loadB;
    });

    // 候補者から最適なスタッフを選出
    for (const candidateId of candidates) {
      const candidateTracker = currentTracker[candidateId] || {};
      const originalStylistTracker = currentTracker[req.stylistId] || {};

      let isLunchSummon = false;
      let isBreakSummon = false;

      // 特殊召喚①（お昼交代）の判定
      if (
        hour >= 11 &&
        originalStylistTracker?.hasLunch &&
        !candidateTracker?.hasLunch
      ) {
        isLunchSummon = true;
        lunchUpdateStaffId = candidateId;
      }

      // 特殊召喚②（休憩交代）の判定
      if (
        hour >= 16 &&
        originalStylistTracker?.hasLunch &&
        originalStylistTracker?.hasBreak &&
        (!candidateTracker?.hasLunch || !candidateTracker?.hasBreak)
      ) {
        isBreakSummon = true;
        breakUpdateStaffId = candidateId;
      }

      // 条件を満たすスタッフを確定
      assignedId = candidateId;
      if (isLunchSummon) appliedBadges.push('special_summon_lunch');
      if (isBreakSummon) appliedBadges.push('special_summon_break');
      
      break; // 1人見つかれば即時ループ脱出（貪欲法）
    }

    // 3. アサイン結果の反映
    if (assignedId) {
      newState.assignments.push({
        requirementId: req.id,
        assistantId: assignedId, // Phase2とキー名を統一
        badges: appliedBadges,
        isLocked: false
      });
      // 召喚したスタッフをフリープールから除外
      newState.freePoolStaffIds = newState.freePoolStaffIds.filter(id => id !== assignedId);

      // trackerの更新（イミュータブル）
      const updatedStaffTracker = { 
        ...(currentTracker[assignedId] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false }) 
      };
      updatedStaffTracker.totalAssignedSlots += 1;
      
      if (lunchUpdateStaffId === assignedId) updatedStaffTracker.hasLunch = true;
      if (breakUpdateStaffId === assignedId) updatedStaffTracker.hasBreak = true;
      
      currentTracker = {
        ...currentTracker,
        [assignedId]: updatedStaffTracker
      };

    } else {
      // 誰も召喚できなかった場合は、依然として「赤枠（未アサイン）」として残す
      remainingReqs.push(req);
    }
  }

  // 4. 残存した赤枠リストで上書き (Phase 4 のマンセル圧縮へ回す)
  newState.unassignedReqs = remainingReqs;

  return { newTimeSlotState: newState, newTracker: currentTracker };
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

    const { newTimeSlotState, newTracker } = summonStylistAndSpecial(
      nextState.timeSlots[time],
      nextState.master,
      nextState.tracker
    );
    
    // 全体の tracker をイミュータブルに更新
    nextState.tracker = newTracker;
    // timeSlot を上書き
    nextState.timeSlots[time] = newTimeSlotState;
  });
  
  return nextState;
}
