/**
 * Phase 6: フリータイム割り当て（お昼・休憩・練習・大掃除・空き時間）
 *
 * 全Phase（1〜5）確定後に実行される最終フェーズ。
 * 各スタッフの1日のタイムラインを5分Tickベースで横断スキャンし、
 * 連続する6Tick（30分）の完全な空きを検出して活動ブロックを配置する。
 *
 * 稼働率（Tracker）ルール:
 *   含める: lunch, rest（必須権利枠）
 *   含めない: practice, cleaning, free_time（余剰業務）
 *
 * @module pipeline/06_freeTimeAllocation
 */

/** 営業時間 9:00〜19:00 = 600分 = 120 ticks */
const TOTAL_TICKS = 120;

/** 1ブロック = 30分 = 6 ticks */
const BLOCK_TICKS = 6;

/** お昼ご飯の最早開始: 10:30 = 90分 / 5 = 18 ticks */
const LUNCH_EARLIEST_TICK = 18;

/** 休憩までの必須間隔: 2時間 = 120分 / 5 = 24 ticks */
const REST_GAP_TICKS = 24;

/**
 * 13:00 = 4時間 = 240分 / 5 = 48 ticks
 * お昼可バッジの判定で使用（13:00前のブロックはお昼に変換可能）
 */
const TICK_13_00 = 48;

// ─────────────────────────────────────────────────────
//  ヘルパー関数（純粋関数）
// ─────────────────────────────────────────────────────

/**
 * 指定スタッフの5分Tickベース占有マップ（120要素）を構築する。
 * true = そのTickは何かしらのタスク/予約で埋まっている。
 *
 * 判定対象:
 *   1. スタイリスト自身の予約（担当客）
 *   2. timeSlots 内の assignments（アシスタントとして配置された5分Tick）
 *   3. スタイリスト召喚（ヘルプとして召喚されている時間）
 *   4. 勤務時間外（isWorkingAtTime() === false の領域）
 *
 * @param {string} staffId
 * @param {Object} state - EngineState
 * @returns {boolean[]} 120要素の占有マップ
 */
function buildOccupancyMap(staffId, state) {
  const occupied = new Array(TOTAL_TICKS).fill(false);

  // --- 1. スタイリスト自身の予約 ---
  (state.master?.reservations || []).forEach(res => {
    if (res.stylistId === staffId) {
      const startMin = typeof res.startTime === 'number' ? res.startTime : 0;
      const endMin = typeof res.endTime === 'number' ? res.endTime : 0;
      const startTick = Math.max(0, Math.floor(startMin / 5));
      const endTick = Math.min(TOTAL_TICKS, Math.ceil(endMin / 5));
      for (let t = startTick; t < endTick; t++) occupied[t] = true;
    }
  });

  // --- 2. timeSlots内のassignment（5分Tickごと） ---
  if (state.timeSlots) {
    Object.keys(state.timeSlots).forEach(timeStr => {
      const ts = state.timeSlots[timeStr];
      if (!ts.assignments) return;
      const isAssigned = ts.assignments.some(a => a.assistantId === staffId);
      if (isAssigned) {
        const [h, m] = timeStr.split(':').map(Number);
        const tickMin = (h - 9) * 60 + m;
        const tickIdx = Math.floor(tickMin / 5);
        if (tickIdx >= 0 && tickIdx < TOTAL_TICKS) occupied[tickIdx] = true;
      }
    });
  }

  // --- 3. スタイリスト召喚 ---
  (state.stylistSummons || []).forEach(summon => {
    if (summon.stylistId !== staffId) return;
    const sMin = parseTimeToMinutes(summon.startTime);
    const eMin = parseTimeToMinutes(summon.endTime);
    const startTick = Math.max(0, Math.floor(sMin / 5));
    const endTick = Math.min(TOTAL_TICKS, Math.ceil(eMin / 5));
    for (let t = startTick; t < endTick; t++) occupied[t] = true;
  });

  // --- 4. 勤務時間外 ---
  const staffObj = (state.master?.staffMap || {})[staffId];
  if (staffObj && typeof staffObj.isWorkingAtTime === 'function') {
    for (let t = 0; t < TOTAL_TICKS; t++) {
      const absMinute = 540 + t * 5; // 9:00 = 540分
      if (!staffObj.isWorkingAtTime(absMinute)) {
        occupied[t] = true;
      }
    }
  }

  return occupied;
}

/**
 * 時刻値（数値/文字列）を「9:00基準の分数」に変換する。
 * @param {number|string} timeVal
 * @returns {number} 9:00基準の分オフセット
 */
