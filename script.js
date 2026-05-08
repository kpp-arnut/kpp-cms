let googleAccessToken = null;
let isAdmin = false;
let currentUser = null;
let students = [];
let assignments = [];
let gradingRows = [];
let attendanceRows = [];
let adminInitialized = false; // FIX #3: guard against double-init

let html5QrCode = null, scanning = false, lastScannedText = '', lastScannedAt = 0;
let attendanceQr = null, attendanceScanning = false, lastAttendanceScan = '', lastAttendanceScanAt = 0;
let scorePieChart = null;

// ─── UI HELPERS ────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function showToast(msg, type = 'info') {
  const icons = { success:'✅', error:'❌', info:'ℹ️', warn:'⚠️' };
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  $('toasts').appendChild(el);
  // FIX #10: fade out before remove
  setTimeout(() => { el.style.transition = 'opacity 0.4s'; el.style.opacity = '0'; }, 3400);
  setTimeout(() => el.remove(), 3800);
}

function openModal(id)  { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el && el.id !== 'm-login') closeModal(el.id); });
});

function setSyncProgress(pct, msg) {
  const overlay = $('sync-overlay');
  if (pct <= 0) { overlay.classList.remove('open'); return; }
  overlay.classList.add('open');
  $('sync-progress-text').textContent = msg || 'กำลังซิงค์...';
  $('sync-progress-bar').style.width = pct + '%';
}

// ─── NAVIGATION ────────────────────────────────────────────
function showPage(name) {
  stopQrScanner();
  stopAttendanceScanner();
  if (name === 'admin' && !isAdmin) { openModal('m-login'); return; }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  $('page-' + name).classList.add('active');
  $('nav-' + name).classList.add('active');
  if (name === 'admin' && isAdmin) initAdmin();
}

// ─── LOGIN / LOGOUT ────────────────────────────────────────
async function doLogin() {
  const email = $('l-user').value.trim();
  const pass  = $('l-pass').value;
  const btn   = $('login-btn');
  $('l-err').style.display = 'none';
  btn.disabled = true; btn.textContent = 'กำลังยืนยันตัวตน...';
  try {
    const { data, error } = await _sb.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    isAdmin = true; currentUser = data.user;
    adminInitialized = false; // FIX #3: allow fresh init after login
    closeModal('m-login');
    showToast('เข้าสู่ระบบสำเร็จ!', 'success');
    showPage('admin');
  } catch (e) {
    $('l-err').textContent = '❌ ' + (e.message === 'Invalid login credentials' ? 'อีเมลหรือรหัสผ่านผิด' : e.message);
    $('l-err').style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
  }
}

async function doLogout() {
  if (!confirm('คุณต้องการออกจากระบบใช่หรือไม่?')) return;
  await _sb.auth.signOut();
  isAdmin = false; currentUser = null; adminInitialized = false;
  $('nav-logout').style.display = 'none';
  $('cfg-dot').className = 'cfg-dot';
  showPage('status');
  location.reload();
}

// ─── SUPABASE HELPERS ──────────────────────────────────────
const gasCall = async (fnName, ...args) => {
  if (fnName === 'getStudents') {
    const { data, error } = await _sb.from('students').select('*').order('classroom').order('seat_no');
    if (error) throw error; return data || [];
  }
  if (fnName === 'getStudentById') {
    const { data } = await _sb.from('students').select('*').eq('id', args[0]).maybeSingle(); return data;
  }
  if (fnName === 'upsertStudent') {
    const { data, error } = await _sb.from('students').upsert(args[0], { onConflict: 'id' }).select();
    if (error) throw error; return data;
  }
  if (fnName === 'upsertStudents') {
    const { data, error } = await _sb.from('students').upsert(args[0], { onConflict: 'id' }).select();
    if (error) throw error; return data;
  }
  if (fnName === 'deleteStudent') {
    const { error } = await _sb.from('students').delete().eq('id', args[0]);
    if (error) throw error; return true;
  }
  if (fnName === 'updateBehaviorScore') {
    let s = Math.min(15, Math.max(0, args[1]));
    const { data, error } = await _sb.from('students').update({ behavior_score: s }).eq('id', args[0]).select();
    if (error) throw error; return data;
  }
  if (fnName === 'getAllAssignments') {
    const { data, error } = await _sb.from('assignments').select('*').order('created_at', { ascending: false });
    if (error) throw error; return data || [];
  }
  if (fnName === 'getAssignmentById') {
    const { data } = await _sb.from('assignments').select('*').eq('id', args[0]).maybeSingle(); return data;
  }
  if (fnName === 'createAssignment') {
    const d = args[0];
    const payload = { name: d.name, subject: d.subject, classroom: d.classroom,
      category: d.category || 'ก่อนกลางภาค', passing_score: d.passing_score || 0,
      max_score: d.max_score, type: d.type || 'เดี่ยว' };
    const { data: newA, error } = await _sb.from('assignments').insert(payload).select().single();
    if (error) throw error;
    const { data: stList } = await _sb.from('students').select('id').eq('classroom', d.classroom);
    if (stList?.length) {
      const grPay = stList.map(s => ({ student_id: s.id, assignment_id: newA.id, score: null, max_score: d.max_score, status: 'not_sent' }));
      await _sb.from('grades').upsert(grPay, { onConflict: 'student_id,assignment_id' });
    }
    return newA;
  }
  if (fnName === 'deleteAssignment') {
    const { error } = await _sb.from('assignments').delete().eq('id', args[0]);
    if (error) throw error; return true;
  }
  if (fnName === 'getGradesByStudent') {
    const { data, error } = await _sb.from('grades').select('*, assignments(*)').eq('student_id', args[0]);
    if (error) throw error; return data || [];
  }
  if (fnName === 'getGradesByAssignment') {
    const { data, error } = await _sb.from('grades').select('*').eq('assignment_id', args[0]);
    if (error) throw error; return data || [];
  }
  if (fnName === 'saveGrades') {
    const now = new Date().toISOString();
    const payload = args[0].map(r => ({
      student_id: r.student_id, assignment_id: r.assignment_id,
      score: r.score, max_score: r.max_score, status: r.status, updated_at: now
    }));
    const { data, error } = await _sb.from('grades').upsert(payload, { onConflict: 'student_id,assignment_id' }).select();
    if (error) throw error; return data;
  }
  if (fnName === 'getGradesByRoom') {
    const [classroom, subject] = args;
    const { data: asgns } = await _sb.from('assignments').select('*').eq('classroom', classroom).eq('subject', subject).order('created_at');
    const { data: sts }   = await _sb.from('students').select('*').eq('classroom', classroom).order('seat_no');
    if (!asgns?.length || !sts?.length) return { students: sts || [], assignments: asgns || [], grades: [] };
    const aIds = asgns.map(a => a.id), sIds = sts.map(s => s.id);
    const { data: grs } = await _sb.from('grades').select('*').in('student_id', sIds).in('assignment_id', aIds);
    return { students: sts, assignments: asgns, grades: grs || [] };
  }
  if (fnName === 'getAttendanceByStudent') {
    const { data, error } = await _sb.from('attendance').select('*').eq('student_id', args[0]).order('attendance_date', { ascending: false });
    if (error) throw error; return data || [];
  }
  if (fnName === 'getAttendanceByDate') {
    const [classroom, date] = args;
    const { data: sts } = await _sb.from('students').select('id').eq('classroom', classroom);
    if (!sts?.length) return [];
    const sIds = sts.map(s => s.id);
    const { data } = await _sb.from('attendance').select('*').in('student_id', sIds).eq('attendance_date', date);
    return data || [];
  }
  if (fnName === 'saveAttendance') {
    const now = new Date().toISOString();
    const payload = args[0].map(r => ({
      student_id: r.student_id, attendance_date: r.attendance_date,
      subject: r.subject, status: r.status, remark: r.remark || '', hours: r.hours || 1, updated_at: now
    }));
    const { data, error } = await _sb.from('attendance').upsert(payload, { onConflict: 'student_id,attendance_date,subject' }).select();
    if (error) throw error; return data;
  }
  if (fnName === 'getAttendanceForRoom') {
    const { data: sts } = await _sb.from('students').select('id').eq('classroom', args[0]);
    if (!sts?.length) return [];
    const sIds = sts.map(s => s.id);
    const { data } = await _sb.from('attendance').select('*').in('student_id', sIds).order('attendance_date', { ascending: true });
    return data || [];
  }
  if (fnName === 'markStudentSubmitted') {
    const [studentId, assignmentId] = args;
    const student    = await gasCall('getStudentById', studentId);
    const assignment = await gasCall('getAssignmentById', assignmentId);
    if (!student || !assignment) throw new Error('ไม่พบข้อมูล');
    const saved = await gasCall('saveGrades', [{ student_id: studentId, assignment_id: assignmentId, score: assignment.max_score, max_score: assignment.max_score, status: 'checked' }]);
    return { success: true, student, assignment, saved };
  }
  if (fnName === 'markStudentAttendance') {
    // FIX #5: รับ subject และ hours ด้วย
    const [studentId, date, status, remark, subject, hours] = args;
    const student = await gasCall('getStudentById', studentId);
    if (!student) throw new Error('ไม่พบนักเรียน');
    const saved = await gasCall('saveAttendance', [{ student_id: studentId, attendance_date: date, subject: subject || '', status, remark: remark || '', hours: hours || 1 }]);
    return { success: true, student, attendance_date: date, status, saved };
  }
  throw new Error('Unknown function: ' + fnName);
};

// ─── ADMIN INIT ────────────────────────────────────────────
const TABS = ['grading','attendance','behavior','students','asgn','export'];

function adminTab(name) {
  stopQrScanner(); stopAttendanceScanner();
  TABS.forEach(t => {
    const tab = $('tab-' + t); if (tab) tab.style.display = t === name ? 'block' : 'none';
    const btn = $('t-' + t);   if (btn) btn.className = 'tab-btn' + (t === name ? ' active' : '');
  });
  if (name === 'behavior') renderBehaviorList();
}

