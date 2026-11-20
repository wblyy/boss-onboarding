/* ===== 回血 · 找工作 · 微信 H5 =====
   和桌面端同一套判断：先匹配，再开口。手机上没有两条并行的道，
   所以一次只跑一件——但列表始终按「卡住的在最上面」排。

   状态机（每件）：
     queue → run → [wait] → settle → done
                    └ wait：gate 不是 auto 时，跑到第 3 步停下，弹底部弹层
     skip：你选了「不投了」 */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const pad = n => String(n).padStart(2, '0');
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const groupName = id => GROUPS.find(g => g.id === id)?.name || '';

const SWEEP = ['resume', 'hx', 'cm', 'sg', 'bc', 'qt', 'yl'];

const STEP_MS = 380;
const RUN_MS = 2600;
const LANES = 1;               // 手机上一条一条来，眼睛跟得上
const SPEEDS = [1, 2, 4];

const state = {
  phase: 'idle',      // idle | scanning | running | done
  speed: 1,
  found: [],
  tasks: [],
  wxPending: null,
  drafted: 0,
  copied: null
};

/* ---------- 环 ---------- */
const R = 52, LEN = 2 * Math.PI * R;
function setRing(pct) {
  const el = $('#hrFill');
  el.style.strokeDasharray = LEN.toFixed(2);
  el.style.strokeDashoffset = (LEN * (1 - Math.max(0, Math.min(1, pct)))).toFixed(2);
}

/* ---------- 扫描 ---------- */
function startScan() {
  state.phase = 'scanning';
  state.found = [];
  state.tasks = [];
  state.wxPending = null;
  state.drafted = 0;

  $('#list').hidden = true;
  $('#handoff').hidden = true;
  $('#ticker').hidden = true;
  $('#rows').innerHTML = '';
  $('#hoList').innerHTML = '';
  $('#tally').hidden = false;

  $('#hUnit').textContent = '正在读';
  $('#hNum').textContent = `0/${SWEEP.length}`;
  setRing(0);
  $('#kicker').textContent = '只读，什么都没动';
  $('#h1').innerHTML = '正在读简历，<br>再扫今天的岗位。';
  $('#sub').textContent = '先看你有什么，再看今天在招的，然后两边对一对。这一步不改任何东西。';
  setBtn(true, '正在读…', '只看不改');
  $('#barNote').textContent = '只读，不发任何消息';
  mainToTop();

  let i = 0;
  const step = () => {
    const id = SWEEP[i];
    setRing((i + 1) / SWEEP.length);
    $('#hNum').textContent = `${i + 1}/${SWEEP.length}`;
    const o = foundOf(id);
    $('#sub').textContent = o ? `正在看：${o.name}` : '正在读简历，4 段经历';
    if (i + 1 < SWEEP.length) { i++; setTimeout(step, STEP_MS); }
    else setTimeout(finishScan, 460);
  };
  setTimeout(step, 240);
}

function finishScan() {
  state.found = SWEEP.map(foundOf).filter(Boolean);
  const usable = state.found.filter(o => o.group !== 'skip');
  const closeN = state.found.filter(o => o.group === 'close').length;

  $('#hNum').textContent = String(usable.length);
  $('#hUnit').textContent = '个可开口';
  $('#kicker').textContent = '读完了，下面逐个对';
  $('#h1').innerHTML = `${usable.length} 个岗对得上，<br>其中 ${closeN} 个很合适。`;
  $('#sub').textContent = '扫了 47 个在招的，砍掉 38 个。每个留下的都列三条：硬条件、经历、对方最近有没有在用人。';
  $('#barNote').textContent = '分数是判断顺序，不是录用概率';

  renderRows();
  $('#list').hidden = false;
  syncTally();
  setTimeout(startRun, 620);
}