function parseTimeToMinutes(timeVal) {
  if (typeof timeVal === 'number') return timeVal;
  if (typeof timeVal === 'string' && timeVal.includes(':')) {
    const [h, m] = timeVal.split(':').map(Number);
    return (h - 9) * 60 + m;
  }
  return 0;
}

/**
 * 占有マップ上で、指定Tick以降から連続BLOCK_TICKS(6Tick)が空いている
 * 最適な開始位置を探す。「他スタッフの同種配置との時間重なりが最小」の位置を返す。
 *
 * @param {boolean[]} occupied - 120要素の占有マップ
 * @param {number} searchFromTick - 検索開始Tick
 * @param {Object<string, {startTick: number, endTick: number}>} peerAllocations - 他スタッフの同種割り当て
 * @returns {number} 最適な開始Tick（見つからなければ -1）
 */
function findBestWindow(occupied, searchFromTick, peerAllocations) {
  let bestTick = -1;
  let minOverlap = Infinity;

  for (let t = searchFromTick; t <= TOTAL_TICKS - BLOCK_TICKS; t++) {
    // 6Tick全てが空いているか確認
    let allFree = true;
    for (let offset = 0; offset < BLOCK_TICKS; offset++) {
      if (occupied[t + offset]) {
        allFree = false;
        break;
      }
    }
    if (!allFree) continue;

    // 他スタッフの同種配置との重なりを計数
    let overlapCount = 0;
    Object.values(peerAllocations).forEach(alloc => {
      if (!alloc) return;
      // 時間帯が重なっているかチェック
      if (alloc.startTick < t + BLOCK_TICKS && alloc.endTick > t) {
        overlapCount++;
      }
    });

    if (overlapCount < minOverlap) {
      minOverlap = overlapCount;
      bestTick = t;
    }
  }

  return bestTick;
}

/**
 * 占有マップの指定範囲を占有済みにマークする（ミューテーション版 — ローカル変数専用）。
 * @param {boolean[]} occupied - 占有マップ（ローカルコピー）
 * @param {number} startTick
 */
function markOccupied(occupied, startTick) {
  for (let t = startTick; t < startTick + BLOCK_TICKS && t < TOTAL_TICKS; t++) {
    occupied[t] = true;
  }
}

/**
 * スタッフがオーナー（経営者）かどうかを判定する。
 * @param {Object} staff
 * @returns {boolean}
 */
function isOwnerStaff(staff) {
  return staff.rank === 'owner' || (staff.rank && staff.rank.id === 'owner');
}

// ─────────────────────────────────────────────────────
//  メインのエクスポート関数
// ─────────────────────────────────────────────────────

/**
 * Phase 6: フリータイム割り当て
 *
 * 全Phase確定後の state を受け取り、各スタッフのタイムラインを横断スキャンして
 * お昼・休憩・練習・大掃除・空き時間の30分ブロックを配置する。
 *
 * @param {Object} state - EngineState（イミュータブル入力）
 * @returns {Object} 新しいEngineState
 */