async function initAdmin() {
  // FIX #3: ป้องกัน double-init
  if (adminInitialized) return;
  adminInitialized = true;

  $('nav-logout').style.display = 'flex';
  try {
    const [s, a] = await Promise.all([gasCall('getStudents'), gasCall('getAllAssignments')]);
    students = s; assignments = a;
    $('cfg-dot').className = 'cfg-dot ok';
  } catch (e) {
    showToast('โหลดข้อมูลล้มเหลว: ' + e, 'error');
    adminInitialized = false; // allow retry
    return;
  }
  populateDropdowns();
  if (!$('att-date').value) $('att-date').value = new Date().toISOString().slice(0, 10);
  renderStudentTable(); renderAsgnTable(); adminTab('grading');
}

// ─── DROPDOWNS ─────────────────────────────────────────────
function populateDropdowns() {
  const rooms = [...new Set(students.map(s => s.classroom))].sort();
  const subjs = [...new Set(assignments.map(a => a.subject))].sort();
  ['g-room','att-room','f-room','exp-room','exp-att-room'].forEach(id => {
    const el = $(id); if (!el) return;
    const cur = el.value;
    const ph  = id === 'f-room' ? '<option value="">ทุกห้อง</option>' : '<option value="">— เลือกห้อง —</option>';
    el.innerHTML = ph + rooms.map(r => `<option value="${r}">${r}</option>`).join('');
    el.value = cur;
  });
  ['g-subj','att-subj','exp-subj','exp-att-subj'].forEach(id => {
    const el = $(id); if (!el) return;
    const cur = el.value;
    el.innerHTML = '<option value="">— เลือกวิชา —</option>' + subjs.map(s => `<option value="${s}">${s}</option>`).join('');
    el.value = cur;
  });
  syncAssignSelect();
}

function syncAssignSelect() {
  const subj = $('g-subj').value, room = $('g-room').value, el = $('g-asgn');
  const cur  = el.value;
  el.innerHTML = '<option value="">— เลือกงาน —</option>';
  assignments.filter(a => (!subj || a.subject === subj) && (!room || a.classroom === room))
    .forEach(a => { el.innerHTML += `<option value="${a.id}">${a.name}</option>`; });
  el.value = cur;
}

// ─── STATUS PAGE ───────────────────────────────────────────
async function searchStatus() {
  const sid = $('st-id-inp').value.trim();
  if (!sid) { showToast('กรุณาใส่รหัสนักเรียน', 'error'); return; }

  $('st-results').style.display = 'none';
  $('st-att-card').style.display = 'none';
  $('st-empty').style.display = 'none';

  try {
    const [grades, attendance, stInfo] = await Promise.all([
      gasCall('getGradesByStudent', sid),
      gasCall('getAttendanceByStudent', sid),
      gasCall('getStudentById', sid)
    ]);

    if (!stInfo) { $('st-empty').style.display = 'block'; return; }

    const fullName = stInfo.first_name + ' ' + stInfo.last_name;
    $('st-name').textContent = fullName;
    $('st-meta').textContent = 'ชั้น ' + stInfo.classroom + ' เลขที่ ' + stInfo.seat_no + ' | รหัส: ' + sid;
    $('st-name-display').textContent = fullName;
    $('st-meta-display').textContent = 'ชั้น ' + stInfo.classroom + ' เลขที่ ' + stInfo.seat_no;

    const catStats = {
      'ก่อนกลางภาค': { current: 0, max: 0, weight: 20 },
      'กลางภาค':     { current: 0, max: 0, weight: 20 },
      'หลังกลางภาค': { current: 0, max: 0, weight: 20 },
      'ปลายภาค':     { current: 0, max: 0, weight: 30 }
    };

    // deduplicate by assignment_id (keep highest score)
    const uniqueMap = {};
    grades.forEach(g => {
      if (!g.assignments) return;
      const aid = g.assignment_id;
      const sc  = parseFloat(g.score || 0);
      if (!uniqueMap[aid] || sc > parseFloat(uniqueMap[aid].score || 0)) uniqueMap[aid] = g;
    });

    const sorted = Object.values(uniqueMap).sort((a, b) => {
      const sa = (a.assignments.subject||'').toLowerCase(), sb = (b.assignments.subject||'').toLowerCase();
      const na = (a.assignments.name||'').toLowerCase(),   nb = (b.assignments.name||'').toLowerCase();
      return sa.localeCompare(sb) || na.localeCompare(nb);
    });

    let countOk = 0, countWait = 0, countNo = 0;
    const tbody = $('st-tbody');
    tbody.innerHTML = '';
    let lastSubject = null;

    if (!sorted.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-dim);">ยังไม่มีรายการงานในขณะนี้</td></tr>';
    }

    sorted.forEach(g => {
      const a = g.assignments || {};
      const cat  = a.category || 'ก่อนกลางภาค';
      const type = a.type || 'ทั่วไป';
      const sc   = parseFloat(g.score || 0);
      const max  = parseFloat(a.max_score || 10);
      const pass = parseFloat(a.passing_score || 0);

      if (catStats[cat]) {
        catStats[cat].max += max;
        if (g.status === 'checked') catStats[cat].current += sc;
      }

      const subjectName = a.subject || 'วิชาทั่วไป';
      if (subjectName !== lastSubject) {
        // FIX: ใช้ textContent แทน innerHTML เพื่อป้องกัน XSS
        const tr = document.createElement('tr');
        tr.className = 'tr-subject-group';
        const td = document.createElement('td');
        td.colSpan = 5;
        td.textContent = '📚 ' + subjectName;
        tr.appendChild(td);
        tbody.appendChild(tr);
        lastSubject = subjectName;
      }

      let badge = '', rowClass = '';
      if (g.status === 'checked') {
        badge = (sc < pass && pass > 0)
          ? '<span class="badge badge-red">❌ ไม่ผ่าน</span>'
          : '<span class="badge badge-green">✅ ส่งแล้ว</span>';
        rowClass = (sc < pass && pass > 0) ? 'row-ขาด' : 'row-มา';
        countOk++;
      } else if (g.status === 'waiting') {
        badge = '<span class="badge badge-amber">⏳ รอตรวจ</span>'; rowClass = 'row-สาย'; countWait++;
      } else {
        badge = '<span class="badge badge-red">🚫 ยังไม่ส่ง</span>'; rowClass = 'row-not-sent'; countNo++;
      }

      const typeClass  = type.includes('สอบ') ? 'badge-amber' : 'badge-blue';
      const scoreHtml  = g.status === 'checked'
        ? `<span class="score-big" style="font-size:1.4rem">${g.score}</span><span class="score-sep"> / </span><span class="score-max">${max}</span>`
        : '<span class="text-muted">—</span>';

      // FIX: สร้าง row ด้วย DOM แทน innerHTML เพื่อป้องกัน XSS จาก a.name / a.description
      const tr = document.createElement('tr');
      tr.className = rowClass;

      const descHtml = a.description
        ? `<div style="font-size:0.75rem;color:var(--text-dim);margin-top:4px;line-height:1.4;">📝 ${escapeHtml(a.description)}</div>`
        : '';

      tr.innerHTML = `
        <td><small class="text-muted">${escapeHtml(cat)}</small></td>
        <td>
          <strong>${escapeHtml(a.name || '—')}</strong>
          ${descHtml}
        </td>
        <td style="text-align:center"><span class="badge ${typeClass}">${escapeHtml(type)}</span></td>
        <td style="text-align:center">${badge}</td>
        <td style="text-align:center">${scoreHtml}</td>`;
      tbody.appendChild(tr);
    });

    // weighted score
    let weightedTotal = 0;
    const chartPoints = [];
    ['ก่อนกลางภาค','กลางภาค','หลังกลางภาค','ปลายภาค'].forEach(lbl => {
      const s  = catStats[lbl];
      const pt = s.max > 0 ? (s.current / s.max) * s.weight : 0;
      weightedTotal += pt; chartPoints.push(pt.toFixed(2));
    });
    const behaviorScore = (stInfo.behavior_score !== null && stInfo.behavior_score !== undefined)
                          ? parseFloat(stInfo.behavior_score) : 10;
    chartPoints.push(behaviorScore.toFixed(2));
    const grandTotal = weightedTotal + behaviorScore;

    $('final-weighted-score').textContent = grandTotal.toFixed(1);
    $('final-weighted-score').style.color = grandTotal >= 50 ? '#fff' : 'var(--red)';
    $('cnt-all').textContent  = sorted.length;
    $('cnt-ok').textContent   = countOk;
    $('cnt-wait').textContent = countWait;
    $('cnt-no').textContent   = countNo;

    $('behavior-score-text').textContent = behaviorScore + '/15';
    const bhPct = (behaviorScore / 15) * 100;
    $('behavior-progress-fill').style.width = bhPct + '%';
    $('behavior-progress-fill').style.background = behaviorScore > 10 ? 'linear-gradient(90deg,var(--purple),#ec4899)' : 'var(--purple)';

    const subPct = sorted.length > 0 ? ((countOk + countWait) / sorted.length * 100) : 0;
    $('global-progress-fill').style.width = subPct + '%';
    $('global-progress-text').textContent = subPct.toFixed(0) + '%';

    updatePieChart(chartPoints);

    // attendance grid
    const attCard    = $('st-att-card');
    const attContent = $('st-att-content');
    attContent.innerHTML = '';
    if (attendance?.length) {
      const grouped = attendance.reduce((acc, cur) => {
        const subj = cur.subject || 'ไม่ระบุวิชา';
        if (!acc[subj]) acc[subj] = [];
        acc[subj].push(cur);
        return acc;
      }, {});
      for (const subj in grouped) renderAttendanceGrid(subj, grouped[subj], attContent);
      attCard.style.display = 'block';
    }

    $('st-results').style.display = 'block';
    showToast('ดึงข้อมูลสำเร็จ', 'success');

  } catch (e) {
    console.error(e);
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
}