/* ---------- 执行 ---------- */
function startRun() {
  state.phase = 'running';
  state.tasks = state.found.map(o => ({
    o, phase: 'queue', p: 0, log: '', resumeAt: 0, doneAt: null,
    settled: false, answered: false, said: null, handed: false, skip: false
  }));

  $('#ticker').hidden = false;
  $('#h1').innerHTML = '一个岗一个岗对，<br>对上了再写第一句。';
  $('#sub').textContent = '硬条件、经历、对方动向，三条都摊开给你看。需要你确认的会跳到最上面。';
  $('#kicker').textContent = '正在写';
  setBtn(true, '正在写…', '一个岗一句话');

  const tick = () => {
    let done = 0, busy = 0;
    state.tasks.forEach(t => { if (t.phase === 'run') busy++; });

    if (busy < LANES) {
      const next = state.tasks.find(t => t.phase === 'queue');
      if (next) { next.phase = 'run'; next.resumeAt = performance.now(); }
    }

    const now = performance.now();
    state.tasks.forEach(t => {
      if (t.phase === 'done' || t.phase === 'skip') { done++; return; }

      if (t.phase === 'run') {
        t.p = Math.min(1, (now - t.resumeAt) / (RUN_MS / state.speed));
        const cap = (t.o.gate !== 'auto' && !t.answered) ? 0.6 : 1;
        if (t.p >= cap && cap < 1) {
          t.p = 0.6; t.phase = 'wait';
          openHandoff(t);
        } else if (t.p >= 1) {
          t.phase = 'settle';
          t.doneAt = new Date();
          setTimeout(() => {
            if (t.phase !== 'settle') return;
            t.phase = 'done';
            if (!t.skip) state.drafted++;
            paintRows(); syncTally();
            if (state.tasks.every(x => x.phase === 'done' || x.phase === 'skip')) finishRun();
          }, 700 / state.speed);
        }
        updateLog(t);
        return;
      }

      if (t.phase === 'settle') done += 0;
    });

    paintRows(); sortRows(); syncTally(); renderTicker();
    if (done === state.tasks.length) { finishRun(); return; }
    setTimeout(tick, 110);
  };
  setTimeout(tick, 60);
}

function updateLog(t) {
  const idx = Math.min(4, Math.floor(t.p * 5));
  const subs = t.o.steps[idx][1];
  const sub = Math.min(subs.length - 1, Math.floor((t.p * 5 - idx) * subs.length));
  t.log = `${idx + 1}/5 ${t.o.steps[idx][0]} · ${subs[sub]}`;
}

/* ---------- 要你回一句 ---------- */
function openHandoff(t) {
  if (t.handed) return;
  t.handed = true;
  t.wxAt = hhmm(new Date());
  renderHandoff();
  if (!state.wxPending) {
    state.wxPending = t;
    showSheet(t);
    toast('有一件要你回一句');
  }
}

function answer(t, opt) {
  t.answered = true;
  t.said = opt.label;

  if (opt.value === 'skip') {
    t.skip = true; t.phase = 'skip';
    renderHandoff(); paintRows(); syncTally();
    toast('好，这件不办了');
    const rest = state.tasks.filter(x => x.phase !== 'done' && x.phase !== 'skip');
    if (!rest.length) finishRun();
  } else {
    t.phase = 'run';
    t.resumeAt = performance.now() - (RUN_MS / state.speed) * 0.6;
    renderHandoff(); paintRows();
    toast('收到，接着写');
  }

  const next = state.tasks.find(x => x.phase === 'wait' && x !== t);
  state.wxPending = next || null;
  if (next) setTimeout(() => { showSheet(next); }, 500);
  else closeSheet();
}

function renderHandoff() {
  const list = state.tasks.filter(t => t.handed && t.phase !== 'done');
  const el = $('#handoff');
  if (!list.length) { el.hidden = true; return; }
  el.hidden = false;
  $('#hoCount').textContent = String(list.filter(t => t.phase === 'wait').length);
  $('#hoList').innerHTML = list.map(t => {
    const answered = t.answered && !t.skip;
    const skipped = t.skip;
    return `<div class="ho ${answered ? 'answered' : ''}">
      <div class="ho-txt">
        <div class="ho-t">${t.o.hand.title}</div>
        <div class="ho-n">${t.o.hand.need}${t.said ? ` · <b>你回了「${t.said}」</b>` : ''}</div>
      </div>
      <button class="ho-act" type="button" data-ho="${t.o.id}"
        ${answered || skipped ? 'disabled' : ''}>
        ${skipped ? '已跳过' : answered ? '已收到' : '回一句'}
      </button>
    </div>`;
  }).join('');
  $$('[data-ho]').forEach(b => {
    b.onclick = () => {
      const t = state.tasks.find(x => x.o.id === b.dataset.ho);
      if (t && t.phase === 'wait') showSheet(t);
    };
  });
}

function showSheet(t) {
  state.sheetFor = t;
  const h = t.o.hand;
  $('#shT').textContent = h.title;
  $('#shN').textContent = h.need;
  $('#shOpts').innerHTML = h.opts.map((o, i) =>
    `<button class="sh-opt" data-opt="${i}" type="button">${o.label}</button>`).join('');
  $$('[data-opt]').forEach(b => {
    b.onclick = () => answer(t, h.opts[+b.dataset.opt]);
  });
  $('#sheet').hidden = false;
}