export function executeFreeTimeAllocation(state) {
  const nextState = state.clone();

  // 全出勤スタッフを取得（スタイリスト + アシスタント）
  const allStaff = (nextState.master?.staff || nextState.staff || [])
    .filter(s => s.isWorking);

  if (allStaff.length === 0) return nextState;

  // フリーズ境界（当日の過去時間は活動を配置しない）
  const freezeTick = (nextState.freezeBoundary !== null && nextState.freezeBoundary !== undefined)
    ? Math.floor(nextState.freezeBoundary / 5)
    : -1;

  // ─── 出力用コレクション（最後にstateへ反映） ───
  const activities = [];
  const allocatedLunch = {};   // staffId → { startTick, endTick }
  const allocatedRest = {};    // staffId → { startTick, endTick }

  // ─── 1. 各スタッフの5分Tick占有マップ構築 ───
  const staffOccupancies = {};
  const baseBusyCounts = {};

  allStaff.forEach(staff => {
    const occ = buildOccupancyMap(staff.id, nextState);
    staffOccupancies[staff.id] = occ;
    baseBusyCounts[staff.id] = occ.reduce((sum, val) => sum + (val ? 1 : 0), 0);
  });

  // ─── 2. お昼ご飯アサイン ───
  // 2a. 手動オーバーライド
  allStaff.forEach(staff => {
    const manualStartMin = (nextState.lunchOverrides || {})[staff.id];
    if (manualStartMin == null) return;

    const startTick = Math.floor(manualStartMin / 5);
    allocatedLunch[staff.id] = { startTick, endTick: startTick + BLOCK_TICKS };
    markOccupied(staffOccupancies[staff.id], startTick);
    activities.push({
      staffId: staff.id,
      startTime: startTick * 5,
      endTime: (startTick + BLOCK_TICKS) * 5,
      activity: 'lunch',
      isManualLunch: true
    });
  });

  // 2b. 自動ずらし配置（他スタッフとの重なりが最小の位置に配置）
  allStaff.forEach(staff => {
    if (allocatedLunch[staff.id]) return; // 手動配置済み

    const effectiveStart = Math.max(LUNCH_EARLIEST_TICK, freezeTick + 1);
    const bestTick = findBestWindow(
      staffOccupancies[staff.id],
      effectiveStart,
      allocatedLunch
    );

    if (bestTick !== -1) {
      allocatedLunch[staff.id] = { startTick: bestTick, endTick: bestTick + BLOCK_TICKS };
      markOccupied(staffOccupancies[staff.id], bestTick);
      activities.push({
        staffId: staff.id,
        startTime: bestTick * 5,
        endTime: (bestTick + BLOCK_TICKS) * 5,
        activity: 'lunch'
      });
    }
  });

  // ─── 3. 休憩アサイン ───
  // 3a. 手動オーバーライド
  allStaff.forEach(staff => {
    if (!allocatedLunch[staff.id]) return; // お昼未配置なら休憩もスキップ

    const manualRestMin = (nextState.restOverrides || {})[staff.id];
    if (manualRestMin == null) return;

    const startTick = Math.floor(manualRestMin / 5);
    allocatedRest[staff.id] = { startTick, endTick: startTick + BLOCK_TICKS };
    markOccupied(staffOccupancies[staff.id], startTick);
    activities.push({
      staffId: staff.id,
      startTime: startTick * 5,
      endTime: (startTick + BLOCK_TICKS) * 5,
      activity: 'rest',
      isManualRest: true
    });
  });

  // 3b. 自動配置（お昼終了の2時間後以降の空き枠）
  allStaff.forEach(staff => {
    if (!allocatedLunch[staff.id] || allocatedRest[staff.id]) return;

    const lunchEnd = allocatedLunch[staff.id].endTick;
    const minRestStart = Math.max(lunchEnd + REST_GAP_TICKS, freezeTick + 1);
    const bestTick = findBestWindow(
      staffOccupancies[staff.id],
      minRestStart,
      allocatedRest
    );

    if (bestTick !== -1) {
      allocatedRest[staff.id] = { startTick: bestTick, endTick: bestTick + BLOCK_TICKS };
      markOccupied(staffOccupancies[staff.id], bestTick);
      activities.push({
        staffId: staff.id,
        startTime: bestTick * 5,
        endTime: (bestTick + BLOCK_TICKS) * 5,
        activity: 'rest'
      });
    }
  });

  // ─── 4. その他の活動アサイン（練習・大掃除・空き時間） ───
  allStaff.forEach(staff => {
    const isOwner = isOwnerStaff(staff);
    let practiceAssigned = false;
    let cleaningAssigned = false;
    const occupied = staffOccupancies[staff.id];

    let t = Math.max(0, freezeTick + 1);
    while (t <= TOTAL_TICKS - BLOCK_TICKS) {
      // 連続6Tickの空きを探す
      let blockFree = true;
      for (let offset = 0; offset < BLOCK_TICKS; offset++) {
        if (occupied[t + offset]) {
          blockFree = false;
          // 占有されているTickの次から再開
          t = t + offset + 1;
          break;
        }
      }
      if (!blockFree) continue;

      // 活動タイプを決定
      let activityType;
      if (isOwner) {
        activityType = 'free_time';
      } else if (!practiceAssigned) {
        activityType = 'practice';
        practiceAssigned = true;
      } else if (!cleaningAssigned) {
        activityType = 'cleaning';
        cleaningAssigned = true;
      } else {
        activityType = 'free_time';
      }

      activities.push({
        staffId: staff.id,
        startTime: t * 5,
        endTime: (t + BLOCK_TICKS) * 5,
        activity: activityType
      });

      // このブロックを占有済みにマーク（後続のブロック検出に影響しないように）
      markOccupied(occupied, t);
      t += BLOCK_TICKS;
    }
  });

  // ─── 5. UI用バッジフラグの判定 ───
  activities.forEach(act => {
    const lunch = allocatedLunch[act.staffId];
    const rest = allocatedRest[act.staffId];
    const actStartTick = Math.floor(act.startTime / 5);

    // --- 「お昼可」バッジ ---
    // practice/cleaning ブロックで、13:00前 or 昼食配置位置より前にある場合
    if (act.activity === 'practice' || act.activity === 'cleaning') {
      if (!lunch || lunch.startTick > TICK_13_00) {
        // 昼食が遅い or 未配置: 13:00前のブロックはお昼変換可能
        if (actStartTick < TICK_13_00) {
          act.isLunchConvertible = true;
        }
      } else if (lunch && actStartTick < lunch.startTick) {
        // 昼食が配置済みでも、それより前にあるブロックはお昼変換可能
        act.isLunchConvertible = true;
      }
    }

    // --- 「休憩可」バッジ ---
    // practice/cleaning/free_time ブロックで、昼食後〜休憩前にある場合
    if (
      (act.activity === 'practice' || act.activity === 'cleaning' || act.activity === 'free_time')
      && lunch
    ) {
      if (actStartTick >= lunch.endTick) {
        if (rest) {
          // 休憩が配置済み: 休憩より前のブロックのみ変換可能
          if (actStartTick < rest.startTick) {
            act.isConvertibleToRest = true;
          }
        } else {
          // 休憩が未配置: 昼食後の全ブロックが変換可能
          act.isConvertibleToRest = true;
        }
      }
    }
  });

  // ─── 6. tracker 更新（lunch / rest フラグ） ───
  const updatedTracker = {};
  Object.keys(nextState.tracker || {}).forEach(id => {
    updatedTracker[id] = { ...(nextState.tracker[id]) };
  });
  allStaff.forEach(staff => {
    const current = updatedTracker[staff.id] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
    updatedTracker[staff.id] = {
      ...current,
      hasLunch: !!allocatedLunch[staff.id],
      hasBreak: !!allocatedRest[staff.id]
    };
  });



  // ─── 8. フリーズ済み過去活動の結合 ───
  const mergedActivities = [...activities];
  if (nextState.frozenFreeTimeActivities && nextState.frozenFreeTimeActivities.length > 0) {
    // 過去の活動のうち、現在の freezeTick 以前に終了しているものを抽出して結合
    const frozenTickMax = freezeTick >= 0 ? freezeTick : 0;
    const pastActivities = nextState.frozenFreeTimeActivities.filter(a => {
      const startT = Math.floor(a.startTime / 5);
      return startT <= frozenTickMax;
    });
    
    pastActivities.forEach(a => {
      mergedActivities.push(a);
      // 過去にお昼・休憩を取っていた場合は tracker を更新
      if (a.activity === 'lunch') {
        const current = updatedTracker[a.staffId] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
        current.hasLunch = true;
        updatedTracker[a.staffId] = current;
      }
      if (a.activity === 'rest') {
        const current = updatedTracker[a.staffId] || { totalAssignedSlots: 0, hasLunch: false, hasBreak: false };
        current.hasBreak = true;
        updatedTracker[a.staffId] = current;
      }
    });
  }

  // ─── 9. 新しいstateを生成して返却（イミュータブル） ───
  nextState.freeTimeActivities = mergedActivities;
  nextState.tracker = updatedTracker;
  // ─── 10. カスタム稼働率の計算 ───
  // lunch/rest は稼働率に含める（必須権利枠）
  // practice/cleaning/free_time は含めない（余剰業務）
  const utilizationRates = {};
  allStaff.forEach(staff => {
    // 最新のtrackerを参照して、過去に取得済みか判定
    const staffTracker = updatedTracker[staff.id] || {};
    const hasLunch = staffTracker.hasLunch || !!allocatedLunch[staff.id];
    const hasRest = staffTracker.hasBreak || !!allocatedRest[staff.id];

    if (!hasLunch && !hasRest) {
      // 両方取れていない = 過稼働
      utilizationRates[staff.id] = 120;
    } else if (!hasLunch || !hasRest) {
      // 片方だけ取れていない
      utilizationRates[staff.id] = 110;
    } else {
      // 両方取得済み: 基本稼働Tick + lunch(6) + rest(6) で算出
      const busyTicks = baseBusyCounts[staff.id] + BLOCK_TICKS + BLOCK_TICKS;
      const baseRate = (busyTicks / TOTAL_TICKS) * 100;
      utilizationRates[staff.id] = Math.min(100, Math.round(baseRate));
    }
  });

  nextState.utilizationRates = utilizationRates;

  return nextState;
}
