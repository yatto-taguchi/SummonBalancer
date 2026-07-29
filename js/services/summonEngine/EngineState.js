import { toTimestamp } from './utils/timeUtils.js';

export class EngineState {
  constructor(reservations, staff, menus, initialState = null) {
    if (initialState) {
      // Clone from existing state
      this.reservations = initialState.reservations;
      this.staff = initialState.staff;
      this.menus = initialState.menus;
      
      // Deep copy dynamic state
      this.assignments = JSON.parse(JSON.stringify(initialState.assignments));
      this.unassignedSlots = JSON.parse(JSON.stringify(initialState.unassignedSlots));
      this.alerts = JSON.parse(JSON.stringify(initialState.alerts));
      this.slots = JSON.parse(JSON.stringify(initialState.slots || []));
      this.activities = JSON.parse(JSON.stringify(initialState.activities || []));
      
      // Keep other necessary state properties here (e.g. requiredSlots, manncells)
      this.requiredSlots = JSON.parse(JSON.stringify(initialState.requiredSlots));
      this.manncells = JSON.parse(JSON.stringify(initialState.manncells));
      this.manncellTicks = initialState.manncellTicks ? JSON.parse(JSON.stringify(initialState.manncellTicks)) : [];
      this.freeTimeActivities = JSON.parse(JSON.stringify(initialState.freeTimeActivities));
      this.stylistSummons = JSON.parse(JSON.stringify(initialState.stylistSummons));
      
      this.workloads = JSON.parse(JSON.stringify(initialState.workloads || {}));
      this.timeSlots = JSON.parse(JSON.stringify(initialState.timeSlots || {}));
      this.master = { 
        reservations: this.reservations,
        staff: this.staff,
        menus: this.menus,
        staffMap: initialState.master ? initialState.master.staffMap : {}
      };
      this.tracker = initialState.tracker 
        ? JSON.parse(JSON.stringify(initialState.tracker))
        : {};
      this.freezeBoundary = initialState.freezeBoundary ?? null;
    } else {
      // Initialize new state (Shallow copy to prevent crash from circular references)
      this.reservations = [...(reservations || [])];
      this.staff = [...(staff || [])];
      this.menus = [...(menus || [])];
      
      this.assignments = {}; // { reservationId: { slotIndex: staffId } }
      this.unassignedSlots = []; // Array of slots that need staff
      this.alerts = []; // Array of alert objects
      this.slots = []; // Array of required slots generated in Phase 1
      this.activities = []; // Array of free time activities (practice, cleaning, etc.)
      
      this.requiredSlots = [];
      this.manncells = [];
      this.manncellTicks = [];
      this.freeTimeActivities = [];
      this.stylistSummons = [];
      
      this.workloads = {};
      this.staff.forEach(s => {
        this.workloads[s.id] = 0;
      });
      this.timeSlots = {};
      
      this.master = { 
        reservations: this.reservations,
        staff: this.staff,
        menus: this.menus,
        staffMap: {}
      };
      this.staff.forEach(s => {
        this.master.staffMap[s.id] = s;
      });

      this.tracker = {};
      this.staff.forEach(s => {
        this.tracker[s.id] = {
          totalAssignedSlots: 0,
          hasLunch: false,
          hasBreak: false
        };
      });
      this.freezeBoundary = null;
    }
  }

  /**
   * Returns a deep clone of the current state.
   * Useful for pipeline steps to avoid mutating previous states directly.
   * @returns {EngineState} A new EngineState instance
   */
  clone() {
    return new EngineState(null, null, null, this);
  }

  /**
   * Helper to safely assign an assistant to a slot
   * @param {string} slotId 
   * @param {string} assistantId 
   * @returns {EngineState} A new EngineState instance with the assignment added
   */
  assignAssistant(slotId, assistantId) {
    const nextState = this.clone();
    
    // スロットオブジェクトを探す
    const slot = nextState.slots.find(s => s.id === slotId);
    if (!slot) return nextState;

    // ステータス更新
    slot.status = 'assigned';

    // スタイリストがアサインされた場合（ヘルプ召喚）は stylistSummons に記録
    const staffObj = nextState.staff.find(s => s.id === assistantId);
    if (staffObj && staffObj.type === 'stylist') {
      nextState.stylistSummons.push({
        stylistId: assistantId,
        reservationId: slot.reservationId,
        slotIndex: slot.slotIndex,
        startTime: slot.startTime,
        endTime: slot.endTime,
        badge: true,
        isSpecialSummon: false // 通常のヘルプ召喚は特殊召喚にはしない
      });
    }

    // 稼働時間の加算
    if (nextState.workloads[assistantId] !== undefined) {
      const durationMs = toTimestamp(slot.endTime) - toTimestamp(slot.startTime);
      const durationMinutes = Math.round(durationMs / 60000);
      nextState.workloads[assistantId] += durationMinutes;
    }

    // アサインメントデータ更新
    if (!nextState.assignments[slot.reservationId]) {
      nextState.assignments[slot.reservationId] = {};
    }
    nextState.assignments[slot.reservationId][slot.slotIndex] = assistantId;

    return nextState;
  }

  /**
   * Helper to safely remove an assignment from a slot (e.g. for re-assigning)
   * @param {string} slotId 
   * @returns {EngineState} A new EngineState instance with the assignment removed
   */
  removeAssignment(slotId) {
    const nextState = this.clone();
    
    const slot = nextState.slots.find(s => s.id === slotId);
    if (!slot) return nextState;

    if (slot.status === 'assigned') {
      const assistantId = nextState.assignments[slot.reservationId]?.[slot.slotIndex];
      
      // 稼働時間の減算（アサイン解除）
      if (assistantId && nextState.workloads[assistantId] !== undefined) {
        const durationMs = toTimestamp(slot.endTime) - toTimestamp(slot.startTime);
        const durationMinutes = Math.round(durationMs / 60000);
        nextState.workloads[assistantId] = Math.max(0, nextState.workloads[assistantId] - durationMinutes);
      }

      // ステータスとアサインデータをクリア
      slot.status = 'unassigned';
      if (nextState.assignments[slot.reservationId]) {
        delete nextState.assignments[slot.reservationId][slot.slotIndex];
      }
    }

    return nextState;
  }

  /**
   * Helper to add a generated slot
   * @param {Object} slotData 
   * @returns {EngineState} A new EngineState instance with the slot added
   */
  addSlot(slotData) {
    const nextState = this.clone();
    nextState.slots.push(slotData);
    return nextState;
  }
  /**
   * Helper to add a free time activity
   * @param {Object} activityData 
   * @returns {EngineState} A new EngineState instance with the activity added
   */
  addActivity(activityData) {
    const nextState = this.clone();
    nextState.activities.push(activityData);
    return nextState;
  }
}