function closeSheet() {
  $('#sheet').hidden = true;
  state.sheetFor = null;
}

function finishRun() {
  if (state.phase === 'done') return;
  state.phase = 'done';
  const doneN = state.tasks.filter(t => t.phase === 'done').length;
  const skipped = state.tasks.filter(t => t.skip).length;

  $('#ticker').hidden = true;
  setRing(1);
  $('.hero-ring').classList.add('done');
  $('#hNum').textContent = String(doneN);
  $('#hUnit').textContent = '句写好了';
  $('#kicker').textContent = `${new Date().getMonth() + 1} 月 ${new Date().getDate()} 日 · 已写完`;
  $('#h1').innerHTML = `${doneN} 句话写好了，<br>你挑一句发。`;
  $('#sub').textContent = `每个岗都列了三条匹配依据${skipped ? `，${skipped} 个你跳过了` : ''}。发送键我一次都没碰。`;
  setBtn(false, '再看一遍', '明天这个点我会再看一眼谁还在招');
  $('#barNote').textContent = '这一轮话已写好，你挑一个复制走';
  paintRows(); syncTally(); renderHandoff();
  toast(`${doneN} 句话写好了`);
}

/* ---------- 匹配 ---------- */
const MATCH_LABEL = { close: '对得上', maybe: '差一点', skip: '不建议投' };
const matchLabel = o => MATCH_LABEL[o.group] || '';
const verdictCls = v =>
  v === '直接命中' || v === '对上' || v === '好' ? 'ok'
    : v === '缺口' || v === '未覆盖' || v === '无效' || v === '劝退' ? 'no'
      : 'warn';

function matchBlock(o) {
  const m = o.match;
  if (!m) return '';
  const row = ([k, verdict, note]) =>
    `<div class="mr"><span class="mr-k">${k}</span><span class="mr-v ${verdictCls(verdict)}">${verdict}</span><span class="mr-n">${note}</span></div>`;
  return `<div class="match">
    <div class="match-sec"><span class="match-t">硬条件</span>${m.hardRows.map(row).join('')}</div>
    <div class="match-sec"><span class="match-t">经历对得上</span>${m.midRows.map(row).join('')}</div>
    <div class="match-sec"><span class="match-t">信号</span>${m.sigRows.map(row).join('')}</div>
  </div>`;
}

function matchSummary(o) {
  const m = o.match;
  if (!m) return '';
  const all = [...m.hardRows, ...m.midRows, ...m.sigRows];
  const n = { ok: 0, warn: 0, no: 0 };
  all.forEach(r => n[verdictCls(r[1])]++);
  const dots = all.map(r => `<i class="${verdictCls(r[1])}"></i>`).join('');
  const tally = [];
  if (n.ok) tally.push(`${n.ok} 条对上`);
  if (n.warn) tally.push(`${n.warn} 条存疑`);
  if (n.no) tally.push(`${n.no} 条缺口`);
  return `<div class="row-sum">
    <span class="rs-dots">${dots}</span><span>${tally.join(' · ')}</span>
    <span class="rs-more">看依据</span>
  </div>`;
}

/* ---------- 渲染 ---------- */
function renderRows() {
  $('#rows').innerHTML = state.found.map(o => `
    <div class="row queue" data-row="${o.id}">
      <div class="row-head">
        <span class="row-stick"></span>
        <div class="row-q">
          <div class="row-top">
            <span class="row-name">${o.name}</span>
            <span class="row-cat">${groupName(o.group)}</span>
            <span class="row-src">${o.src}</span>
          </div>
          <div class="row-log" data-log></div>
        </div>
        <div class="row-right">
          <span class="row-amt">${o.v}</span>
          <span class="row-dest">${matchLabel(o)}</span>
          <span class="row-st" data-st>排队</span>
        </div>
      </div>
      <div class="row-why">${o.why}</div>
      ${matchSummary(o)}
      <div class="row-body">
        ${matchBlock(o)}
        <div class="row-msg">${o.msg
          ? `${o.msg}<span class="rm-ch">${o.hook}</span>
             <button class="rm-copy" type="button" data-copy="${o.id}">复制这句</button>`
          : '<i>这个岗不写话术。理由在匹配结果里。</i>'}</div>
      </div>
    </div>`).join('');

  $$('[data-row]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('[data-copy]')) return;
      el.classList.toggle('open');
    });
  });
  $$('[data-copy]').forEach(b => {
    b.onclick = e => { e.stopPropagation(); copyMsg(b.dataset.copy, b); };
  });

  const usable = state.found.filter(o => o.group !== 'skip').length;
  $('#lhN').textContent = usable;
  paintRows();
}