// FIX #7: helper escape HTML
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function updatePieChart(dataPoints) {
  const ctx = $('scoreChart').getContext('2d');
  if (scorePieChart) scorePieChart.destroy();
  Chart.register(ChartDataLabels);
  scorePieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['ก่อนกลางภาค','กลางภาค','หลังกลางภาค','ปลายภาค','จิตพิสัย'],
      datasets: [{
        data: dataPoints,
        backgroundColor: ['#0ea5e9','#10b981','#f59e0b','#ef4444','#a855f7'],
        borderWidth: 2, borderColor: '#050e30', hoverOffset: 15
      }]
    },
    options: {
      cutout: '50%', layout: { padding: 10 },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true },
        datalabels: {
          color: '#ffffff',
          font: { family: 'Kanit', weight: 'bold', size: 14 },
          anchor: 'center', align: 'center',
          formatter: v => parseFloat(v) > 0 ? parseFloat(v).toFixed(1) : ''
        }
      },
      responsive: true, maintainAspectRatio: false
    }
  });
}

function renderAttendanceGrid(subjectName, attendanceData, container) {
  const wrapper = document.createElement('div');
  wrapper.className = 'mb-4';

  const uniqueDates = [...new Set(attendanceData.map(a => a.attendance_date))].sort();
  const attMap = {};
  let attendedHours = 0, totalHours = 0;

  attendanceData.forEach(a => {
    attMap[a.attendance_date] = a;
    const h = parseFloat(a.hours) || 1;
    totalHours += h;
    if (a.status === 'มา')       attendedHours += h;
    else if (a.status === 'ลา')  attendedHours += h * 0.25;
    else if (a.status === 'สาย') attendedHours += h * 0.5;
  });
  const pct = totalHours > 0 ? (attendedHours / totalHours) * 100 : 0;
  const pctColor = pct >= 80 ? '#22d3ee' : '#ef4444';

  let headHtml = '<tr><th class="att-side-label" style="position:sticky;left:0;z-index:30">รายการ \\ วันที่</th>';
  uniqueDates.forEach(date => {
    const d    = new Date(date);
    const h    = attMap[date].hours || 1;
    const disp = d.getDate() + '/' + (d.getMonth()+1) + '/' + (d.getFullYear()+543).toString().slice(-2);
    headHtml += `<th style="text-align:center;min-width:80px"><div style="font-size:13px">${disp}</div><div style="font-size:10px;font-weight:400;opacity:.9">(${h} ชม.)</div></th>`;
  });
  headHtml += '<th class="att-summary-col" style="text-align:center;min-width:80px">มา/รวม</th><th class="att-summary-col" style="text-align:center;min-width:70px">ร้อยละ</th></tr>';

  let bodyHtml = '<tr><td class="att-side-label" style="position:sticky;left:0;z-index:10;padding:15px">สถานะ</td>';
  uniqueDates.forEach(date => {
    const rec = attMap[date];
    let symbol = '-', cellBg = 'rgba(255,255,255,0.03)';
    if (rec) {
      if (rec.status === 'มา')       { symbol = '✅'; cellBg = 'rgba(16,185,129,0.2)'; }
      else if (rec.status === 'ขาด') { symbol = '❌'; cellBg = 'rgba(239,68,68,0.2)'; }
      else if (rec.status === 'ลา')  { symbol = '📝'; cellBg = 'rgba(14,165,233,0.2)'; }
      else if (rec.status === 'สาย') { symbol = '⏰'; cellBg = 'rgba(245,158,11,0.2)'; }
    }
    bodyHtml += `<td style="text-align:center;background:${cellBg};font-size:20px">${symbol}</td>`;
  });
  bodyHtml += `<td class="att-summary-col" style="text-align:center">${attendedHours}/${totalHours}</td>
               <td class="att-summary-col" style="text-align:center;color:${pctColor};font-size:18px">${pct.toFixed(0)}%</td></tr>`;

  wrapper.innerHTML = `
    <div style="color:var(--accent);font-weight:bold;margin-bottom:10px;border-left:4px solid var(--primary);padding-left:10px;">
      📚 วิชา: ${escapeHtml(subjectName)}
    </div>
    <div class="tbl-wrap">
      <table>
        <thead>${headHtml}</thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>`;
  container.appendChild(wrapper);
}

// ─── GRADING ───────────────────────────────────────────────
async function loadGrading() {
  stopQrScanner(); $('scan-sw').checked = false; $('scan-area').style.display = 'none';
  const aid = $('g-asgn').value, room = $('g-room').value;
  if (!aid || !room) { showToast('กรุณาเลือกห้องและงาน', 'error'); return; }
  const asgn = assignments.find(a => a.id === aid);
  $('grading-title').textContent = '📋 ' + (asgn?.name || 'รายชื่อนักเรียน') + ' — ห้อง ' + room;
  $('grading-wrap').style.display = 'block';
  $('grading-tbody').innerHTML = '<tr><td colspan="6"><div class="loading"><div class="spinner"></div>กำลังโหลด...</div></td></tr>';
  try {
    const classStudents = students.filter(s => s.classroom === room).sort((a,b) => a.seat_no - b.seat_no);
    const gradesRaw = await gasCall('getGradesByAssignment', aid);
    const gMap = {};
    (gradesRaw || []).forEach(g => gMap[g.student_id] = g);
    gradingRows = classStudents.map(s => {
      const g = gMap[s.id] || {};
      return { student: s, gradeId: g.id || null, status: g.status || 'not_sent',
        score: g.score !== undefined && g.score !== null ? g.score : null,
        maxScore: g.max_score || asgn?.max_score || 10 };
    });
    renderGradingTable();
  } catch (e) {
    showToast('โหลดล้มเหลว: ' + e, 'error');
    $('grading-tbody').innerHTML = '';
  }
}

function togLabel(s) {
  if (s === 'checked') return '✅ ตรวจแล้ว';
  if (s === 'waiting') return '⏳ รอตรวจ';
  return '❌ ยังไม่ส่ง';
}

function renderGradingTable() {
  const tb = $('grading-tbody'); tb.innerHTML = '';
  gradingRows.forEach((row, i) => {
    const s   = row.student;
    const cls = row.status === 'checked' ? 'checked' : row.status === 'waiting' ? 'waiting' : 'not-sent';
    // FIX #7: ใช้ escapeHtml กับข้อมูลนักเรียน
    tb.innerHTML += `<tr id="gr-${i}">
      <td style="text-align:center">${s.seat_no || '—'}</td>
      <td style="font-size:.85rem;color:var(--text-dim)">${escapeHtml(s.id)}</td>
      <td><strong>${escapeHtml(s.first_name)} ${escapeHtml(s.last_name)}</strong></td>
      <td style="text-align:center"><button class="tog ${cls}" id="tog-${i}" onclick="toggleRow(${i})">${togLabel(row.status)}</button></td>
      <td style="text-align:center"><input class="score-in" type="number" id="sc-${i}" value="${row.score !== null ? row.score : ''}" min="0" max="${row.maxScore}" placeholder="${row.maxScore}"></td>
      <td style="text-align:center;font-weight:700;color:var(--text-dim)">${row.maxScore}</td>
    </tr>`;
  });
}

function toggleRow(i) {
  gradingRows[i].status = gradingRows[i].status === 'checked' ? 'not-sent' : 'checked';
  const btn = $('tog-' + i);
  btn.className   = 'tog ' + (gradingRows[i].status === 'checked' ? 'checked' : 'not-sent');
  btn.textContent = togLabel(gradingRows[i].status);
}

function markAllStatus(s) {
  gradingRows.forEach((_, i) => {
    gradingRows[i].status = s;
    const btn = $('tog-' + i);
    if (btn) { btn.className = 'tog ' + (s === 'checked' ? 'checked' : 'not-sent'); btn.textContent = togLabel(s); }
  });
}

async function saveGradesNow() {
  const aid = $('g-asgn').value;
  if (!aid) { showToast('กรุณาเลือกงานก่อน', 'error'); return; }
  const rows = gradingRows.map((row, i) => {
    const sv    = $('sc-' + i).value;
    // FIX #4: score=0 ต้องไม่ถูก treat เป็น null, ช่องว่าง = null เสมอ
    const score = sv !== '' ? parseFloat(sv) : null;
    const status = score !== null ? 'checked' : row.status;
    return { student_id: row.student.id, assignment_id: aid, score, max_score: row.maxScore, status };
  });
  try {
    await gasCall('saveGrades', rows);
    showToast('บันทึกคะแนนสำเร็จ! 🎉', 'success');
    await loadGrading();
  } catch (e) { showToast('บันทึกล้มเหลว: ' + e, 'error'); }
}

// ─── SCAN ──────────────────────────────────────────────────
function setScanMode(on) {
  $('scan-area').style.display = on ? 'block' : 'none';
  if (on) { startQrScanner(); $('scan-inp').focus(); } else stopQrScanner();
}

async function startQrScanner() {
  if (scanning) return;
  const aid = $('g-asgn').value;
  if (!aid) { showToast('กรุณาเลือกงานก่อน', 'warn'); $('scan-sw').checked = false; $('scan-area').style.display = 'none'; return; }
  try {
    html5QrCode = new Html5Qrcode('reader'); scanning = true;
    await html5QrCode.start({ facingMode:'environment' }, { fps:10, qrbox:{width:220,height:220} },
      async decodedText => {
        const now = Date.now();
        if (decodedText === lastScannedText && now - lastScannedAt < 2500) return;
        lastScannedText = decodedText; lastScannedAt = now;
        await handleScan(decodedText);
      }, () => {}
    );
    showToast('เปิดกล้องสแกน QR แล้ว', 'success');
  } catch (e) { scanning = false; showToast('เปิดกล้องไม่ได้: ' + e, 'error'); }
}

async function stopQrScanner() {
  try { if (html5QrCode && scanning) { await html5QrCode.stop(); await html5QrCode.clear(); } } catch (e) {}
  scanning = false;
}

