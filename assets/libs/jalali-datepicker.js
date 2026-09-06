/**
 * Jalali Date Picker - Simple Solar Hijri Calendar
 * @version 1.0
 * @author Custom
 */

(function() {
    'use strict';

    // Solar Hijri calendar constants
    const JALALI_MONTHS = [
        'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
        'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
    ];

    const JALALI_DAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

    // Convert Gregorian to Jalali
    function gregorianToJalali(gy, gm, gd) {
        const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
        let gy2 = (gm > 2) ? (gy + 1) : gy;
        let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + g_d_m[gm - 1];
        let jy = -1595 + (33 * Math.floor(days / 12053));
        days %= 12053;
        jy += 4 * Math.floor(days / 1461);
        days %= 1461;
        if (days > 365) {
            jy += Math.floor((days - 1) / 365);
            days = (days - 1) % 365;
        }
        let jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
        let jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
        return { y: jy, m: jm, d: jd };
    }

    // Convert Jalali to Gregorian
    function jalaliToGregorian(jy, jm, jd) {
        jy += 1595;
        let days = -355668 + (365 * jy) + (Math.floor(jy / 33) * 8) + Math.floor((Math.floor(jy % 33) + 3) / 4) + jd + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
        let gy = 400 * Math.floor(days / 146097);
        days %= 146097;
        if (days > 36524) {
            gy += 100 * Math.floor(--days / 36524);
            days %= 36524;
            if (days >= 365) days++;
        }
        gy += 4 * Math.floor(days / 1461);
        days %= 1461;
        if (days > 365) {
            gy += Math.floor((days - 1) / 365);
            days = (days - 1) % 365;
        }
        let gd = days + 1;
        const sal_a = [0, 31, ((gy % 4 == 0 && gy % 100 != 0) || (gy % 400 == 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        let gm = 0;
        while (gm < 13 && gd > sal_a[gm]) gd -= sal_a[gm++];
        return { y: gy, m: gm, d: gd };
    }

    // Format date to Jalali string
    function formatJalaliDate(y, m, d) {
        return `${y}/${m.toString().padStart(2, '0')}/${d.toString().padStart(2, '0')}`;
    }

    // Parse Jalali date string
    function parseJalaliDate(str) {
        const parts = str.split('/');
        if (parts.length === 3) {
            return { y: parseInt(parts[0]), m: parseInt(parts[1]), d: parseInt(parts[2]) };
        }
        return null;
    }

    // Get days in month
    function getDaysInMonth(y, m) {
        if (m <= 6) return 31;
        if (m <= 11) return 30;
        return ((y + 12) % 33) % 4 === 1 ? 30 : 29;
    }

    // Get day of week (0=Saturday, 6=Friday)
    function getDayOfWeek(y, m, d) {
        const g = jalaliToGregorian(y, m, d);
        const date = new Date(g.y, g.m - 1, g.d);
        return date.getDay(); // 0=Sunday, 6=Saturday
    }

    // JalaliDatePicker class
    class JalaliDatePicker {
        constructor(inputId, options = {}) {
            this.input = document.getElementById(inputId);
            this.options = {
                onSelect: options.onSelect || null,
                onChange: options.onChange || null,
                ...options
            };
            this.picker = null;
            this.currentYear = null;
            this.currentMonth = null;
            this.selectedDate = null;
            
            // رفع باگ: ذخیره تقویم در شیء گلوبال تا مرورگر بتواند توابع کلیک را پیدا کند
            window.jalaliPickers[inputId] = this;
            
            this.init();
        }

        init() {
            this.picker = document.createElement('div');
            this.picker.className = 'jalali-datepicker';
            this.picker.style.cssText = `
                display: none;
                position: absolute;
                background: white;
                border: 1px solid #ddd;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.15);
                z-index: 1000;
                padding: 15px;
                font-family: 'Vazirmatn', sans-serif;
                direction: rtl;
            `;

            document.body.appendChild(this.picker);

            if (this.input.value) {
                const parsed = parseJalaliDate(this.input.value);
                if (parsed) {
                    this.selectedDate = { ...parsed };
                    this.currentYear = parsed.y;
                    this.currentMonth = parsed.m;
                }
            }

            this.input.addEventListener('focus', () => this.show());
            this.input.addEventListener('blur', () => {
                setTimeout(() => this.hide(), 200);
            });

            document.addEventListener('click', (e) => {
                if (e.target !== this.input && !this.picker.contains(e.target)) {
                    this.hide();
                }
            });

            this.input.addEventListener('change', () => this.handleInputChange());
        }

        handleInputChange() {
            const parsed = parseJalaliDate(this.input.value);
            if (parsed) {
                this.selectedDate = { ...parsed };
                this.currentYear = parsed.y;
                this.currentMonth = parsed.m;
                if (this.options.onSelect) {
                    this.options.onSelect(parsed);
                }
            }
        }

        show() {
            const rect = this.input.getBoundingClientRect();
            this.picker.style.top = (rect.bottom + window.scrollY + 5) + 'px';
            this.picker.style.left = rect.left + 'px';
            this.picker.style.width = rect.width + 'px';
            this.picker.style.display = 'block';
            this.render();
        }

        hide() {
            this.picker.style.display = 'none';
        }

        render() {
            if (!this.currentYear) {
                const now = gregorianToJalali(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
                this.currentYear = now.y;
                this.currentMonth = now.m;
            }

            const daysInMonth = getDaysInMonth(this.currentYear, this.currentMonth);
            const firstDay = getDayOfWeek(this.currentYear, this.currentMonth, 1);
            const adjustedFirstDay = firstDay === 0 ? 6 : firstDay - 1;

            let html = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <button type="button" onmousedown="event.preventDefault(); jalaliPickers['${this.input.id}'].changeMonth(-1)" 
                        style="background:#1a73e8;color:white;border:none;padding:8px 12px;border-radius:4px;cursor:pointer;">
                        ←
                    </button>
                    <strong>${this.currentYear} / ${JALALI_MONTHS[this.currentMonth - 1]}</strong>
                    <button type="button" onmousedown="event.preventDefault(); jalaliPickers['${this.input.id}'].changeMonth(1)" 
                        style="background:#1a73e8;color:white;border:none;padding:8px 12px;border-radius:4px;cursor:pointer;">
                        →
                    </button>
                </div>
                <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:4px; text-align:center;">
            `;

            JALALI_DAYS.forEach(day => {
                html += `<div style="font-weight:bold;color:#666;font-size:0.8rem;padding:4px;">${day}</div>`;
            });

            for (let i = 0; i < adjustedFirstDay; i++) {
                html += `<div></div>`;
            }

            for (let d = 1; d <= daysInMonth; d++) {
                const isSelected = this.selectedDate && 
                                   this.selectedDate.y === this.currentYear && 
                                   this.selectedDate.m === this.currentMonth && 
                                   this.selectedDate.d === d;
                const isToday = this.isToday(this.currentYear, this.currentMonth, d);
                
                // استفاده از onmousedown بجای onclick برای جلوگیری از تداخل با blur
                html += `<div onmousedown="event.preventDefault(); jalaliPickers['${this.input.id}'].selectDate(${d})" 
                    style="padding:8px;cursor:pointer;border-radius:4px;${
                        isSelected ? 'background:#1a73e8;color:white;' : 
                        isToday ? 'background:#e8f0fe;color:#1a73e8;' : 'background:#f5f5f5;'
                    }" 
                    ${isToday ? 'style="font-weight:bold;' + (isSelected ? 'color:white;' : 'color:#1a73e8;') : ''}">
                    ${d}
                </div>`;
            }

            html += `</div>`;
            this.picker.innerHTML = html;
        }

        isToday(y, m, d) {
            const now = gregorianToJalali(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
            return now.y === y && now.m === m && now.d === d;
        }

        changeMonth(delta) {
            this.currentMonth += delta;
            if (this.currentMonth > 12) {
                this.currentMonth = 1;
                this.currentYear++;
            } else if (this.currentMonth < 1) {
                this.currentMonth = 12;
                this.currentYear--;
            }
            this.render();
        }

        selectDate(day) {
            this.selectedDate = { y: this.currentYear, m: this.currentMonth, d: day };
            const formatted = formatJalaliDate(this.currentYear, this.currentMonth, day);
            this.input.value = formatted;
            
            const gregorian = jalaliToGregorian(this.currentYear, this.currentMonth, day);
            const gregorianFormatted = `${gregorian.y}-${gregorian.m.toString().padStart(2, '0')}-${gregorian.d.toString().padStart(2, '0')}`;
            
            this.input.dataset.gregorian = gregorianFormatted;
            
            if (this.options.onSelect) {
                this.options.onSelect(this.selectedDate);
            }
            this.hide();
        }
    }

    // Store all pickers for access
    window.jalaliPickers = window.jalaliPickers || {};

    // Initialize
    window.JalaliDatePicker = JalaliDatePicker;
})();
