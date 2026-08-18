/**
 * ISO文字列や数値(分)の時間を比較可能なタイムスタンプ(ms)に変換する
 */
export function toTimestamp(timeStrOrNum) {
  if (typeof timeStrOrNum === 'number') {
    // 既に数値(分)の場合はミリ秒に変換
    return timeStrOrNum * 60000;
  }
  if (typeof timeStrOrNum === 'string') {
    if (timeStrOrNum.match(/^\d{1,2}:\d{2}$/)) {
      const [h, m] = timeStrOrNum.split(':').map(Number);
      return ((h - 9) * 60 + m) * 60000; // 9:00基準のミリ秒に変換
    }
    return new Date(timeStrOrNum).getTime();
  }
  return 0;
}

/**
 * 2つの時間帯が重なっているか判定する
 */
export function isOverlapping(start1, end1, start2, end2) {
  const s1 = toTimestamp(start1);
  const e1 = toTimestamp(end1);
  const s2 = toTimestamp(start2);
  const e2 = toTimestamp(end2);
  return s1 < e2 && s2 < e1;
}

/**
 * 対象スタッフが、指定された時間帯に既に別のアサインが入っているか(空いているか)判定する
 */
export function isStaffFree(staffId, startTime, endTime, slots, assignments, reservations = []) {
  // すべての確定済みアサインをチェック
  for (const resId in assignments) {
    const resAssignments = assignments[resId];
    for (const slotIndex in resAssignments) {
      if (resAssignments[slotIndex] === staffId) {
        // 対象スタッフがアサインされているスロットを見つけた
        const slotId = `slot_${resId}_${slotIndex}`;
        const assignedSlot = slots.find(s => s.id === slotId);
        
        if (assignedSlot) {
          // 時間帯が重なっているかチェック
          if (isOverlapping(startTime, endTime, assignedSlot.startTime, assignedSlot.endTime)) {
            return false; // 重なっている＝空いていない
          }
        }
      }
    }
  }

  // もし対象スタッフがスタイリストだった場合、自分自身のお客様（予約）の対応中でないかをチェック
  for (const res of reservations) {
    if (res.stylistId === staffId) {
      if (isOverlapping(startTime, endTime, res.startTime, res.endTime)) {
        return false; // 自分自身の予約と重なっている＝空いていない
      }
    }
  }

  return true; // 重なるアサイン・予約はなかった＝空いている
}

/**
 * 時間（文字列・数値・Date）を HH:MM 形式の文字列にフォーマットする
 */
export function formatTime(timeVal) {
  if (typeof timeVal === 'number') {
    // 分数の場合（0 = 00:00, 60 = 01:00）
    const hours = Math.floor(timeVal / 60) + 9; // ※既存システムが 0=9:00 としている場合があるが、ここでは安全に Date に変換するかどうか。いや、既存UIは分数ベース。
    // 分数が絶対時間（例: 600分 = 10:00）の場合と相対時間の場合がある。
    // 既存UIの `timeline.js` は START_HOUR=9 で計算している。
    // 旧エンジンの _formatTime を模倣する：
    const date = new Date(toTimestamp(timeVal));
    if (typeof timeVal === 'number') {
      const h = Math.floor(timeVal / 60) + 9; // 9時開始
      const m = timeVal % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  
  const d = new Date(timeVal);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 対象スタッフが指定された時間（Tick）にブロック（不在）設定されているか判定する。
 * すべての比較は「9:00基準の相対分数（整数）」で統一し、半開区間 [start, end) で判定する。
 * @param {string} staffId - スタッフID
 * @param {string|number} timeVal - 時刻（"HH:MM"文字列 or 9:00基準の相対分数）
 * @param {Object} tracker - EngineState.tracker
 * @returns {boolean} ブロック中であればtrue
 */
export function isStaffBlocked(staffId, timeVal, tracker) {
  if (!tracker || !tracker[staffId] || !tracker[staffId].blockedTimes) {
    return false;
  }
  // timeVal を「9:00基準の相対分数」に正規化する（SSOT統一）
  let tickMinuteFrom9;
  if (typeof timeVal === 'number') {
    // 既に9:00基準の分数として渡されている場合
    tickMinuteFrom9 = timeVal;
  } else if (typeof timeVal === 'string' && timeVal.match(/^\d{1,2}:\d{2}$/)) {
    // "HH:MM" 文字列の場合
    const [h, m] = timeVal.split(':').map(Number);
    tickMinuteFrom9 = (h - 9) * 60 + m;
  } else {
    // その他の形式はtoTimestamp経由で変換（フォールバック）
    tickMinuteFrom9 = Math.round(toTimestamp(timeVal) / 60000);
  }
  for (const block of tracker[staffId].blockedTimes) {
    // block.startTime/endTime は 9:00基準の相対分数（整数）
    // 半開区間 [startTime, endTime) でTick単位の判定を行う
    if (tickMinuteFrom9 >= block.startTime && tickMinuteFrom9 < block.endTime) {
      return true;
    }
  }
  return false;
}

/**
 * 対象スタッフが指定された時間（Tick）に勤務時間内かどうかを判定する（純粋関数）。
 * 仕様書セクション2「勤務時間外の絶対排除」に基づき、workStartTime〜workEndTime の
 * 範囲外のスタッフはいかなるアサインからも除外する。
 * 
 * @param {Object} staff - スタッフオブジェクト（workStartTime, workEndTime, isWorking, isWorkingAtTime を持つ）
 * @param {string|number} timeVal - 時刻（"HH:MM"文字列 or 9:00基準の相対分数）
 * @returns {boolean} 勤務時間内であればtrue、時間外であればfalse
 */
export function isStaffWorkingAtTime(staff, timeVal) {
  if (!staff) return false;
  if (!staff.isWorking) return false;

  // スタッフオブジェクトにメソッドがある場合はそれを優先利用
  if (typeof staff.isWorkingAtTime === 'function') {
    // isWorkingAtTime は 0:00基準の通算分数を受け取る
    let absMinute;
    if (typeof timeVal === 'number') {
      // 9:00基準の相対分数 → 0:00基準の通算分数
      absMinute = timeVal + 9 * 60;
    } else if (typeof timeVal === 'string' && timeVal.match(/^\d{1,2}:\d{2}$/)) {
      const [h, m] = timeVal.split(':').map(Number);
      absMinute = h * 60 + m;
    } else {
      return true; // 変換不可の場合は安全側で通過
    }
    return staff.isWorkingAtTime(absMinute);
  }

  // メソッドが存在しない場合は workStartTime/workEndTime から直接判定
  const startParts = (staff.workStartTime || '09:00').split(':');
  const startMin = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
  const endParts = (staff.workEndTime || '19:00').split(':');
  const endMin = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);

  let absMinute;
  if (typeof timeVal === 'number') {
    absMinute = timeVal + 9 * 60; // 9:00基準 → 0:00基準
  } else if (typeof timeVal === 'string' && timeVal.match(/^\d{1,2}:\d{2}$/)) {
    const [h, m] = timeVal.split(':').map(Number);
    absMinute = h * 60 + m;
  } else {
    return true; // 変換不可の場合は安全側で通過
  }

  return absMinute >= startMin && absMinute < endMin;
}