function extractStudentId(raw) {
  raw = (raw || '').trim(); if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try { return new URL(raw).searchParams.get('student_id') || raw; } catch (e) { return raw; }
  }
  return raw;
}

async function handleScan(val) {
  const studentId = extractStudentId(val); if (!studentId) return;
  const aid = $('g-asgn').value; if (!aid) { showToast('กรุณาเลือกงานก่อนสแกน', 'error'); return; }
  const idx = gradingRows.findIndex(r => r.student.id === studentId);
  if (idx === -1) { showToast('ไม่พบรหัส: ' + studentId, 'error'); return; }
  try {
    const result = await gasCall('markStudentSubmitted', studentId, aid);
    gradingRows[idx].status = 'checked'; gradingRows[idx].score = result.assignment.max_score;
    const btn = $('tog-' + idx);
    if (btn) { btn.className = 'tog checked'; btn.textContent = togLabel('checked'); }
    const sc = $('sc-' + idx); if (sc) sc.value = result.assignment.max_score;
    const row = $('gr-' + idx);
    if (row) { row.scrollIntoView({behavior:'smooth',block:'center'}); row.style.background='rgba(16,185,129,.1)'; setTimeout(()=>row.style.background='',1200); }
    showToast(result.student.first_name + ' ' + result.student.last_name, 'success');
  } catch (e) { showToast('บันทึกไม่สำเร็จ: ' + e, 'error'); }
}

// ─── ATTENDANCE (ADMIN) ────────────────────────────────────
async function loadAttendance() {
  stopAttendanceScanner(); $('att-scan-sw').checked = false; $('att-scan-area').style.display = 'none';
  const room = $('att-room').value, date = $('att-date').value;
  if (!room || !date) { showToast('กรุณาเลือกห้องและวันที่', 'error'); return; }
  $('attendance-title').textContent  = '📋 เช็กชื่อ ห้อง ' + room + ' วันที่ ' + date;
  $('attendance-wrap').style.display = 'block';
  $('attendance-tbody').innerHTML    = '<tr><td colspan="5"><div class="loading"><div class="spinner"></div>กำลังโหลด...</div></td></tr>';
  try {
    const classStudents = students.filter(s => s.classroom === room).sort((a,b) => a.seat_no - b.seat_no);
    const raw = await gasCall('getAttendanceByDate', room, date);
    const aMap = {};
    (raw || []).forEach(a => aMap[a.student_id] = a);
    attendanceRows = classStudents.map(s => {
      const a = aMap[s.id] || {};
      return { student: s, status: a.status || 'ขาด', remark: a.remark || '' };
    });
    renderAttendanceTable();
  } catch (e) {
    showToast('โหลดการเข้าเรียนล้มเหลว: ' + e, 'error');
    $('attendance-tbody').innerHTML = '';
  }
}

function renderAttendanceTable() {
  const tb = $('attendance-tbody'); if (!tb) return;
  tb.innerHTML = '';
  attendanceRows.forEach((row, i) => {
    const sel = 'att-select select-' + row.status;
    // FIX #7: escape ชื่อนักเรียน
    tb.innerHTML += `<tr id="att-row-${i}" class="row-${row.status}">
      <td style="text-align:center;font-weight:700">${row.student.seat_no || '—'}</td>
      <td style="color:#cbd5e1;font-size:.85rem">${escapeHtml(row.student.id)}</td>
      <td><span style="color:#fff;font-size:1.05rem;font-weight:600">${escapeHtml(row.student.first_name)} ${escapeHtml(row.student.last_name)}</span></td>
      <td style="text-align:center">
        <select id="att-status-${i}" class="${sel}" onchange="updateAttendanceRowVisual(${i},this.value)">
          <option value="มา"  ${row.status==='มา'  ? 'selected':''}>มา</option>
          <option value="ขาด" ${row.status==='ขาด' ? 'selected':''}>ขาด</option>
          <option value="ลา"  ${row.status==='ลา'  ? 'selected':''}>ลา</option>
          <option value="สาย" ${row.status==='สาย' ? 'selected':''}>สาย</option>
        </select>
      </td>
      <td><input type="text" id="att-remark-${i}" value="${escapeHtml(row.remark||'')}" placeholder="หมายเหตุ" style="background:rgba(255,255,255,0.92);color:#000"></td>
    </tr>`;
  });
}

function updateAttendanceRowVisual(index, value) {
  attendanceRows[index].status = value;
  const tr = $('att-row-' + index), sel = $('att-status-' + index);
  if (tr)  tr.className  = 'row-' + value;
  if (sel) sel.className = 'att-select select-' + value;
}

function markAllAttendance(status) {
  attendanceRows.forEach((row, i) => {
    row.status = status;
    const el = $('att-status-' + i); if (el) el.value = status;
    updateAttendanceRowVisual(i, status);
  });
}

async function saveAttendanceNow() {
  const date  = $('att-date').value;
  const subj  = $('att-subj').value;
  const room  = $('att-room').value;
  const hours = parseFloat($('att-hours').value) || 1;
  if (!date || !subj || !room) { showToast('กรุณาเลือกวิชา ห้อง และวันที่ให้ครบ', 'error'); return; }
  const rows = attendanceRows.map((row, i) => ({
    student_id:      row.student.id,
    attendance_date: date, subject: subj,
    status:  $('att-status-' + i) ? $('att-status-' + i).value : row.status,
    remark:  $('att-remark-'  + i) ? $('att-remark-'  + i).value : '',
    hours
  }));
  try {
    await gasCall('saveAttendance', rows);
    showToast('บันทึกการเข้าเรียนวิชา ' + subj + ' สำเร็จ', 'success');
  } catch (e) { showToast('บันทึกไม่สำเร็จ: ' + (e.message || e), 'error'); }
}

function setAttendanceScanMode(on) {
  $('att-scan-area').style.display = on ? 'block' : 'none';
  if (on) { startAttendanceScanner(); $('att-scan-inp').focus(); } else stopAttendanceScanner();
}

async function startAttendanceScanner() {
  if (attendanceScanning) return;
  const room = $('att-room').value, date = $('att-date').value;
  if (!room || !date) { showToast('กรุณาเลือกห้องและวันที่ก่อนสแกน','warn'); $('att-scan-sw').checked=false; $('att-scan-area').style.display='none'; return; }
  try {
    attendanceQr = new Html5Qrcode('att-reader'); attendanceScanning = true;
    await attendanceQr.start({ facingMode:'environment' }, { fps:10, qrbox:{width:220,height:220} },
      async decodedText => {
        const now = Date.now();
        if (decodedText === lastAttendanceScan && now - lastAttendanceScanAt < 2500) return;
        lastAttendanceScan = decodedText; lastAttendanceScanAt = now;
        await handleAttendanceScan(decodedText);
      }, () => {}
    );
    showToast('เปิดกล้องเช็กชื่อแล้ว', 'success');
  } catch (e) { attendanceScanning=false; showToast('เปิดกล้องไม่ได้: '+e,'error'); }
}

async function stopAttendanceScanner() {
  try { if (attendanceQr && attendanceScanning) { await attendanceQr.stop(); await attendanceQr.clear(); } } catch (e) {}
  attendanceScanning = false;
}

async function handleAttendanceScan(val) {
  const studentId = extractStudentId(val); if (!studentId) return;
  const date   = $('att-date').value;
  const status = $('att-default-status').value;
  // FIX #5: ส่ง subject และ hours ไปด้วย
  const subj   = $('att-subj').value;
  const hours  = parseFloat($('att-hours').value) || 1;
  const idx    = attendanceRows.findIndex(r => r.student.id === studentId);
  if (idx === -1) { showToast('ไม่พบรหัส: ' + studentId, 'error'); return; }
  try {
    const result = await gasCall('markStudentAttendance', studentId, date, status, '', subj, hours);
    attendanceRows[idx].status = status;
    const statusEl = $('att-status-' + idx); if (statusEl) statusEl.value = status;
    updateAttendanceRowVisual(idx, status);
    const row = $('att-row-' + idx); if (row) row.scrollIntoView({behavior:'smooth',block:'center'});
    showToast(result.student.first_name + ' ' + result.student.last_name + ' = ' + status, 'success');
  } catch (e) { showToast('เช็กชื่อไม่สำเร็จ: ' + e, 'error'); }
}

// ─── STUDENTS TAB ──────────────────────────────────────────
function renderStudentTable() { filterStudents(); }

function filterStudents() {
  const room = $('f-room').value, q = $('f-q').value.toLowerCase();
  const list = students.filter(s =>
    (!room || s.classroom === room) &&
    (!q || s.id.toLowerCase().includes(q) || s.first_name.toLowerCase().includes(q) || s.last_name.toLowerCase().includes(q))
  );
  const tb = $('st-tbody-admin');
  if (!list.length) { tb.innerHTML = '<tr><td colspan="7"><div class="empty" style="padding:24px"><div class="empty-ico" style="font-size:2rem">🔍</div><div class="empty-title">ไม่มีข้อมูล</div></div></td></tr>'; return; }

  // FIX #7: ไม่ใช้ JSON.stringify ใน onclick — ใช้ data-id แทน
  tb.innerHTML = list.map(s => `<tr>
    <td style="font-size:.85rem">${escapeHtml(s.id)}</td>
    <td>${escapeHtml(s.first_name)}</td>
    <td>${escapeHtml(s.last_name)}</td>
    <td><span class="badge badge-blue">${escapeHtml(s.classroom)}</span></td>
    <td style="text-align:center">${s.seat_no}</td>
    <td style="text-align:center">
        <div class="flex gap-2 justify-center">
            <button class="btn btn-sm btn-outline" data-action="qr" data-id="${escapeHtml(s.id)}">📷</button>
            <button class="btn btn-sm btn-ghost"   data-action="edit" data-id="${escapeHtml(s.id)}">✏️</button>
        </div>
    </td>
    <td style="text-align:center"><button class="btn btn-sm btn-danger" data-action="del" data-id="${escapeHtml(s.id)}">🗑️</button></td>
  </tr>`).join('');

  // event delegation แทน inline onclick
  tb.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sid = btn.dataset.id;
      const st = students.find(s => s.id === sid);
      if (!st) return;
      if (btn.dataset.action === 'qr')   showQR(st.id, st.first_name + ' ' + st.last_name, st.classroom);
      if (btn.dataset.action === 'edit') editStudent(st);
      if (btn.dataset.action === 'del')  delStudent(st.id);
    });
  });
}

