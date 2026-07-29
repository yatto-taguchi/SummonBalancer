import { toTimestamp } from '../utils/timeUtils.js';

export function executeFreeTimeAllocation(state) {
  let nextState = state.clone();
  const assistants = nextState.staff.filter(s => s.type === 'assistant');

  // 営業時間の仮設定（本来は引数や設定から取得すべきですが、一旦ダミーとして固定）
  // ※実際の予約の最小〜最大時間から算出してもよい
  let minTime = Infinity;
  let maxTime = -Infinity;
  nextState.reservations.forEach(r => {
    const s = toTimestamp(r.startTime);
    const e = toTimestamp(r.endTime);
    if (s < minTime) minTime = s;
    if (e > maxTime) maxTime = e;
  });

  if (minTime === Infinity || maxTime === -Infinity) {
    return nextState; // 予約がない日は何もしない
  }

  // フリーズ境界をミリ秒に変換（9:00基準の分数 → ミリ秒タイムスタンプ）
  const freezeBoundaryMs = (nextState.freezeBoundary !== null)
    ? toTimestamp(nextState.freezeBoundary)
    : null;

  const THIRTY_MINUTES = 1800000; // 30 minutes in ms

  assistants.forEach(assistant => {
    // このアシスタントがアサインされているスロットの時間帯をすべて取得
    const busyPeriods = [];
    nextState.slots.forEach(slot => {
      if (slot.status === 'assigned') {
        const assignedId = nextState.assignments[slot.reservationId]?.[slot.slotIndex];
        if (assignedId === assistant.id) {
          busyPeriods.push({
            start: toTimestamp(slot.startTime),
            end: toTimestamp(slot.endTime)
          });
        }
      }
    });

    // 時間順にソート
    busyPeriods.sort((a, b) => a.start - b.start);

    // 結合（重なっている時間帯をマージする）
    const mergedPeriods = [];
    if (busyPeriods.length > 0) {
      let current = { ...busyPeriods[0] };
      for (let i = 1; i < busyPeriods.length; i++) {
        const next = busyPeriods[i];
        if (next.start <= current.end) {
          current.end = Math.max(current.end, next.end);
        } else {
          mergedPeriods.push(current);
          current = { ...next };
        }
      }
      mergedPeriods.push(current);
    }

    // ギャップ（空き時間）を計算し、30分以上ならActivityを割り当てる
    let practiceDone = false; // その日すでに練習を入れたか
    let currentTime = minTime;

    const checkAndAddGap = (startGap, endGap) => {
      // フリーズ境界以前のギャップにはフリータイムを割り当てない
      if (freezeBoundaryMs !== null && endGap <= freezeBoundaryMs) return;
      // フリーズ境界をまたぐ場合は、未来部分のみを対象にする
      const effectiveStart = (freezeBoundaryMs !== null && startGap < freezeBoundaryMs)
        ? freezeBoundaryMs
        : startGap;
      const duration = endGap - effectiveStart;
      if (duration >= THIRTY_MINUTES) {
        // 30分のブロックを生成
        const actType = practiceDone ? 'cleaning' : 'practice';
        
        nextState = nextState.addActivity({
          id: `act_${assistant.id}_${startGap}`,
          staffId: assistant.id,
          startTime: startGap,
          endTime: startGap + THIRTY_MINUTES,
          activity: actType,
          label: actType === 'practice' ? '練習(30分)' : '掃除'
        });

        practiceDone = true; // 1回練習したら以後は掃除等にする
      }
    };

    // 各アサインの間のギャップをチェック
    mergedPeriods.forEach(period => {
      if (period.start > currentTime) {
        checkAndAddGap(currentTime, period.start);
      }
      currentTime = Math.max(currentTime, period.end);
    });

    // 最後の予約から終業時間までのギャップ
    if (currentTime < maxTime) {
      checkAndAddGap(currentTime, maxTime);
    }
  });
  
  return nextState;
}