function paintRows() {
  state.tasks.forEach(t => {
    const el = document.querySelector(`[data-row="${t.o.id}"]`);
    if (!el) return;
    let cls = 'queue', st = '排队';
    switch (t.phase) {
      case 'run': cls = 'run'; st = `写到 ${Math.min(5, Math.floor(t.p * 5) + 1)}/5`; break;
      case 'wait': cls = 'waits'; st = '等你回一句'; break;
      case 'settle': cls = 'settle'; st = '成稿'; break;
      case 'done': cls = 'done'; st = `写好 · ${hhmm(t.doneAt || new Date())}`; break;
      case 'skip': cls = 'skip'; st = '这次不写'; break;
    }
    el.classList.remove('queue', 'run', 'waits', 'settle', 'done', 'skip', 'pinned');
    el.classList.add(cls);
    if (t.phase === 'wait') el.classList.add('pinned', 'open');
    const s = el.querySelector('[data-st]');
    if (s) s.textContent = st;
    const g = el.querySelector('[data-log]');
    if (g) g.textContent = t.phase === 'run' ? t.log
      : t.phase === 'wait' ? '停在第 3 步 · 回一句就继续'
        : t.phase === 'settle' ? '成稿了，正在核对数字' : '';
  });
}

const RANK = { wait: 0, run: 1, settle: 2, queue: 3, done: 4, skip: 5 };
function sortRows() {
  const box = $('#rows');
  const want = state.tasks.slice().sort((a, b) => RANK[a.phase] - RANK[b.phase]);
  const cur = [...box.children];
  let same = true;
  for (let i = 0; i < want.length; i++) {
    if (cur[i] !== box.querySelector(`[data-row="${want[i].o.id}"]`)) { same = false; break; }
  }
  if (same) return;
  want.forEach(t => {
    const el = box.querySelector(`[data-row="${t.o.id}"]`);
    if (el) box.appendChild(el);
  });
}

function renderTicker() {
  const run = state.tasks.find(t => t.phase === 'run');
  const wait = state.tasks.find(t => t.phase === 'wait');
  const doneN = state.tasks.filter(t => t.phase === 'done').length;
  $('#tkText').textContent = wait
    ? `${wait.o.name.split(' · ')[0]} 在等你一句话`
    : run
      ? `${run.o.name.split(' · ')[0]} · ${Math.min(5, Math.floor(run.p * 5) + 1)}/5 · ${run.log}`
      : `已写好 ${doneN} 句`;
}

function syncTally() {
  const done = state.tasks.filter(t => t.phase === 'done').length;
  const wait = state.tasks.filter(t => t.phase === 'wait').length;
  const found = state.found.filter(o => o.group !== 'skip').length;
  const set = (s, v) => { const e = $(s); if (e) e.textContent = v; };
  set('#tFound', state.phase === 'idle' ? '—' : '47');
  set('#tMatch', found || '—');
  set('#tDone', done);
  set('#tNeed', wait);
  set('#tSend', 0);          // 永远是 0——这是产品承诺
}

/* ---------- 复制 ---------- */
async function copyMsg(id, btn) {
  const o = foundOf(id);
  if (!o || !o.msg) return;
  try {
    await navigator.clipboard.writeText(o.msg);
    btn.textContent = '已复制 · 去 BOSS 粘贴';
    btn.style.color = 'var(--green)';
    btn.style.borderColor = '#B9E2D2';
    btn.style.background = 'var(--green-soft)';
    toast('复制好了，发送由你来点');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = o.msg;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    btn.textContent = '已复制';
    toast('复制好了，发送由你来点');
  }
}

/* ---------- 按钮 ---------- */
function setBtn(disabled, main, sub) {
  const b = $('#bigBtn');
  b.disabled = !!disabled;
  $('#bgMain').textContent = main;
  $('#bgSub').textContent = sub || '';
  b.classList.toggle('busy', !!disabled);
}

function mainToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- toast ---------- */
let toastTm = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTm);
  toastTm = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- 绑定 ---------- */
$('#bigBtn').onclick = () => {
  if (state.phase === 'idle') startScan();
  else if (state.phase === 'done') location.reload();
};

$$('[data-sh-close]').forEach(el => el.onclick = closeSheet);

setRing(0);