function prepareAddStudent() {
  const modalTitle = document.querySelector('#m-add-st .modal-hd');
  if (modalTitle) modalTitle.innerHTML = `➕ เพิ่มนักเรียน <button class="modal-close" onclick="closeModal('m-add-st')">✕</button>`;
  $('ns-id').value = '';
  $('ns-id').readOnly = false;
  $('ns-id').style.opacity = "1";
  $('ns-fn').value = '';
  $('ns-ln').value = '';
  $('ns-cls').value = '';
  $('ns-seat').value = '';
  $('ns-email').value = '';
  openModal('m-add-st');
}

async function ensureGradeRowsForStudent(studentId, classroom) {
  const roomAssignments = assignments.filter(a => a.classroom === classroom);
  if (!roomAssignments.length) return;
  const { data: existingGrades } = await _sb
    .from('grades').select('assignment_id').eq('student_id', studentId)
    .in('assignment_id', roomAssignments.map(a => a.id));
  const existingIds = new Set((existingGrades || []).map(g => g.assignment_id));
  const newRows = roomAssignments
    .filter(a => !existingIds.has(a.id))
    .map(a => ({ student_id: studentId, assignment_id: a.id, score: null, max_score: a.max_score, status: 'not_sent' }));
  if (newRows.length > 0) {
    const { error } = await _sb.from('grades').upsert(newRows, { onConflict: 'student_id,assignment_id', ignoreDuplicates: true });
    if (error) console.error('ensureGradeRowsForStudent error:', error);
  }
}

async function saveStudent() {
  const d = {
    id:         $('ns-id').value.trim(),
    first_name: $('ns-fn').value.trim(),
    last_name:  $('ns-ln').value.trim(),
    classroom:  $('ns-cls').value.trim(),
    seat_no:    parseInt($('ns-seat').value) || 0,
    email:      $('ns-email').value.trim()
  };
  if (!d.id || !d.first_name || !d.last_name || !d.classroom) {
    showToast('กรุณากรอกข้อมูลให้ครบ', 'error'); return;
  }
  try {
    await gasCall('upsertStudent', d);
    await ensureGradeRowsForStudent(d.id, d.classroom);
    closeModal('m-add-st');
    showToast('บันทึกสำเร็จ', 'success');
    students    = await gasCall('getStudents');
    assignments = await gasCall('getAllAssignments');
    populateDropdowns(); renderStudentTable();
  } catch (e) { showToast('ผิดพลาด: ' + e, 'error'); }
}

function editStudent(s) {
  const modalTitle = document.querySelector('#m-add-st .modal-hd');
  if (modalTitle) modalTitle.innerHTML = `✏️ แก้ไขข้อมูลนักเรียน <button class="modal-close" onclick="closeModal('m-add-st')">✕</button>`;
  $('ns-id').value = s.id;
  $('ns-id').readOnly = true;
  $('ns-id').style.opacity = "0.6";
  $('ns-fn').value = s.first_name;
  $('ns-ln').value = s.last_name;
  $('ns-cls').value = s.classroom;
  $('ns-seat').value = s.seat_no;
  $('ns-email').value = s.email || '';
  openModal('m-add-st');
}

async function delStudent(id) {
  if (!confirm('ลบนักเรียนรหัส ' + id + '?')) return;
  try {
    await gasCall('deleteStudent', id);
    showToast('ลบแล้ว', 'success');
    students = await gasCall('getStudents');
    populateDropdowns(); renderStudentTable();
  } catch (e) { showToast('ผิดพลาด: ' + e, 'error'); }
}

