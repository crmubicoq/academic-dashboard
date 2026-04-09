// ================================================================
// 학사일정 대시보드 - 이메일 알림 Google Apps Script
// ================================================================
// 설정 후 순서:
// 1. 이 코드 전체 복사 → script.google.com에 붙여넣기
// 2. createTrigger() 함수 실행 (트리거 1회 설정)
// 3. 배포 → 새 배포 → 웹 앱 → URL 복사
// 4. 대시보드 설정창에 URL 붙여넣기
// ================================================================

// ── 수신자 설정 ──────────────────────────────────────────────────
const CONFIG = {
  recipients : ['0606777k@ubion.co.kr', 'afs527@ubion.co.kr'],
  senderName : '학사일정 대시보드',
  senderEmail: 'ubionmarketing@gmail.com'
};

// ================================================================
// 1. 대시보드에서 데이터 수신 (POST)
// ================================================================
function doPost(e) {
  try {
    const data  = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();
    props.setProperty('eventsData', JSON.stringify(data.events || []));
    props.setProperty('lastSync',   new Date().toISOString());

    // 대시보드 버튼 클릭 시 즉시 이메일 발송
    if (data.sendNow === true) {
      sendDailyEmail();
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, count: (data.events || []).length }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ================================================================
// 2. 오늘 날짜 문자열 (YYYY-MM-DD)
// ================================================================
function getTodayStr() {
  const d   = new Date();
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatKoreanDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function daysAgo(dateStr) {
  const today  = new Date(); today.setHours(0,0,0,0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.floor((today - target) / 86400000);
}

// ================================================================
// 3. 오늘 처리할 업무 계산
// ================================================================
function calculateTasks(events, today) {
  const tasks = {
    todayExam      : [],
    todayNotice    : [], overdueNotice    : [],
    todayPaper     : [], overduePaper     : [],
    todayEncourage : [], overdueEncourage : []
  };

  events.forEach(function(exam) {
    const ct = exam.completedTypes || {};

    // 오늘 시험 일정
    if (exam.examDate === today) {
      tasks.todayExam.push({ name: exam.name, date: exam.examDate });
    }

    // 공지 업무 (D-14)
    if (exam.noticeDate && exam.noticeDate <= today && !ct.notice) {
      const t = { name: exam.noticeName || (exam.name + ' 공지'), date: exam.noticeDate };
      exam.noticeDate === today ? tasks.todayNotice.push(t) : tasks.overdueNotice.push(t);
    }

    // 시험지 생성 (D-2)
    if (exam.paperDate && exam.paperDate <= today && !ct.creation) {
      const t = { name: exam.paperName || (exam.name + ' 시험지'), date: exam.paperDate };
      exam.paperDate === today ? tasks.todayPaper.push(t) : tasks.overduePaper.push(t);
    }

    // 미응시자 독려 (D+4)
    if (exam.encourageDate && exam.encourageDate <= today && !ct.encourage) {
      const t = { name: exam.encourageName || (exam.name + ' 미응시자 독려'), date: exam.encourageDate };
      exam.encourageDate === today ? tasks.todayEncourage.push(t) : tasks.overdueEncourage.push(t);
    }
  });

  tasks.todayTotal   = tasks.todayNotice.length + tasks.todayPaper.length + tasks.todayEncourage.length;
  tasks.overdueTotal = tasks.overdueNotice.length + tasks.overduePaper.length + tasks.overdueEncourage.length;
  return tasks;
}

// ================================================================
// 4. HTML 이메일 생성
// ================================================================
function generateEmailHTML(tasks, today) {

  function badge(isOverdue, date) {
    return isOverdue
      ? '<span style="background:#FEE2E2;color:#EF4444;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">' + daysAgo(date) + '일 경과</span>'
      : '<span style="background:#D1FAE5;color:#059669;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">오늘</span>';
  }

  function rows(list, isOverdue) {
    if (!list.length) return '<tr><td colspan="2" style="padding:10px 14px;color:#9CA3AF;font-size:13px;">없음</td></tr>';
    return list.map(function(t) {
      return '<tr>'
        + '<td style="padding:9px 14px;font-size:14px;color:#111827;border-bottom:1px solid #F3F4F6;">' + t.name + '</td>'
        + '<td style="padding:9px 14px;text-align:right;border-bottom:1px solid #F3F4F6;white-space:nowrap;">' + badge(isOverdue, t.date) + '</td>'
        + '</tr>';
    }).join('');
  }

  function section(icon, title, color, list, isOverdue) {
    if (!list.length) return '';
    return '<div style="margin-bottom:20px;">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">'
      + '<span style="font-size:16px;">' + icon + '</span>'
      + '<span style="font-size:14px;font-weight:700;color:' + color + ';">' + title + '</span>'
      + '<span style="background:' + color + '22;color:' + color + ';padding:2px 10px;border-radius:10px;font-size:12px;font-weight:600;">' + list.length + '건</span>'
      + '</div>'
      + '<table style="width:100%;border-collapse:collapse;background:#F9FAFB;border-radius:8px;overflow:hidden;">'
      + rows(list, isOverdue)
      + '</table></div>';
  }

  const examBanner = tasks.todayExam.length
    ? '<div style="margin-bottom:20px;padding:12px 16px;background:#DBEAFE;border-radius:8px;border-left:4px solid #3B82F6;">'
      + '<span style="font-size:13px;font-weight:600;color:#1D4ED8;">📅 오늘 시험: '
      + tasks.todayExam.map(function(t){ return t.name; }).join(', ')
      + '</span></div>'
    : '';

  const noWork = (!tasks.todayTotal && !tasks.overdueTotal)
    ? '<div style="text-align:center;padding:48px 0;color:#9CA3AF;">'
      + '<div style="font-size:36px;margin-bottom:12px;">✅</div>'
      + '<div style="font-size:15px;font-weight:600;">오늘 처리할 업무가 없습니다</div></div>'
    : '';

  const todayBlock  = section('📢','공지 업무','#F59E0B', tasks.todayNotice,    false)
                    + section('📄','시험지 생성','#10B981', tasks.todayPaper,     false)
                    + section('📣','미응시자 독려','#EA580C', tasks.todayEncourage, false);

  const overdueBlock = tasks.overdueTotal
    ? '<div style="margin-top:8px;padding-top:20px;border-top:2px dashed #FEE2E2;">'
      + '<div style="font-size:13px;font-weight:700;color:#EF4444;margin-bottom:16px;">⚠️ 미처리 업무 (' + tasks.overdueTotal + '건)</div>'
      + section('','공지 미처리','#EF4444',  tasks.overdueNotice,    true)
      + section('','시험지 미처리','#EF4444', tasks.overduePaper,     true)
      + section('','독려 미처리','#EF4444',   tasks.overdueEncourage, true)
      + '</div>'
    : '';

  return '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F0F2F5;'
    + 'font-family:-apple-system,BlinkMacSystemFont,sans-serif;">'
    + '<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;'
    + 'overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">'

    // 헤더
    + '<div style="background:linear-gradient(135deg,#3B82F6,#1D4ED8);padding:28px 32px;">'
    + '<div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:6px;">📋 학사일정 업무 알림</div>'
    + '<div style="font-size:14px;color:rgba(255,255,255,0.85);">' + formatKoreanDate(today) + ' 기준 오늘의 처리 업무</div>'
    + '</div>'

    // 요약 배지
    + '<div style="padding:14px 32px;background:#F8FAFC;border-bottom:1px solid #E5E7EB;display:flex;gap:10px;flex-wrap:wrap;">'
    + '<span style="background:#DBEAFE;color:#1D4ED8;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:600;">오늘 ' + tasks.todayTotal + '건</span>'
    + (tasks.overdueTotal ? '<span style="background:#FEE2E2;color:#EF4444;padding:5px 14px;border-radius:20px;font-size:13px;font-weight:600;">미처리 ' + tasks.overdueTotal + '건</span>' : '')
    + '</div>'

    // 본문
    + '<div style="padding:28px 32px;">'
    + noWork + examBanner + todayBlock + overdueBlock
    + '</div>'

    // 푸터
    + '<div style="padding:16px 32px;background:#F8FAFC;border-top:1px solid #E5E7EB;text-align:center;">'
    + '<div style="font-size:12px;color:#9CA3AF;">이 메일은 학사일정 관리 대시보드에서 자동 발송됩니다</div>'
    + '</div>'
    + '</div></body></html>';
}

// ================================================================
// 5. 이메일 발송 (매일 트리거 + 수동 테스트)
// ================================================================
function sendDailyEmail() {
  const props      = PropertiesService.getScriptProperties();
  const eventsData = props.getProperty('eventsData');

  if (!eventsData) {
    Logger.log('⚠️ 저장된 데이터 없음 - 대시보드를 먼저 한 번 열어주세요');
    return;
  }

  const events = JSON.parse(eventsData);
  const today  = getTodayStr();
  const tasks  = calculateTasks(events, today);

  // 업무 없어도 이메일 발송 (수신자가 확인할 수 있도록)

  const subject  = '[학사일정] 📋 오늘의 업무 알림 (' + formatKoreanDate(today) + ')';
  const htmlBody = generateEmailHTML(tasks, today);

  CONFIG.recipients.forEach(function(recipient) {
    GmailApp.sendEmail(recipient, subject, '※ HTML 이메일을 지원하는 메일앱에서 확인하세요.', {
      htmlBody : htmlBody,
      name     : CONFIG.senderName,
      replyTo  : CONFIG.senderEmail
    });
  });

  Logger.log('✅ 이메일 발송 완료 → ' + CONFIG.recipients.join(', '));
}

// ================================================================
// 6. 트리거 설정 (최초 1회만 실행하세요)
// ================================================================
function createTrigger() {
  // 기존 트리거 전체 삭제
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });

  // 매일 오후 1시 자동 발송
  ScriptApp.newTrigger('sendDailyEmail')
    .timeBased()
    .everyDays(1)
    .atHour(13)   // 오후 1시 (24시간 기준)
    .create();

  Logger.log('✅ 트리거 설정 완료 - 매일 오후 1시 자동 발송');
}

// ================================================================
// 7. 테스트 (지금 바로 이메일 발송)
// ================================================================
function testEmail() {
  sendDailyEmail();
}
