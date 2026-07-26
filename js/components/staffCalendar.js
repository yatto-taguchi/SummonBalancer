/**
 * staffCalendar.js — スタッフ出勤・休日カレンダー
 */

export class StaffCalendar {
  /**
   * @param {HTMLElement} container - カレンダーを描画するコンテナ
   * @param {import('../models/staff.js').Staff} staff - スタッフデータ
   */
  constructor(container, staff) {
    this.container = container;
    this.staff = staff;
    
    // 現在の表示月
    const now = new Date();
    this.currentYear = now.getFullYear();
    this.currentMonth = now.getMonth(); // 0-11
    
    // 休日と出勤日のSet
    this.holidays = new Set(staff.holidays || []);
    this.workdays = new Set(staff.workdays || []);
  }

  /**
   * YYYY-MM-DD形式の文字列を返す
   * @param {number} year 
   * @param {number} month 
   * @param {number} date 
   */
  formatDate(year, month, date) {
    const y = String(year);
    const m = String(month + 1).padStart(2, '0');
    const d = String(date).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  render() {
    this.container.innerHTML = `
      <style>
        .staff-calendar {
          margin-top: 16px;
          border: 1px solid var(--border-glass);
          border-radius: var(--radius-md);
          background: var(--bg-tertiary);
          overflow: hidden;
        }
        .staff-calendar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: rgba(0, 0, 0, 0.2);
          border-bottom: 1px solid var(--border-glass);
        }
        .staff-calendar-header button {
          padding: 4px 12px;
          border-radius: var(--radius-sm);
          background: var(--bg-primary);
          color: var(--text-primary);
          font-size: 12px;
        }
        .staff-calendar-header button:hover {
          background: var(--bg-secondary);
        }
        .staff-calendar-title {
          font-size: 14px;
          font-weight: bold;
        }
        .staff-calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          text-align: center;
        }
        .staff-calendar-day-header {
          font-size: 11px;
          padding: 6px 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          color: var(--text-muted);
        }
        .staff-calendar-cell {
          padding: 8px 0;
          font-size: 13px;
          cursor: pointer;
          border-right: 1px solid rgba(255, 255, 255, 0.02);
          border-bottom: 1px solid rgba(255, 255, 255, 0.02);
          position: relative;
          transition: background 0.2s;
        }
        .staff-calendar-cell:hover {
          background: rgba(255, 255, 255, 0.05);
        }
        .staff-calendar-cell.off {
          color: #ef4444; /* 赤 */
          background: rgba(239, 68, 68, 0.1);
        }
        .staff-calendar-cell.off::after {
          content: '休';
          position: absolute;
          bottom: 2px;
          right: 4px;
          font-size: 9px;
          opacity: 0.8;
        }
        .staff-calendar-cell.work {
          color: #10b981; /* 緑 */
        }
        .staff-calendar-cell.other-month {
          color: rgba(255, 255, 255, 0.2) !important;
          background: transparent !important;
          cursor: default;
        }
      </style>
      <div class="staff-calendar">
        <div class="staff-calendar-header">
          <button class="cal-prev">◀ 前月</button>
          <div class="staff-calendar-title">${this.currentYear}年 ${this.currentMonth + 1}月</div>
          <button class="cal-next">次月 ▶</button>
        </div>
        <div class="staff-calendar-grid">
          <div class="staff-calendar-day-header">日</div>
          <div class="staff-calendar-day-header">月</div>
          <div class="staff-calendar-day-header">火</div>
          <div class="staff-calendar-day-header">水</div>
          <div class="staff-calendar-day-header">木</div>
          <div class="staff-calendar-day-header">金</div>
          <div class="staff-calendar-day-header">土</div>
          <!-- Days will be injected here -->
        </div>
      </div>
    `;

    this.renderDays();

    // Events
    this.container.querySelector('.cal-prev').addEventListener('click', (e) => {
      e.preventDefault();
      this.currentMonth--;
      if (this.currentMonth < 0) {
        this.currentMonth = 11;
        this.currentYear--;
      }
      this.render();
    });

    this.container.querySelector('.cal-next').addEventListener('click', (e) => {
      e.preventDefault();
      this.currentMonth++;
      if (this.currentMonth > 11) {
        this.currentMonth = 0;
        this.currentYear++;
      }
      this.render();
    });
  }

  renderDays() {
    const grid = this.container.querySelector('.staff-calendar-grid');
    const oldCells = grid.querySelectorAll('.staff-calendar-cell');
    oldCells.forEach(c => c.remove());

    const firstDay = new Date(this.currentYear, this.currentMonth, 1).getDay();
    const daysInMonth = new Date(this.currentYear, this.currentMonth + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
      const cell = document.createElement('div');
      cell.className = 'staff-calendar-cell other-month';
      grid.appendChild(cell);
    }

    for (let date = 1; date <= daysInMonth; date++) {
      const cell = document.createElement('div');
      cell.className = 'staff-calendar-cell';
      cell.textContent = date;

      const dateStr = this.formatDate(this.currentYear, this.currentMonth, date);
      const isMonday = new Date(this.currentYear, this.currentMonth, date).getDay() === 1;

      let isOff = false;
      if (this.holidays.has(dateStr)) {
        isOff = true;
      } else if (isMonday && !this.workdays.has(dateStr)) {
        isOff = true;
      }

      if (isOff) {
        cell.classList.add('off');
      } else {
        cell.classList.add('work');
      }

      cell.addEventListener('click', () => {
        if (isMonday) {
          if (this.workdays.has(dateStr)) {
            this.workdays.delete(dateStr);
          } else {
            this.workdays.add(dateStr);
            this.holidays.delete(dateStr);
          }
        } else {
          if (this.holidays.has(dateStr)) {
            this.holidays.delete(dateStr);
          } else {
            this.holidays.add(dateStr);
            this.workdays.delete(dateStr);
          }
        }
        
        this.staff.holidays = Array.from(this.holidays);
        this.staff.workdays = Array.from(this.workdays);
        
        this.renderDays();
      });

      grid.appendChild(cell);
    }
  }
}