// ─── TEMPLATE DOWNLOAD ─────────────────────────────────────
// FIX #1: เพิ่มฟังก์ชัน dlTemplate ที่หายไป
function dlTemplate() {
  const header = [['รหัสนักเรียน','ชื่อ','สกุล','ชั้น','เลขที่','อีเมล']];
  const ws = XLSX.utils.aoa_to_sheet(header);
  ws['!cols'] = [{ wch:16 },{ wch:16 },{ wch:16 },{ wch:10 },{ wch:8 },{ wch:28 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'นักเรียน');
  XLSX.writeFile(wb, 'template_นักเรียน.xlsx');
}

// ─── IMPORT ────────────────────────────────────────────────
async function importFile(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const wb   = XLSX.read(e.target.result, { type: 'binary' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      const list = rows.map(r => ({
        id:         String(r['รหัสนักเรียน'] || r['id'] || ''),
        first_name: String(r['ชื่อ'] || r['first_name'] || ''),
        last_name:  String(r['สกุล'] || r['last_name'] || ''),
        classroom:  String(r['ชั้น'] || r['classroom'] || ''),
        seat_no:    parseInt(r['เลขที่'] || r['seat_no'] || 0),
        email:      String(r['อีเมล'] || r['email'] || '')
      })).filter(s => s.id);
      await gasCall('upsertStudents', list);
      showToast('นำเข้า ' + list.length + ' คนสำเร็จ', 'success');
      students    = await gasCall('getStudents');
      assignments = await gasCall('getAllAssignments');
      showToast('กำลังตั้งค่างานค้าง...', 'info');
      for (const s of list) {
        await ensureGradeRowsForStudent(s.id, s.classroom);
      }
      populateDropdowns(); renderStudentTable();
      showToast(`✅ ตั้งค่างานค้างสำเร็จ (${list.length} คน)`, 'success');
    } catch (e) { showToast('ผิดพลาด: ' + e, 'error'); }
  };
  reader.readAsBinaryString(file); input.value = '';
}

// ─── QR CODE ───────────────────────────────────────────────
function showQR(id, name, cls) {
  $('qr-wrap').innerHTML = '';
  new QRCode($('qr-wrap'), { text: id, width: 192, height: 192, colorDark: '#0f172a', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.H });
  $('qr-info').innerHTML = `<strong style="font-size:1.05rem">${escapeHtml(name)}</strong><br><span class="text-muted">${escapeHtml(cls)} | รหัส: ${escapeHtml(id)}</span>`;
  openModal('m-qr');
}

function printQR() {
  const qr = $('qr-wrap').innerHTML, info = $('qr-info').innerHTML;
  const w  = window.open('', '_blank');
  // FIX #8: ตรวจ popup blocker
  if (!w) { showToast('กรุณาอนุญาต Popup ในเบราว์เซอร์', 'warn'); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>QR</title><link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600&display=swap" rel="stylesheet"><style>body{font-family:'Sarabun',sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f8fafc}.box{border:2.5px solid #0ea5e9;border-radius:18px;padding:28px 32px;text-align:center;background:#fff;box-shadow:0 4px 24px rgba(14,165,233,.18)}</style></head><body><div class="box">${qr}<div style="margin-top:12px">${info}</div></div><script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

async function printAllQR() {
  const room = $('f-room').value;
  if (!room) { showToast('กรุณาเลือกห้องเรียนก่อน','warn'); return; }
  const list = students.filter(s => s.classroom === room).sort((a,b) => a.seat_no - b.seat_no);
  if (!list.length) { showToast('ไม่พบข้อมูลนักเรียน','error'); return; }
  showToast('กำลังสร้าง QR...','info');
  const tempArea = document.createElement('div'); tempArea.style.display='none'; document.body.appendChild(tempArea);
  let htmlContent = '';
  for (const s of list) {
    const qrDiv = document.createElement('div'); tempArea.appendChild(qrDiv);
    new QRCode(qrDiv, { text: s.id, width: 200, height: 200, colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.H });
    await new Promise(r => setTimeout(r, 50));
    const img = qrDiv.querySelector('img');
    htmlContent += `<div class="qr-card"><img src="${img?.src||''}" style="width:150px;height:150px;"><div class="st-name">${escapeHtml(s.first_name)} ${escapeHtml(s.last_name)}</div><div class="st-id">${escapeHtml(s.id)}</div><div class="st-meta">เลขที่ ${s.seat_no} | ${escapeHtml(s.classroom)}</div></div>`;
    qrDiv.remove();
  }
  document.body.removeChild(tempArea);
  const pw = window.open('','_blank');
  // FIX #8: ตรวจ popup blocker
  if (!pw) { showToast('กรุณาอนุญาต Popup ในเบราว์เซอร์', 'warn'); return; }
  pw.document.write(`<html><head><title>QR ${room}</title><link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&family=Kanit:wght@700&display=swap" rel="stylesheet"><style>@page{size:A4;margin:10mm}body{font-family:'Sarabun',sans-serif;margin:0;background:#fff}.grid{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:65mm;gap:5mm;padding:2mm}.qr-card{border:1px solid #000;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5px;text-align:center;break-inside:avoid}.st-name{font-size:1rem;font-weight:bold;margin-top:5px}.st-id{font-family:'Kanit';font-size:2.2rem;color:#000;line-height:1;margin:2px 0}.st-meta{font-size:.8rem;color:#333}</style></head><body onload="setTimeout(()=>{window.print();window.close()},500)"><div class="grid">${htmlContent}</div></body></html>`);
  pw.document.close();
}

// ─── BEHAVIOR TAB ──────────────────────────────────────────
function renderBehaviorList() {
  const q = ($('bh-search')?.value || '').toLowerCase();
  const list = students.filter(s =>
    s.id.toLowerCase().includes(q) || s.first_name.toLowerCase().includes(q) || s.last_name.toLowerCase().includes(q)
  );
  const tb = $('bh-tbody'); if (!tb) return;
  tb.innerHTML = list.length ? list.map(s => {
    const score = s.behavior_score ?? 10;
    return `<tr>
      <td style="font-size:.85rem">${escapeHtml(s.id)}</td>
      <td><strong>${escapeHtml(s.first_name)} ${escapeHtml(s.last_name)}</strong></td>
      <td><span class="badge badge-blue">${escapeHtml(s.classroom)}</span></td>
      <td style="text-align:center">
        <span class="score-big" style="font-size:1.6rem;color:var(--purple)"
          id="bh-val-${escapeHtml(s.id)}"
          data-score="${score}">${score}</span>
      </td>
      <td style="text-align:center"><div class="flex justify-center gap-2">
        <button class="btn btn-sm btn-danger"  data-bhid="${escapeHtml(s.id)}" data-change="-1">หัก 1</button>
        <button class="btn btn-sm btn-success" data-bhid="${escapeHtml(s.id)}" data-change="1">บวก 1</button>
      </div></td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--text-dim)">ไม่พบข้อมูล</td></tr>';

  // FIX #6: ใช้ data-score dataset แทน innerText
  tb.querySelectorAll('button[data-bhid]').forEach(btn => {
    btn.addEventListener('click', () => modifyBehavior(btn.dataset.bhid, parseInt(btn.dataset.change)));
  });
}

async function modifyBehavior(studentId, change) {
  const scoreEl = $('bh-val-' + studentId);
  // FIX #6: ใช้ dataset แทน innerText เพื่อหลีกเลี่ยง reflow
  const currentScore = parseFloat(scoreEl.dataset.score || scoreEl.textContent);
  const newScore = currentScore + change;
  if (newScore < 0)  { showToast('คะแนนจิตพิสัยต่ำสุดคือ 0','warn');  return; }
  if (newScore > 15) { showToast('คะแนนจิตพิสัยสูงสุดคือ 15','warn'); return; }
  try {
    await gasCall('updateBehaviorScore', studentId, newScore);
    scoreEl.textContent = newScore;
    scoreEl.dataset.score = newScore;
    const idx = students.findIndex(s => s.id === studentId);
    if (idx !== -1) students[idx].behavior_score = newScore;
    showToast('อัปเดตคะแนนพฤติกรรมเรียบร้อย', 'success');
  } catch (e) { showToast('บันทึกล้มเหลว: ' + e, 'error'); }
}

// ─── ASSIGNMENTS ───────────────────────────────────────────
function populateAsgnModal() {
  const subjs = [...new Set(assignments.map(a => a.subject))].sort();
  const sel = $('na-subj-sel');
  sel.innerHTML = '<option value="">— เลือกวิชา —</option>' +
    subjs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('') +
    '<option value="__new__">✏️ เพิ่มวิชาใหม่...</option>';
  const rooms = [...new Set(students.map(s => s.classroom))].sort();
  const rSel = $('na-room-sel');
  rSel.innerHTML = '<option value="">— เลือกห้อง —</option>' +
    rooms.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('') +
    '<option value="__new__">✏️ เพิ่มห้องใหม่...</option>';
  $('na-subj').style.display = 'none'; $('na-subj').value = '';
  $('na-room').style.display = 'none'; $('na-room').value = '';
}

function syncSubjInput(val) {
  const inp = $('na-subj');
  if (val === '__new__') { inp.style.display='block'; inp.value=''; inp.focus(); }
  else { inp.style.display='none'; inp.value=val; }
}
function syncRoomInput(val) {
  const inp = $('na-room');
  if (val === '__new__') { inp.style.display='block'; inp.value=''; inp.focus(); }
  else { inp.style.display='none'; inp.value=val; }
}

function renderAsgnTable() {
  const tb = $('asgn-tbody');
  if (!assignments.length) { tb.innerHTML='<tr><td colspan="6" style="text-align:center;padding:28px">ยังไม่มีงาน</td></tr>'; return; }
  tb.innerHTML = assignments.map(a => {
    const catClass = {'ก่อนกลางภาค':'badge-blue','กลางภาค':'badge-green','หลังกลางภาค':'badge-amber','ปลายภาค':'badge-red'}[a.category] || 'badge-blue';
    return `<tr>
      <td><strong>${escapeHtml(a.name)}</strong>${a.description ? `<br><small style="color:var(--text-dim)">📝 ${escapeHtml(a.description)}</small>` : ''}</td>
      <td>${escapeHtml(a.subject)}</td>
      <td>${escapeHtml(a.classroom)}</td>
      <td><span class="badge ${catClass}">${escapeHtml(a.category)}</span></td>
      <td style="text-align:center"><strong>${a.max_score}</strong> <small style="color:var(--text-dim)">(ผ่าน ${a.passing_score})</small></td>
      <td style="text-align:center">
        <button class="btn btn-sm btn-outline" data-action="edit" data-id="${escapeHtml(a.id)}">✏️</button>
        <button class="btn btn-sm btn-danger"  data-action="del"  data-id="${escapeHtml(a.id)}">🗑️</button>
      </td>
    </tr>`;
  }).join('');

  // FIX #7: event delegation แทน JSON.stringify ใน onclick
  tb.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const aid = btn.dataset.id;
      const asgn = assignments.find(a => a.id === aid);
      if (!asgn) return;
      if (btn.dataset.action === 'edit') editAssignment(asgn);
      if (btn.dataset.action === 'del')  delAssignment(asgn.id);
    });
  });
}

async function saveAssignment() {
  const id      = $('na-id').value;
  const subjSel = $('na-subj-sel').value;
  const subj    = (subjSel === '__new__' || subjSel === '') ? $('na-subj').value.trim() : subjSel;
  const roomSel = $('na-room-sel').value;
  const room    = (roomSel === '__new__' || roomSel === '') ? $('na-room').value.trim() : roomSel;
  const d = {
    name: $('na-nm').value.trim(), description: $('na-desc').value.trim(),
    subject: subj, classroom: room, category: $('na-cat').value,
    max_score: parseFloat($('na-max').value) || 10,
    passing_score: parseFloat($('na-pass').value) || 0,
    type: $('na-type').value
  };
  if (id) d.id = id;
  if (!d.name || !d.subject || !d.classroom) { showToast('กรุณากรอกข้อมูลให้ครบ','error'); return; }
  try {
    const { data: savedAsgn, error } = await _sb
      .from('assignments').upsert(d, { onConflict: 'id' }).select().single();
    if (error) throw error;
    if (!id) {
      const localStudents = students.filter(s => s.classroom === room);
      if (localStudents.length > 0) {
        const gradeRows = localStudents.map(s => ({
          student_id: s.id, assignment_id: savedAsgn.id,
          score: null, max_score: d.max_score, status: 'not_sent'
        }));
        await _sb.from('grades').upsert(gradeRows, { onConflict: 'student_id,assignment_id', ignoreDuplicates: true });
      }
    }
    closeModal('m-add-asgn');
    showToast(id ? 'แก้ไขงานสำเร็จ' : 'สร้างงานสำเร็จ', 'success');
    $('na-id').value = ''; $('asgn-modal-title').textContent = '➕ เพิ่มงาน / การสอบ';
    assignments = await gasCall('getAllAssignments');
    populateDropdowns(); renderAsgnTable();
  } catch (e) { showToast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

function editAssignment(a) {
  populateAsgnModal();
  $('asgn-modal-title').textContent = '✏️ แก้ไขข้อมูลงาน';
  $('na-id').value = a.id; $('na-nm').value = a.name; $('na-desc').value = a.description || '';
  $('na-cat').value = a.category; $('na-type').value = a.type || 'เดี่ยว';
  $('na-max').value = a.max_score; $('na-pass').value = a.passing_score;
  $('na-subj-sel').value = a.subject; $('na-subj').value = a.subject;
  $('na-room-sel').value = a.classroom; $('na-room').value = a.classroom;
  openModal('m-add-asgn');
}

async function delAssignment(id) {
  if (!confirm('ลบงานนี้? คะแนนที่เกี่ยวข้องจะถูกลบด้วย')) return;
  try {
    await gasCall('deleteAssignment', id);
    showToast('ลบงานแล้ว','success');
    assignments = await gasCall('getAllAssignments');
    populateDropdowns(); renderAsgnTable(); syncAssignSelect();
  } catch (e) { showToast('ผิดพลาด: ' + e, 'error'); }
}

// ─── GOOGLE CLASSROOM SYNC ─────────────────────────────────
async function gcFetch(url) {
  // FIX #11: เพิ่ม timeout 15 วินาที
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${googleAccessToken}` },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (resp.status === 401) { googleAccessToken = null; throw new Error('Token หมดอายุ กรุณากดซิงค์อีกครั้ง'); }
    if (resp.status === 403) { throw new Error('ไม่มีสิทธิ์เข้าถึง กรุณาอนุญาต Permission ใหม่'); }
    if (!resp.ok) { const errBody = await resp.text(); throw new Error(`HTTP ${resp.status}: ${errBody.substring(0, 120)}`); }
    return resp.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Request timeout — กรุณาลองใหม่');
    throw e;
  }
}

function detectCategory(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('ปลายภาค') || t.includes('final') || t.includes('[fin]')) {
    return 'ปลายภาค';
  }
  if (t.includes('หลังกลางภาค') || t.includes('after') || t.includes('[aft]')) {
    return 'หลังกลางภาค';
  }
  if (t.includes('กลางภาค') || t.includes('midterm') || t.includes('[mid]')) {
    return 'กลางภาค';
  }
  if (t.includes('ก่อนกลางภาค') || t.includes('before') || t.includes('[bef]')) {
    return 'ก่อนกลางภาค';
  }
  return 'ก่อนกลางภาค'; 
}

function syncFromClassroom() {
  const existing = $('m-gc-sync');
  if (existing) existing.remove();
  const rooms = [...new Set(students.map(s => s.classroom))].sort();
  const subjs = [...new Set(assignments.map(a => a.subject))].sort();
  const el = document.createElement('div');
  el.className = 'modal-overlay open';
  el.id = 'm-gc-sync';
  el.innerHTML = `
    <div class="modal" style="max-width:500px">
      <div class="modal-hd">
        <img src="https://upload.wikimedia.org/wikipedia/commons/5/59/Google_Classroom_Logo.png"
          style="height:24px;vertical-align:middle;margin-right:8px">
        ซิงค์จาก Google Classroom
        <button class="modal-close" onclick="document.getElementById('m-gc-sync').remove()">✕</button>
      </div>
      <div class="mb-3">
        <label>ห้องเรียนในระบบ (ที่จะรับข้อมูล) *</label>
        <select id="gc-room">
          <option value="">— เลือกห้อง —</option>
          ${rooms.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}
        </select>
      </div>
      <div class="mb-4">
        <label>วิชา (ที่จะบันทึกงานลงใน) *</label>
        <select id="gc-subj" onchange="document.getElementById('gc-subj-new').style.display=this.value==='__new__'?'block':'none'">
          <option value="">— เลือกวิชา —</option>
          ${subjs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
          <option value="__new__">✏️ พิมพ์วิชาใหม่...</option>
        </select>
        <input type="text" id="gc-subj-new" placeholder="พิมพ์ชื่อวิชา..." style="margin-top:8px;display:none">
      </div>
      <div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:12px;font-size:0.83rem;margin-bottom:16px">
        <strong style="color:var(--amber)">⚠️ เงื่อนไขสำคัญ</strong>
        <ul style="margin:6px 0 0 16px;color:var(--text-dim);line-height:2">
          <li>ชื่อ Course ใน Google Classroom ต้องมีชื่อห้องอยู่ เช่น <em>"ชีววิทยา ม.5/1"</em></li>
          <li>อีเมลนักเรียนในระบบต้องตรงกับ Google Account ของนักเรียน</li>
          <li>คะแนนจะดึงมาเฉพาะงานที่ครู <strong>Return</strong> กลับแล้วเท่านั้น</li>
        </ul>
      </div>
      <div id="gc-log" style="display:none;background:#0f172a;border:1px solid var(--border-glass);border-radius:10px;padding:14px;font-family:monospace;font-size:0.78rem;color:#7dd3fc;white-space:pre-wrap;max-height:220px;overflow-y:auto;margin-bottom:16px"></div>
      <div class="flex gap-3">
        <button class="btn btn-primary flex-1 btn-lg" id="gc-start-btn" onclick="startGcSync()">🚀 เชื่อมต่อ Google &amp; เริ่มซิงค์</button>
        <button class="btn btn-ghost" onclick="document.getElementById('m-gc-sync').remove()">ยกเลิก</button>
      </div>
    </div>`;
  document.body.appendChild(el);
}

function gcLog(msg, type) {
  const el = $('gc-log');
  if (!el) return;
  el.style.display = 'block';
  const colors = { ok:'#4ade80', err:'#f87171', info:'#7dd3fc', warn:'#fbbf24' };
  const icons  = { ok:'✅', err:'❌', info:'→', warn:'⚠️' };
  el.innerHTML += `<span style="color:${colors[type]||'#cbd5e1'}">${icons[type]||'•'} ${escapeHtml(msg)}\n</span>`;
  el.scrollTop = el.scrollHeight;
}

async function startGcSync() {
  const room = $('gc-room').value;
  const subjSel = $('gc-subj').value;
  const subjNew = ($('gc-subj-new').value || '').trim();
  const subj = subjSel === '__new__' ? subjNew : subjSel;
  if (!room) { showToast('กรุณาเลือกห้องเรียน', 'error'); return; }
  if (!subj) { showToast('กรุณาเลือกหรือพิมพ์วิชา', 'error'); return; }
  const btn = $('gc-start-btn');
  btn.disabled = true; btn.textContent = '⏳ กำลังดำเนินการ...';
  if (!googleAccessToken) {
    _requestGcToken(() => _doGcSync(room, subj));
  } else {
    await _doGcSync(room, subj);
  }
}

function _requestGcToken(callback) {
  const tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: [
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
      'https://www.googleapis.com/auth/classroom.rosters.readonly',
      'https://www.googleapis.com/auth/classroom.profile.emails',
      'https://www.googleapis.com/auth/classroom.profile.photos'
    ].join(' '),
    callback: resp => {
      if (resp.error) { showToast('Google Auth ล้มเหลว: ' + resp.error, 'error'); return; }
      googleAccessToken = resp.access_token;
      gcLog('เชื่อมต่อ Google สำเร็จ (สิทธิ์ครบถ้วน)', 'ok');
      if (callback) callback();
    }
  });
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

async function _doGcSync(room, subj) {
  gcLog(`เริ่มซิงค์ | ห้อง: ${room} | วิชา: ${subj}`, 'info');
  setSyncProgress(5, '🔍 ค้นหาห้องเรียนใน Google Classroom...');
  try {
    gcLog('กำลังดึงรายวิชา...', 'info');
    const coursesData = await gcFetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=50');
    if (!coursesData.courses?.length) { gcLog('ไม่พบวิชาในบัญชีนี้', 'err'); setSyncProgress(0); showToast('ไม่พบวิชาเรียนในบัญชี Google นี้', 'error'); return; }
    const targetCourse = coursesData.courses.find(c => (c.name || '').includes(room) || (c.section || '').includes(room));
    if (!targetCourse) { gcLog(`ไม่พบห้อง "${room}" | วิชาที่มี: ${coursesData.courses.map(c => c.name).join(', ')}`, 'err'); setSyncProgress(0); showToast(`ไม่พบห้อง "${room}" ใน Classroom`, 'error'); return; }
    gcLog(`พบ Course: "${targetCourse.name}" (ID: ${targetCourse.id})`, 'ok');
    setSyncProgress(15, '👥 กำลังดึงรายชื่อนักเรียน...');
    const rosterData = await gcFetch(`https://classroom.googleapis.com/v1/courses/${targetCourse.id}/students?pageSize=200`);
    const gcEmailMap = {};
    (rosterData.students || []).forEach(s => { if (s.userId && s.profile?.emailAddress) gcEmailMap[s.userId] = s.profile.emailAddress.toLowerCase(); });
    gcLog(`นักเรียนใน Classroom: ${Object.keys(gcEmailMap).length} คน`, 'info');
    const localStudents = students.filter(s => s.classroom === room);
    const localEmailMap = {};
    localStudents.forEach(s => { if (s.email) localEmailMap[s.email.toLowerCase()] = s; });
    gcLog(`นักเรียนในระบบ (${room}): ${localStudents.length} คน | มี email: ${Object.keys(localEmailMap).length} คน`, 'info');
    let matchCount = 0;
    Object.values(gcEmailMap).forEach(email => { if (localEmailMap[email]) matchCount++; });
    gcLog(`จับคู่ email ได้: ${matchCount} คน`, matchCount > 0 ? 'ok' : 'warn');
    if (matchCount === 0) gcLog('⚠️ ไม่มี email ตรงกันเลย! ตรวจสอบ email ของนักเรียนในระบบ', 'warn');
    setSyncProgress(25, '📝 กำลังดึงรายการงาน...');
    const workData = await gcFetch(`https://classroom.googleapis.com/v1/courses/${targetCourse.id}/courseWork?pageSize=100&orderBy=updateTime%20desc`);
    if (!workData.courseWork?.length) { gcLog('ไม่พบงานใน Course นี้', 'warn'); setSyncProgress(0); showToast('ไม่พบงานใน Classroom', 'warn'); return; }
    const works = workData.courseWork;
    gcLog(`พบงาน: ${works.length} ชิ้น`, 'ok');
    setSyncProgress(30, `⚙️ กำลังซิงค์ ${works.length} งาน...`);
    let totalGraded = 0;
    for (let wi = 0; wi < works.length; wi++) {
      const work = works[wi];
      const pct  = 30 + Math.round(((wi + 1) / works.length) * 65);
      setSyncProgress(pct, `⚙️ งาน ${wi+1}/${works.length}: ${work.title}`);
      gcLog(`\n📝 งาน: "${work.title}" (maxPoints: ${work.maxPoints})`, 'info');
      const asgnPayload = { name: work.title, description: work.description || '', subject: subj, classroom: room, category: detectCategory(work.title), max_score: work.maxPoints || 10, passing_score: Math.ceil((work.maxPoints || 10) * 0.5), type: 'Google Classroom', gc_coursework_id: work.id };
      const { data: existCheck } = await _sb.from('assignments').select('id').eq('gc_coursework_id', work.id).maybeSingle();
      let asgnId;
      if (existCheck) {
        const { data: upd, error: updErr } = await _sb.from('assignments').update(asgnPayload).eq('id', existCheck.id).select('id').single();
        if (updErr) { gcLog(`  ❌ Update error: ${updErr.message}`, 'err'); continue; }
        asgnId = upd.id; gcLog(`  ↻ อัปเดตงานเดิม (ID: ${asgnId})`, 'info');
      } else {
        const { data: ins, error: insErr } = await _sb.from('assignments').insert(asgnPayload).select('id').single();
        if (insErr) { gcLog(`  ❌ Insert error: ${insErr.message}`, 'err'); continue; }
        asgnId = ins.id; gcLog(`  ✓ สร้างงานใหม่ (ID: ${asgnId})`, 'ok');
      }
      if (localStudents.length > 0) {
        const initRows = localStudents.map(s => ({ student_id: s.id, assignment_id: asgnId, score: null, max_score: work.maxPoints || 10, status: 'not_sent' }));
        await _sb.from('grades').upsert(initRows, { onConflict: 'student_id,assignment_id', ignoreDuplicates: true });
        gcLog(`  ✓ Ensure grade rows: ${localStudents.length} คน`, 'info');
      }
      let subsData;
      try { subsData = await gcFetch(`https://classroom.googleapis.com/v1/courses/${targetCourse.id}/courseWork/${work.id}/studentSubmissions?pageSize=200`); }
      catch (subErr) { gcLog(`  ⚠️ ดึง submissions ไม่ได้: ${subErr.message}`, 'warn'); continue; }
      const submissions = subsData.studentSubmissions || [];
      gcLog(`  Submissions: ${submissions.length} รายการ`, 'info');
      const gradeUpdates = [];
      for (const sub of submissions) {
        const email = gcEmailMap[sub.userId]; if (!email) continue;
        const localSt = localEmailMap[email]; if (!localSt) continue;
        let status = 'not_sent';
        if (sub.state === 'TURNED_IN' || sub.state === 'RECLAIMED_BY_STUDENT') status = 'waiting';
        else if (sub.state === 'RETURNED') status = 'checked';
        let score = null;
        if (sub.state === 'RETURNED' || sub.state === 'TURNED_IN') {
          if (sub.assignedGrade !== undefined && sub.assignedGrade !== null) score = parseFloat(sub.assignedGrade);
          else if (sub.draftGrade !== undefined && sub.draftGrade !== null) { score = parseFloat(sub.draftGrade); if (status === 'not_sent') status = 'waiting'; }
        }
        gradeUpdates.push({ student_id: localSt.id, assignment_id: asgnId, score, max_score: work.maxPoints || 10, status, updated_at: new Date().toISOString() });
      }
      if (gradeUpdates.length > 0) {
        const { error: grErr } = await _sb.from('grades').upsert(gradeUpdates, { onConflict: 'student_id,assignment_id' });
        if (grErr) { gcLog(`  ❌ บันทึกคะแนน error: ${grErr.message}`, 'err'); }
        else { const gradedNow = gradeUpdates.filter(g => g.score !== null).length; gcLog(`  ✓ อัปเดต ${gradeUpdates.length} คน | มีคะแนน: ${gradedNow} คน`, 'ok'); totalGraded += gradedNow; }
      } else { gcLog('  ℹ️ ไม่มี submission ที่ตรงกับนักเรียนในระบบ', 'warn'); }
      await new Promise(r => setTimeout(r, 150));
    }
    setSyncProgress(0);
    gcLog(`\n════ ซิงค์เสร็จ! ${works.length} งาน | มีคะแนน: ${totalGraded} รายการ ════`, 'ok');
    showToast(`ซิงค์สำเร็จ! ${works.length} งาน | คะแนน ${totalGraded} รายการ`, 'success');
    assignments = await gasCall('getAllAssignments');
    populateDropdowns(); renderAsgnTable(); syncAssignSelect();
    const btn = $('gc-start-btn');
    if (btn) { btn.disabled = false; btn.textContent = '✅ ซิงค์เสร็จแล้ว'; }
  } catch (e) {
    setSyncProgress(0);
    gcLog(`\nFATAL: ${e.message}`, 'err');
    showToast('❌ Sync Error: ' + e.message, 'error');
    console.error('[GC Sync]', e);
    if (e.message.includes('Token') || e.message.includes('401')) { googleAccessToken = null; gcLog('Token หมดอายุ — กดซิงค์อีกครั้ง', 'warn'); }
    const btn = $('gc-start-btn');
    if (btn) { btn.disabled = false; btn.textContent = '🔄 ลองอีกครั้ง'; }
  }
}

// ─── EXPORT ────────────────────────────────────────────────
async function exportExcel() {
  const room = $('exp-room').value, subj = $('exp-subj').value;
  if (!room || !subj) { showToast('เลือกห้องและวิชาก่อน','error'); return; }
  
  try {
    showToast('🚀 กำลังสร้างไฟล์ Excel...', 'info');
    const data = await gasCall('getGradesByRoom', room, subj);
    const sts = data.students, asgns = data.assignments, grs = data.grades;
    const gMap = {};
    grs.forEach(g => gMap[g.student_id + '__' + g.assignment_id] = g.score);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('คะแนน');

    // 1. สร้าง Header
    const header = ['เลขที่', 'รหัสนักเรียน', 'ชื่อ', 'สกุล'].concat(asgns.map(a => a.name)).concat(['รวม']);
    const headerRow = worksheet.addRow(header);

    // 2. สร้างแถวคะแนนเต็ม
    const maxRowData = ['', '', '', 'คะแนนเต็ม'].concat(asgns.map(a => a.max_score)).concat([asgns.reduce((s, a) => s + Number(a.max_score), 0)]);
    const maxRow = worksheet.addRow(maxRowData);

    // 3. ใส่ข้อมูลนักเรียน
    sts.forEach(s => {
      const scores = asgns.map(a => { 
        const v = gMap[s.id + '__' + a.id]; 
        return v !== undefined && v !== null ? Number(v) : ''; 
      });
      const total = scores.reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
      worksheet.addRow([s.seat_no, s.id, s.first_name, s.last_name].concat(scores).concat([total]));
    });

    // 4. ปรับสไตล์ทั้งหมด (TH Sarabun New 14pt)
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.font = { name: 'TH Sarabun New', size: 14 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'}
        };
      });

      // 5. เฉพาะ Header (แถวที่ 1): หมุนข้อความ 90 องศา
      if (rowNumber === 1) {
        row.height = 100; // เพิ่มความสูงแถวเพื่อให้ข้อความที่หมุนแสดงผลได้
        row.eachCell((cell, colNumber) => {
          if (colNumber > 4) { // เริ่มหมุนตั้งแต่คอลัมน์ที่ 5 เป็นต้นไป (รายการงาน)
            cell.alignment = { textRotation: 90, vertical: 'middle', horizontal: 'center' };
          }
          cell.font = { name: 'TH Sarabun New', size: 14, bold: true };
        });
      }
    });
    worksheet.getColumn(1).width = 8;
    worksheet.getColumn(2).width = 15;
    worksheet.getColumn(3).width = 20;
    worksheet.getColumn(4).width = 20;
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `คะแนน_${room}_${subj}.xlsx`);
    showToast('ดาวน์โหลดสำเร็จ', 'success');

  } catch (e) { 
    console.error(e);
    showToast('ผิดพลาด: ' + e, 'error'); 
  }
}

