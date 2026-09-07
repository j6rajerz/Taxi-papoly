/* =====================================================================
   gh-storage.js
   جایگزین بک‌اند PHP/MySQL با «ذخیره‌سازی روی گیت‌هاب» برای اپ تک‌کاربره.

   همه‌ی اطلاعات (مشتریان، کرایه‌ها، فاکتورها، رمز عبور) در یک فایل JSON
   به اسم db.json داخل یک ریپوی گیت‌هاب نگه‌داری می‌شود و از طریق
   GitHub Contents API خوانده/نوشته می‌شود.

   نکته‌ی امنیتی مهم: این ریپو (ریپوی داده) باید Private باشد، چون
   اطلاعات مشتریان (اسم، شماره تلفن، بدهی) داخلش ذخیره می‌شود.
   ریپوی داده می‌تواند از ریپوی سایت (که برای GitHub Pages پابلیک است)
   جدا باشد؛ توکن دسترسی به هر دو ریپو دسترسی دارد ولی فقط ریپوی داده
   حاوی اطلاعات حساس است.
   ===================================================================== */
(function (global) {
  'use strict';

  const CFG_KEYS = ['gh_owner', 'gh_repo', 'gh_branch', 'gh_token', 'gh_path'];

  function getConfig() {
    return {
      owner: localStorage.getItem('gh_owner') || '',
      repo: localStorage.getItem('gh_repo') || '',
      branch: localStorage.getItem('gh_branch') || 'main',
      token: localStorage.getItem('gh_token') || '',
      path: localStorage.getItem('gh_path') || 'data/db.json'
    };
  }

  function hasConfig() {
    const c = getConfig();
    return !!(c.owner && c.repo && c.token);
  }

  function saveConfig(cfg) {
    localStorage.setItem('gh_owner', cfg.owner.trim());
    localStorage.setItem('gh_repo', cfg.repo.trim());
    localStorage.setItem('gh_branch', (cfg.branch || 'main').trim());
    localStorage.setItem('gh_token', cfg.token.trim());
    localStorage.setItem('gh_path', (cfg.path || 'data/db.json').trim());
  }

  function clearConfig() {
    CFG_KEYS.forEach(k => localStorage.removeItem(k));
    dbCache = null;
    dbSha = null;
  }

  function ensureConfigOrRedirect() {
    if (!hasConfig()) {
      if (!/setup\.html$/.test(location.pathname)) {
        location.href = 'setup.html';
      }
      return false;
    }
    return true;
  }

  global.ghHasConfig = hasConfig;
  global.ghGetConfig = getConfig;
  global.ghSaveConfig = saveConfig;
  global.ghClearConfig = clearConfig;
  global.ghEnsureConfig = ensureConfigOrRedirect;

  // ---------------------------------------------------------------------
  // ابزارهای کمکی: base64 امن برای متن فارسی (UTF-8) و هش SHA-256
  // ---------------------------------------------------------------------
  function utf8ToB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function b64ToUtf8(b64) {
    const bin = atob((b64 || '').replace(/\n/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  global.ghSha256Hex = sha256Hex;

  // ---------------------------------------------------------------------
  // تماس مستقیم با GitHub Contents API
  // ---------------------------------------------------------------------
  function contentsUrl() {
    const c = getConfig();
    const encodedPath = c.path.split('/').map(encodeURIComponent).join('/');
    return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${encodedPath}`;
  }

  async function ghGetFile() {
    const c = getConfig();
    const res = await fetch(contentsUrl() + '?ref=' + encodeURIComponent(c.branch), {
      headers: {
        'Authorization': 'Bearer ' + c.token,
        'Accept': 'application/vnd.github+json'
      }
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`خطای گیت‌هاب (${res.status}): ${t || res.statusText}`);
    }
    const json = await res.json();
    return { sha: json.sha, content: b64ToUtf8(json.content) };
  }

  async function ghPutFile(contentStr, sha, message) {
    const c = getConfig();
    const body = {
      message: message || 'به‌روزرسانی داده‌ها',
      content: utf8ToB64(contentStr),
      branch: c.branch
    };
    if (sha) body.sha = sha;
    const res = await fetch(contentsUrl(), {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + c.token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`خطای گیت‌هاب (${res.status}): ${t || res.statusText}`);
    }
    return await res.json();
  }

  // ---------------------------------------------------------------------
  // مدل داده (جایگزین جدول‌های MySQL)
  // ---------------------------------------------------------------------
  function defaultDB() {
    return {
      settings: { password_hash: null },
      customers: [],
      rentals: [],
      invoice_logs: [],
      next_id: { customers: 1, rentals: 1, invoice_logs: 1 }
    };
  }

  let dbCache = null;
  let dbSha = null;
  let loadPromise = null;

  async function loadDB(force) {
    if (dbCache && !force) return dbCache;
    if (loadPromise && !force) return loadPromise;
    loadPromise = (async () => {
      const existing = await ghGetFile();
      if (!existing) {
        const fresh = defaultDB();
        fresh.settings.password_hash = await sha256Hex('1335');
        const putRes = await ghPutFile(JSON.stringify(fresh, null, 2), null, 'راه‌اندازی اولیه دیتابیس تاکسی پاپلی');
        dbCache = fresh;
        dbSha = putRes.content.sha;
      } else {
        dbCache = JSON.parse(existing.content);
        dbSha = existing.sha;
        if (!dbCache.next_id) dbCache.next_id = { customers: 1, rentals: 1, invoice_logs: 1 };
        if (!dbCache.settings) dbCache.settings = { password_hash: await sha256Hex('1335') };
      }
      return dbCache;
    })();
    try {
      return await loadPromise;
    } finally {
      loadPromise = null;
    }
  }

  async function saveDB(message) {
    // یک بار تلاش می‌کنیم؛ اگر sha قدیمی بود (تغییر هم‌زمان از جای دیگر) یک بار تازه می‌خوانیم و دوباره می‌نویسیم
    try {
      const res = await ghPutFile(JSON.stringify(dbCache, null, 2), dbSha, message);
      dbSha = res.content.sha;
    } catch (e) {
      const fresh = await ghGetFile();
      if (fresh) {
        // داده‌ی تازه را با نسخه‌ی محلی ادغام نمی‌کنیم (اپ تک‌کاربره است)، فقط sha را به‌روز کرده و دوباره می‌نویسیم
        dbSha = fresh.sha;
        const res2 = await ghPutFile(JSON.stringify(dbCache, null, 2), dbSha, message);
        dbSha = res2.content.sha;
      } else {
        throw e;
      }
    }
    return dbCache;
  }

  global.ghLoadDB = loadDB;
  global.ghSaveDB = saveDB;

  // ---------------------------------------------------------------------
  // شبیه‌ساز Response برای سازگاری با کد قبلی (res.ok / res.status / res.json())
  // ---------------------------------------------------------------------
  function resp(status, data) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => data
    };
  }

  function nextId(db, table) {
    if (!db.next_id) db.next_id = {};
    const id = db.next_id[table] || 1;
    db.next_id[table] = id + 1;
    return id;
  }

  function nowIso() { return new Date().toISOString(); }
  function todayStr() { return new Date().toISOString().split('T')[0]; }

  function computeDebt(db, customerId) {
    return db.rentals
      .filter(r => r.customer_id === customerId && Number(r.amount) > 0)
      .reduce((s, r) => s + Number(r.amount), 0);
  }

  function withDebt(db, c) {
    return Object.assign({}, c, { debt: computeDebt(db, c.id) });
  }

  const TYPE_LABELS = { monthly_start: 'شروع ماهانه', monthly_end: 'اتمام ماهانه', daily: 'روزانه' };

  // تعداد ماه‌های کامل بین شروع و امروز + یک ماه اضافه در صورت وجود روز باقیمانده
  // (معادل رفتار DateTime::diff در PHP که در rentals.php اصلی استفاده شده بود)
  function monthsSince(startDateStr, endDate) {
    const start = new Date(startDateStr + 'T00:00:00');
    let months = 0;
    let cursor = new Date(start);
    while (true) {
      const next = new Date(cursor);
      next.setMonth(next.getMonth() + 1);
      if (next <= endDate) { months++; cursor = next; } else break;
    }
    const remainderDays = Math.round((endDate - cursor) / (1000 * 60 * 60 * 24));
    if (remainderDays > 0) months++;
    if (months < 1) months = 1;
    return months;
  }

  // ---------------------------------------------------------------------
  // هندلرهای معادل هر فایل PHP قبلی
  // ---------------------------------------------------------------------
  async function handleAuth(input) {
    const db = await loadDB();
    const action = input.action;

    if (action === 'login') {
      const hash = await sha256Hex(String(input.password || ''));
      if (hash === db.settings.password_hash) {
        const token = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
        return resp(200, { success: true, token });
      }
      return resp(200, { success: false, error: 'رمز اشتباه' });
    }
    if (action === 'verify') {
      return resp(200, { valid: true });
    }
    if (action === 'change_password') {
      const oldHash = await sha256Hex(String(input.old_password || ''));
      if (oldHash === db.settings.password_hash) {
        db.settings.password_hash = await sha256Hex(String(input.new_password || ''));
        await saveDB('تغییر رمز عبور');
        return resp(200, { success: true, message: 'رمز عبور تغییر کرد' });
      }
      return resp(200, { success: false, error: 'رمز فعلی اشتباه است' });
    }
    return resp(400, { error: 'عملیات نامشخص' });
  }

  async function handleCustomers(method, pathId, params, input) {
    const db = await loadDB();

    if (method === 'GET') {
      let list;
      if (params.get('search') !== null) {
        const qRaw = params.get('search');
        const q = qRaw.toLowerCase();
        list = db.customers.filter(c => c.name.toLowerCase().includes(q) || c.phone.includes(qRaw));
      } else if (pathId) {
        list = db.customers.filter(c => String(c.id) === String(pathId));
      } else {
        list = db.customers.slice();
      }
      list = list.map(c => withDebt(db, c)).sort((a, b) => a.name.localeCompare(b.name, 'fa'));
      return resp(200, list);
    }

    if (method === 'POST') {
      if (!input.name || !input.phone) {
        return resp(400, { error: 'نام و شماره تلفن الزامی است' });
      }
      const c = {
        id: nextId(db, 'customers'),
        name: input.name,
        phone: input.phone,
        service_type: input.service_type || 'monthly',
        rate: Number(input.rate || 0),
        created_at: nowIso(),
        updated_at: nowIso()
      };
      db.customers.push(c);
      await saveDB('افزودن مشتری: ' + c.name);
      return resp(201, c);
    }

    if (method === 'PUT') {
      if (!pathId) return resp(400, { error: 'ID الزامی است' });
      const c = db.customers.find(x => String(x.id) === String(pathId));
      if (!c) return resp(404, { error: 'یافت نشد' });
      c.name = input.name;
      c.phone = input.phone;
      c.service_type = input.service_type;
      c.rate = Number(input.rate || 0);
      c.updated_at = nowIso();
      await saveDB('ویرایش مشتری: ' + c.name);
      return resp(200, { success: true });
    }

    if (method === 'DELETE') {
      if (!pathId) return resp(400, { error: 'ID الزامی است' });
      db.customers = db.customers.filter(x => String(x.id) !== String(pathId));
      await saveDB('حذف مشتری #' + pathId);
      return resp(200, { success: true });
    }

    return resp(405, { error: 'متد پشتیبانی نمی‌شود' });
  }

  async function handleRentals(method, params, input) {
    const db = await loadDB();

    if (method === 'POST') {
      const customerId = input.customer_id;
      if (!customerId) return resp(400, { error: 'مشتری انتخاب نشده' });
      const customer = db.customers.find(c => String(c.id) === String(customerId));
      if (!customer) return resp(404, { error: 'مشتری پیدا نشد' });
      const action = params.get('action') || '';

      if (action === 'start_monthly') {
        const open = db.rentals.find(r => String(r.customer_id) === String(customerId) && r.type === 'monthly_start' && !r.end_date);
        if (open) return resp(400, { error: 'دوره ماهانه قبلاً شروع شده' });
        const r = {
          id: nextId(db, 'rentals'), customer_id: customer.id, type: 'monthly_start',
          start_date: todayStr(), end_date: null, months: null, amount: 0, created_at: nowIso()
        };
        db.rentals.push(r);
        await saveDB('شروع دوره ماهانه: ' + customer.name);
        return resp(200, { success: true, message: 'شروع دوره ماهانه ثبت شد' });
      }

      if (action === 'end_monthly') {
        const opens = db.rentals
          .filter(r => String(r.customer_id) === String(customerId) && r.type === 'monthly_start' && !r.end_date)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const lastStart = opens[0];
        if (!lastStart) return resp(400, { error: 'دوره ماهانه‌ای شروع نشده' });

        const months = monthsSince(lastStart.start_date, new Date());
        const amount = months * Number(customer.rate);

        lastStart.end_date = todayStr();
        lastStart.months = months;
        lastStart.amount = amount;
        lastStart.type = 'monthly_end';

        await saveDB('اتمام دوره ماهانه: ' + customer.name);
        return resp(200, {
          success: true, months, amount, rate: customer.rate,
          message: `اتمام دوره: ${months} ماه - مبلغ: ${amount.toLocaleString('en-US')} تومان`
        });
      }

      if (action === 'daily') {
        const amount = Number(input.amount !== undefined && input.amount !== '' ? input.amount : customer.rate);
        const r = {
          id: nextId(db, 'rentals'), customer_id: customer.id, type: 'daily',
          start_date: todayStr(), end_date: todayStr(), amount, created_at: nowIso()
        };
        db.rentals.push(r);
        await saveDB('کرایه روزانه: ' + customer.name);
        return resp(200, { success: true, amount, message: 'کرایه روزانه ثبت شد' });
      }

      return resp(400, { error: 'عملیات نامشخص' });
    }

    if (method === 'GET') {
      const customerId = params.get('customer_id');

      // همه‌ی دوره‌های ماهانه‌ی «باز» (هنوز تمام نشده) روی همه‌ی مشتریان
      // برای استفاده در یادآور پایان ماه؛ برخلاف لیست عادی، محدود به ۱۰۰ تای آخر نمی‌شود
      if (params.get('open_monthly') !== null) {
        const openList = db.rentals
          .filter(r => r.type === 'monthly_start' && !r.end_date)
          .map(r => {
            const c = db.customers.find(cc => cc.id === r.customer_id) || {};
            return Object.assign({}, r, { name: c.name, phone: c.phone, rate: c.rate });
          });
        return resp(200, openList);
      }

      // پرتکرارترین مشتریان (بر اساس تعداد کرایه‌های ثبت‌شده) برای پیشنهاد سریع در ثبت کرایه
      if (params.get('frequent') !== null) {
        const counts = {};
        db.rentals.forEach(r => {
          counts[r.customer_id] = (counts[r.customer_id] || 0) + 1;
        });
        const limit = Number(params.get('limit')) || 6;
        const topIds = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, limit);
        const list = topIds
          .map(id => {
            const c = db.customers.find(cc => String(cc.id) === String(id));
            if (!c) return null;
            return Object.assign({}, withDebt(db, c), { rental_count: counts[id] });
          })
          .filter(Boolean);
        return resp(200, list);
      }

      let list = db.rentals.slice();
      if (customerId) list = list.filter(r => String(r.customer_id) === String(customerId));
      list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      if (!customerId) list = list.slice(0, 100);
      list = list.map(r => {
        const c = db.customers.find(cc => cc.id === r.customer_id) || {};
        return Object.assign({}, r, { name: c.name, phone: c.phone, type_label: TYPE_LABELS[r.type] || r.type });
      });
      return resp(200, list);
    }

    return resp(405, { error: 'متد پشتیبانی نمی‌شود' });
  }

  async function handlePayDebt(input) {
    const db = await loadDB();
    if (input.customer_id === undefined || input.amount === undefined) {
      return resp(200, { success: false, error: 'اطلاعات ناقص است' });
    }
    const customerId = input.customer_id;
    let remaining = Number(input.amount);

    const debts = db.rentals
      .filter(r => String(r.customer_id) === String(customerId) && Number(r.amount) > 0)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    for (const r of debts) {
      if (remaining <= 0) break;
      const debt = Number(r.amount);
      if (remaining >= debt) { r.amount = 0; remaining -= debt; }
      else { r.amount = debt - remaining; remaining = 0; }
    }

    await saveDB('پرداخت بدهی مشتری #' + customerId);
    return resp(200, { success: true });
  }

  async function handleInvoice(method, params, input) {
    const db = await loadDB();

    if (method === 'GET' && params.get('customer_id')) {
      const id = params.get('customer_id');
      const customer = db.customers.find(c => String(c.id) === String(id));
      if (!customer) return resp(404, { error: 'مشتری پیدا نشد' });

      const rentals = db.rentals
        .filter(r => String(r.customer_id) === String(id) && Number(r.amount) > 0)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const total = rentals.reduce((s, r) => s + Number(r.amount), 0);

      const logs = db.invoice_logs
        .filter(l => String(l.customer_id) === String(id))
        .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));

      return resp(200, { customer, total, rentals, last_invoice: logs[0] ? logs[0].sent_at : null });
    }

    if (method === 'POST') {
      if (input.customer_id === undefined || input.amount === undefined) {
        return resp(400, { success: false, message: 'customer_id یا amount ارسال نشده است' });
      }
      db.invoice_logs.push({
        id: nextId(db, 'invoice_logs'),
        customer_id: input.customer_id,
        amount: Number(input.amount),
        sent_at: nowIso()
      });
      await saveDB('ثبت فاکتور مشتری #' + input.customer_id);
      return resp(200, { success: true, message: 'فاکتور در سیستم ثبت شد' });
    }

    return resp(405, { success: false, message: 'Method not allowed' });
  }

  async function handleReport(method, params) {
    const db = await loadDB();

    if (method === 'GET') {
      const customerId = params.get('customer_id');
      const fromDate = params.get('from_date') || (todayStr().slice(0, 8) + '01');
      const toDate = params.get('to_date') || todayStr();
      const type = params.get('type');

      const from = new Date(fromDate + 'T00:00:00');
      const to = new Date(toDate + 'T23:59:59');

      let list = db.rentals.filter(r => {
        const created = new Date(r.created_at);
        if (created < from || created > to) return false;
        if (customerId && String(r.customer_id) !== String(customerId)) return false;
        if (type && r.type !== type) return false;
        return true;
      });
      list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      list = list.map(r => {
        const c = db.customers.find(cc => cc.id === r.customer_id) || {};
        return Object.assign({}, r, {
          name: c.name, phone: c.phone, service_type: c.service_type, rate: c.rate,
          type_label: TYPE_LABELS[r.type] || r.type
        });
      });

      const total = list.reduce((s, r) => s + Number(r.amount || 0), 0);
      return resp(200, { data: list, total, count: list.length, from_date: fromDate, to_date: toDate });
    }

    if (method === 'DELETE' && params.get('reset') !== null) {
      db.invoice_logs = [];
      db.rentals = [];
      db.next_id.rentals = 1;
      db.next_id.invoice_logs = 1;
      await saveDB('ریست سیستم (پاک‌سازی کرایه‌ها و فاکتورها)');
      return resp(200, { success: true });
    }

    return resp(405, { error: 'متد پشتیبانی نمی‌شود' });
  }

  // ---------------------------------------------------------------------
  // apiFetch: جایگزین کامل fetch قبلی به سمت api/*.php
  // همان امضا و شکل پاسخ (res.ok / res.status / await res.json()) حفظ شده
  // ---------------------------------------------------------------------
  async function apiFetch(url, options) {
    options = options || {};
    if (!ensureConfigOrRedirect()) {
      throw new Error('اتصال به گیت‌هاب پیکربندی نشده است');
    }

    const qIndex = url.indexOf('?');
    const pathPart = qIndex >= 0 ? url.slice(0, qIndex) : url;
    const params = new URLSearchParams(qIndex >= 0 ? url.slice(qIndex + 1) : '');
    const method = (options.method || 'GET').toUpperCase();

    let input = {};
    if (options.body) {
      try { input = JSON.parse(options.body); } catch (e) { input = {}; }
    }

    try {
      if (pathPart.indexOf('auth.php') !== -1) {
        return await handleAuth(input);
      }
      const custMatch = pathPart.match(/customers\.php(?:\/(\d+))?$/);
      if (custMatch) {
        return await handleCustomers(method, custMatch[1], params, input);
      }
      if (pathPart.indexOf('rentals.php') !== -1) {
        return await handleRentals(method, params, input);
      }
      if (pathPart.indexOf('pay_debt.php') !== -1) {
        return await handlePayDebt(input);
      }
      if (pathPart.indexOf('invoice.php') !== -1) {
        return await handleInvoice(method, params, input);
      }
      if (pathPart.indexOf('report.php') !== -1) {
        return await handleReport(method, params);
      }
      return resp(404, { error: 'مسیر یافت نشد' });
    } catch (e) {
      console.error('gh-storage error:', e);
      return resp(500, { error: 'خطا در ارتباط با گیت‌هاب: ' + e.message });
    }
  }

  global.apiFetch = apiFetch;
  global.API = 'api';
})(window);