async function exportAttendanceReport() {
  const room = $('exp-att-room').value, subj = $('exp-att-subj').value;
  if (!room || !subj) { showToast('กรุณาเลือกห้องและวิชา','error'); return; }
  
  try {
    showToast('🚀 กำลังสร้างรายงาน...', 'info');
    const classStudents = students.filter(s => s.classroom === room).sort((a,b) => a.seat_no - b.seat_no);
    const allAtt = await gasCall('getAttendanceForRoom', room);
    const filteredAtt = (allAtt || []).filter(a => a.subject === subj);
    
    if (!filteredAtt.length) { showToast('ไม่พบข้อมูลการเช็กชื่อวิชา '+subj, 'warn'); return; }

    const attMap = {}, dateHoursMap = {};
    filteredAtt.forEach(a => {
      attMap[a.student_id + '_' + a.attendance_date] = a;
      const h = parseFloat(a.hours) || 1;
      if (!dateHoursMap[a.attendance_date] || h > dateHoursMap[a.attendance_date]) dateHoursMap[a.attendance_date] = h;
    });

    const dates = Object.keys(dateHoursMap).sort();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('การเข้าเรียน');

    // เตรียม Header
    const header = ['เลขที่', 'รหัส', 'ชื่อ-นามสกุล'];
    const dateCfg = [];
    dates.forEach(d => {
      const h = dateHoursMap[d];
      dateCfg.push({date: d, hours: h});
      const dObj = new Date(d);
      const dateShow = dObj.getDate() + '/' + (dObj.getMonth() + 1);
      for(let i = 1; i <= h; i++) header.push(dateShow + ' (ชม.' + i + ')');
    });
    header.push('ชม.รวม', 'มาเรียน(ชม.)', 'ร้อยละ', 'ผลลัพธ์');

    const headerRow = worksheet.addRow(header);
    headerRow.height = 80; // ความสูงสำหรับแนวตั้ง

    // ใส่ข้อมูลนักเรียน
    classStudents.forEach(s => {
      const rowData = [s.seat_no, s.id, s.first_name + ' ' + s.last_name];
      let totalH = 0, attendedH = 0;
      dateCfg.forEach(cfg => {
        const rec = attMap[s.id + '_' + cfg.date];
        const status = rec ? rec.status : 'ขาด';
        const h = cfg.hours;
        totalH += h;
        let weight = 0, symbol = 'ข';
        if(status === 'มา'){ symbol = '/'; weight = 1; }
        else if(status === 'ลา'){ symbol = 'ล'; weight = 0.25; }
        else if(status === 'สาย'){ symbol = 'ส'; weight = 0.5; }
        attendedH += (h * weight);
        for(let i = 1; i <= h; i++) rowData.push(symbol);
      });
      const pct = totalH > 0 ? (attendedH / totalH) * 100 : 0;
      rowData.push(totalH, attendedH, pct.toFixed(2) + '%', pct >= 80 ? 'ผ่าน' : 'มส.');
      worksheet.addRow(rowData);
    });

    // ปรับแต่งฟอนต์และการหมุน
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell, colNumber) => {
        cell.font = { name: 'TH Sarabun New', size: 14 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
        
        // หมุน Header ตั้งแต่คอลัมน์วันที่ (คอลัมน์ที่ 4 เป็นต้นไป)
        if (rowNumber === 1 && colNumber > 3) {
          cell.alignment = { textRotation: 90, vertical: 'middle', horizontal: 'center' };
          cell.font = { name: 'TH Sarabun New', size: 14, bold: true };
        }
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `รายงานเช็กชื่อ_${room}_${subj}.xlsx`);
    showToast('สำเร็จ!', 'success');

  } catch (e) { showToast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
}

// ─── INIT ──────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await _sb.auth.getSession();
  if (session) {
    isAdmin = true; currentUser = session.user;
    $('cfg-dot').className = 'cfg-dot ok';
    $('nav-logout').style.display = 'flex';
    await initAdmin();
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  $('page-status').classList.add('active');
  $('nav-status').classList.add('active');
  $('st-id-inp').addEventListener('keydown', e => { if (e.key === 'Enter') searchStatus(); });
});
