/* ===== 回血 · 找工作 =====
   一进来只有一个按钮。按下去：先把简历读一遍（只读），把今天该开口的岗位挑出来，
   然后一个岗一个岗写第一句话。
   有些岗需要你补一个只有你知道的事实，挂起，推一条到微信，你回一句就行。

   状态机（每件）：
     queue → run → [wait] → settle → done
                    └ wait：gate 不是 auto 时，跑到第 3 步挂起
     skip：你在微信里选了「不办」

   和「省钱」那栏的区别：这里最后一步永远是「你点发送」。我不替你按。 */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const pad = n => String(n).padStart(2, '0');
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const hhmmss = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const groupName = id => GROUPS.find(g => g.id === id)?.name || '';

const SWEEP = [
  ['陈默_B端产品_2026.pdf', '读简历 · 4 段经历', 'resume'],
  ['恒犀科技', 'B端产品经理 · 18-25k', 'hx'],
  ['蝉鸣数据', '流程产品经理 · 20-28k', 'cm'],
  ['拾光教育', '产品经理 · 16-22k', 'sg'],
  ['北辰供应链', '产品运营 · 17-23k', 'bc'],
  ['青藤医疗', '产品经理 · 19-26k', 'qt'],
  ['云澜科技', '高级总监 · 35-50k', 'yl'],
  ['47 个在招岗位', '按回复概率排序', null]
];

const STEP_MS = 520;
const RUN_MS = 3200;
const LANES = 2;
const SPEEDS = [1, 2, 4];

const state = {
  phase: 'idle',      // idle | scanning | running | done
  speed: 1,
  found: [],
  tasks: [],
  scanIdx: 0,
  wxPending: null,
  wxLog: [],
  drafted: 0,
  skippedCount: 0,
  feed: []            // 执行记录：每一步做了什么，都留痕
};

/* ---------- 执行记录 ---------- */
function feedPush(kind, text, meta) {
  state.feed.push({ kind, text, meta: meta || '', at: hhmm(new Date()) });
  renderFeed();
}
function renderFeed() {
  const box = $('#fdBody');
  if (!box) return;
  box.innerHTML = state.feed.map(f =>
    `<div class="fd fd-${f.kind}">
       <span class="fd-at">${f.at}</span>
       <span class="fd-t">${f.text}</span>
       ${f.meta ? `<span class="fd-m">${f.meta}</span>` : ''}
     </div>`).join('');
  const c = $('#fdCount');
  if (c) c.textContent = `${state.feed.length} 步`;
  box.scrollTop = box.scrollHeight;
}


/* ---------- 环形进度 ---------- */
const R = 104, LEN = 2 * Math.PI * R;
function setRing(pct) {
  const el = $('#dFill');
  el.style.strokeDasharray = LEN.toFixed(2);
  el.style.strokeDashoffset = (LEN * (1 - Math.max(0, Math.min(1, pct)))).toFixed(2);
}

/* ---------- 扫描 ---------- */
function startScan() {
  state.phase = 'scanning';
  state.found = []; state.tasks = []; state.scanIdx = 0;
  state.wxPending = null; state.wxLog = [];
  state.drafted = 0; state.skippedCount = 0;
  state.feed = [];

  $('#listsec').hidden = true;
  $('#handoff').hidden = true;
  $('#wrapup').hidden = true;
  $('#feed').hidden = false;
  $('#rows').innerHTML = '';
  $('#hoList').innerHTML = '';
  renderFeed();
  feedPush('resume', '读到简历，4 段经历', '教育科技 2 年 · 每段都有可核对的细节');

  $('#dUnit').textContent = '正在读';
  $('#dNum').className = 'd-num sm';
  $('#dNum').textContent = `0 / ${SWEEP.length}`;
  setRing(0);
  $('#dial').className = 'dial busy';
  $('#stPhase').textContent = '正在读';
  $('#stPhase').className = 'sl-st live';
  $('#kicker').textContent = '只读，什么都没动';
  $('#h1').innerHTML = '正在读简历，<br>再扫今天的岗位。';
  $('#h1sub').textContent = '先看你有什么，再看今天在招的，然后两边的对一对。这一步不改任何东西，也不动你的账号。';
  setBtn(true, '正在读…', '只看不改');
  $('#ctaNote').textContent = '只读，不发任何消息';

  let i = 0;
  const step = () => {
    const [name, desc] = SWEEP[i];
    state.scanIdx = i + 1;
    $('#dNum').textContent = `${i + 1} / ${SWEEP.length}`;
    setRing((i + 1) / SWEEP.length);
    $('#h1sub').textContent = `${name}：${desc}`;
    $('#ctaNote').textContent = `${i + 1} / ${SWEEP.length} 处已翻完`;
    // 每扫到一跳，先在预览格里点亮
    if (SWEEP[i][2]) markPreview(SWEEP[i][2], 'scanning');
    const o = SWEEP[i][2] ? foundOf(SWEEP[i][2]) : null;
    if (o) {
      const kept = o.group !== 'skip';
      feedPush(
        kept ? 'keep' : 'drop',
        `${o.name.split(' · ')[0]} · ${o.name.split(' · ')[1] || ''}`,
        kept
          ? `${MATCH_LABEL[o.group]} · 对 ${o.v}${o.gate !== 'auto' ? ' · 要你定' : ''}`
          : `${MATCH_LABEL[o.group]} · 对 ${o.v} · 不占你的时间`
      );
    }
    if (i + 1 < SWEEP.length) { i++; setTimeout(step, STEP_MS); }
    else setTimeout(finishScan, 520);
  };
  setTimeout(step, 260);
}

function markPreview(id, mode) {
  const el = document.querySelector(`[data-pv="${id}"]`);
  if (!el) return;
  if (mode === 'scanning') el.classList.add('pv-scan');
  if (mode === 'found') { el.classList.remove('pv-scan'); el.classList.add('pv-found'); }
  if (mode === 'done') { el.classList.add('done'); }
}

function finishScan() {
  state.found = SWEEP.map(([, , id]) => id).filter(Boolean).map(foundOf).filter(Boolean);

  $('#dial').className = 'dial';
  $('#dUnit').textContent = '个可开口';
  $('#dNum').className = 'd-num';
  $('#dNum').textContent = String(state.found.filter(o => o.group !== 'skip').length);
  setRing(1);
  $('#stPhase').textContent = '读完了';
  $('#stPhase').className = 'sl-st';
  const usable = state.found.filter(o => o.group !== 'skip');
  const closeN = state.found.filter(o => o.group === 'close').length;
  $('#kicker').textContent = '读完了，下面逐个对';
  $('#h1').innerHTML = `${usable.length} 个岗对得上，<br>其中 ${closeN} 个很合适。`;
  $('#h1sub').textContent = '扫了 47 个在招的岗位，砍掉 38 个。每个留下的都列了三条：硬条件够不够、经历对不对得上、对方最近有没有在用人。';
  $('#ctaNote').textContent = '分数是判断顺序，不是录用概率。点开每个岗能看到分怎么来的。';

  feedPush('sum', `扫了 47 个，留下 ${usable.length} 个`, `砍掉 ${47 - usable.length} 个 · 3 个要你定`);

  renderPreviewAll(true);
  const tip = $('#railTip');
  if (tip) tip.textContent = `对上 ${state.found.filter(o => o.group !== 'skip').length} 个`;
  renderRows();
  $('#listsec').hidden = false;
  syncMini();

  setTimeout(startRun, 800);
}

/* 还没翻之前：只列出池子里有谁，不给分——分是翻完之后才有的东西 */
function renderPreviewAll(scanned = false) {
  const grid = $('#pvGrid');
  if (!grid) return;
  grid.innerHTML = SWEEP.filter(s => s[2]).map(([n, t, id]) => {
    const o = foundOf(id);
    if (!scanned) {
      const label = o ? o.name.split(' · ')[0] : '简历';
      return `<div class="pv" data-pv="${id}">
        <div class="pv-n">${label}</div>
        <div class="pv-t">${o ? o.src.split(' · ')[0] : 'PDF'}</div>
        <div class="pv-num on">待对</div>
      </div>`;
    }
    const skip = o && o.group === 'skip';
    return `<div class="pv ${skip ? 'pv-exp' : ''}" data-pv="${id}">
      <div class="pv-n">${o ? o.name.split(' · ')[0] : '简历'}</div>
      <div class="pv-t">${o ? (o.src.split(' · ')[0] || t) : '已读'}</div>
      <div class="pv-num">${o ? (skip ? '跳过' : o.v + ' 分') : '4 段'}</div>
    </div>`;
  }).join('');
}

/* ---------- 执行 ---------- */
/* 执行顺序：先让它自己写完几个，再按 1 判断 → 2 方向 → 3 缺口 逐个问；
   依赖前面答案的岗（carryFrom）排在那个答案之后 */
function executionOrder(found) {
  const plain = found.filter(o => !o.stage && !o.carryFrom);
  const asks = found.filter(o => o.stage && !o.carryFrom).sort((a, b) => a.order - b.order);
  const carried = found.filter(o => o.carryFrom);
  return [...plain, ...asks, ...carried];
}

function startRun() {
  state.phase = 'running';
  state.tasks = executionOrder(state.found).map(o => ({
    o, phase: 'queue', p: 0, log: '', startAt: 0, resumeAt: 0,
    doneAt: null, settleAt: 0, arrivedAt: null, answered: false,
    said: null, handed: false, skip: false
  }));

  $('#stPhase').textContent = '正在写';
  $('#stPhase').className = 'sl-st live';
  $('#h1').innerHTML = '一个岗一个岗对，<br>对上了再写第一句。';
  $('#h1sub').textContent = '硬条件、经历、对方动向，三条都摊开给你看。需要你确认的会挂到最上面。';
  setBtn(true, '正在写…', '一个岗一句话');
  renderRows();

  const tick = () => {
    const now = performance.now();
    let live = 0, waiting = 0, done = 0;

    let busy = state.tasks.filter(t => t.phase === 'run').length;
    if (busy < LANES) {
      for (const t of state.tasks) {
        if (busy >= LANES) break;
        if (t.phase !== 'queue') continue;
        // 要你拍板的岗一件一件问，别两件同时卡在微信里
        const isAsk = t.o.gate !== 'auto' && !t.answered;
        if (isAsk && state.tasks.some(x => x.phase === 'wait')) continue;
        t.phase = 'run'; t.resumeAt = now; busy++;
        feedPush('run', `写 ${t.o.name.split(' · ')[0]}`, t.o.how);
      }
    }

    state.tasks.forEach(t => {
      if (t.phase === 'done' || t.phase === 'skip') { done++; return; }

      if (t.phase === 'run') {
        const el = (now - t.resumeAt) / (RUN_MS / state.speed);
        const cap = (t.o.gate !== 'auto' && !t.answered) ? 0.6 : 1;
        t.p = Math.min(1, el);

        if (t.p >= cap) {
          if (cap < 1) {
            t.p = 0.6; t.phase = 'wait';
            openHandoff(t);
          } else if (t.p >= 1) {
            t.phase = 'settle';
            t.doneAt = new Date();
            t.settleAt = now + 900 / state.speed;
          }
        }
        updateLog(t);
        if (t.phase === 'run') live++;
        if (t.phase === 'wait') waiting++;
        return;
      }

      if (t.phase === 'wait') { waiting++; return; }

      if (t.phase === 'settle') {
        if (now >= t.settleAt) { t.phase = 'done'; t.arrivedAt = new Date(); settle(t); }
        else live++;
      }
    });

    paintRows();
    sortRows();
    syncMini();
    syncDial(done);
    if (done === state.tasks.length) { finishRun(); return; }
    setTimeout(tick, 120);
  };
  setTimeout(tick, 80);
}

function updateLog(t) {
  const idx = Math.min(4, Math.floor(t.p * 5));
  const [name, subs] = t.o.steps[idx];
  const sub = Math.min(subs.length - 1, Math.floor((t.p * 5 - idx) * subs.length));
  t.log = `${idx + 1}/5 ${name} · ${subs[sub]}`;
}

/* 「缺口怎么认」只问一次：选了哪种接法，后面同类缺口照这个写 */
function syncCarried(t, opt) {
  if (opt.value !== 'go') return;
  const idx = t.o.hand.opts.indexOf(opt);
  if (idx < 0) return;
  state.tasks.filter(x => x.o.carryFrom === t.o.id).forEach(x => {
    if (!Array.isArray(x.o.msgByOpt) || !x.o.msgByOpt[idx]) return;
    x.o.msg = x.o.msgByOpt[idx];
    if (opt.carry) x.o.hook = opt.carry;
    paintRowMsg(x.o.id);
  });
}

function paintRowMsg(id) {
  const o = foundOf(id);
  if (!o) return;
  const mbox = document.querySelector(`[data-row="${id}"] .row-msg`);
  if (!mbox) return;
  mbox.dataset.key = '';
  mbox.innerHTML = msgHTML(o);
}

function openHandoff(t) {
  if (t.handed) return;
  t.handed = true;
  const h = t.o.hand;
  pushWx({ from: 'agent', step: h.step, title: '需要你回一句', text: h.title });
  t.wxMsgAt = hhmmss(new Date());
  renderHandoff();
  toast(`有一件要你确认 · ${h.title}`);
  if (!state.wxPending) state.wxPending = t;
}

function answer(t, opt) {
  t.answered = true;
  t.said = opt.label;
  pushWx({ from: 'me', text: opt.label });

  // 你选的是哪种讲法，成稿就换成哪一版
  if (opt.msg) { t.o.msg = opt.msg; paintRowMsg(t.o.id); }
  syncCarried(t, opt);

  if (opt.value === 'skip') {
    t.skip = true; t.phase = 'skip';
    state.skippedCount++;
    feedPush('skip', `放下 ${t.o.name.split(' · ')[0]}`, `你选的：${opt.label}`);
    pushWx({ from: 'agent', text: opt.reply || '好，这件我不动了。' });
    markPreview(t.o.id, 'done');
    paintRows(); renderHandoff(); syncMini();
    const rest = state.tasks.filter(x => x.phase !== 'done' && x.phase !== 'skip').length;
    if (!rest) finishRun();
    return;
  }

  feedPush('pick', `你定了：${opt.label}`, `${t.o.hand.step} · ${t.o.name.split(' · ')[0]}`);
  pushWx({ from: 'agent', text: opt.reply || '收到，接着写。' });
  t.phase = 'run';
  t.resumeAt = performance.now() - (RUN_MS / state.speed) * 0.6;
  if (t.p < 0.6) t.p = 0.6;
  paintRows(); renderHandoff(); syncMini();

  const next = state.tasks.find(x => x.phase === 'wait');
  state.wxPending = next || null;
  if (next) setTimeout(() => renderWxInput(), 420);
  else setTimeout(closeWx, 700);
}

function settle(t) {
  if (!t.skip) {
    state.drafted++;
    feedPush('done', `写好 ${t.o.name.split(' · ')[0]}`, `第 1 句 · ${(t.o.msg || '').length} 字`);
  }
  markPreview(t.o.id, 'done');
  if (state.wxPending === t) state.wxPending = null;
}

const draftedCount = () => state.tasks.filter(t => t.arrivedAt).length;

function finishRun() {
  if (state.phase === 'done') return;
  state.phase = 'done';
  const doneN = state.tasks.filter(t => t.phase === 'done').length;
  const skipped = state.tasks.filter(t => t.skip);

  paintRows();
  $('#dial').className = 'dial done';
  setRing(1);
  $('#dNum').className = 'd-num';
  $('#dNum').textContent = String(doneN);
  $('#dUnit').textContent = '个岗对上了';

  $('#stPhase').textContent = '这一轮写完了';
  $('#stPhase').className = 'sl-st';
  $('#kicker').textContent = `${new Date().getMonth() + 1} 月 ${new Date().getDate()} 日 · 已写完`;
  $('#h1').innerHTML = `${doneN} 个岗对完了，<br>话也写好了。`;
  const parts = [`每个岗都列了三条匹配依据`];
  if (skipped.length) parts.push(`${skipped.length} 个你跳过了`);
  parts.push('发送键我一次都没碰');
  $('#h1sub').textContent = parts.join('。') + '。';
  setBtn(false, '再看一遍', '明天这个点我会再看一眼谁还在招');
  $('#ctaNote').textContent = `这一轮共 ${state.tasks.length} 个岗，${doneN} 句写好。明天早上我会再看一眼谁还在招。`;
  feedPush('end', '这一轮跑完', `${doneN} 句写好了 · 发送键 0 次`);
  syncMini();
  renderHandoff();
  renderWrapup();
  toast(`写完了 · ${doneN} 句话`);
}


/* ---------- 匹配：分数从哪来，逐条摊开 ---------- */
const MATCH_LABEL = { close: '对得上', maybe: '差一点', skip: '不建议投' };
const matchLabel = o => MATCH_LABEL[o.group] || '';

const verdictCls = v =>
  v === '直接命中' || v === '对上' || v === '好' ? 'ok'
    : v === '缺口' || v === '未覆盖' || v === '无效' || v === '劝退' ? 'no'
      : 'warn';

function matchBlock(o) {
  const m = o.match;
  if (!m) return '';
  const row = ([k, verdict, note]) => {
    const cls = verdictCls(verdict);
    return `<div class="mr"><span class="mr-k">${k}</span><span class="mr-v ${cls}">${verdict}</span><span class="mr-n">${note}</span></div>`;
  };
  return `<div class="match">
    <div class="match-sec"><span class="match-t">硬条件</span>${m.hardRows.map(row).join('')}</div>
    <div class="match-sec"><span class="match-t">经历对得上</span>${m.midRows.map(row).join('')}</div>
    <div class="match-sec"><span class="match-t">信号</span>${m.sigRows.map(row).join('')}</div>
  </div>`;
}

// 折叠时那一行：几条对上、几条存疑、几条缺口
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
    <span class="rs-dots">${dots}</span>
    <span>${tally.join(' · ')}</span>
    <span class="rs-more">看依据</span>
  </div>`;
}

/* ---------- 渲染 ---------- */
// 成稿区：等你定的岗先写「在等你定」，定了再换成实际的句子
function msgHTML(o) {
  if (o.msg) return `<span data-msg>${o.msg}</span><span class="rm-ch" data-hook>${o.hook}</span>`;
  const t = state.tasks.find(x => x.o.id === o.id);
  if (t && t.phase === 'wait') return '<i data-pending>在等你定，定了我接着写完这句。</i>';
  return '<i>这个岗不写话术。理由在匹配结果里。</i>';
}

function renderRows() {
  $('#rows').innerHTML = state.found.map((o, i) => `
    <div class="row queue" data-row="${o.id}" style="animation-delay:${i * 55}ms">
      <span class="row-stick"></span>
      <div class="row-main">
        <div class="row-top">
          <span class="row-name">${o.name}</span>
          <span class="row-cat">${groupName(o.group)}</span>
          <span class="row-src">${o.src}</span>
        </div>
        <div class="row-why">${o.why}</div>
        <div class="row-log" data-log></div>
        ${matchSummary(o)}
        ${matchBlock(o)}
        <div class="row-msg">${msgHTML(o)}</div>
      </div>
      <div class="row-right">
        <span class="row-amt">${o.v}</span>
        <span class="row-dest">${matchLabel(o)}</span>
        <span class="row-st" data-st>排队</span>
      </div>
    </div>`).join('');

  // 点一下就展开/收起；正在跑或在等你的那条不收起，免得看不到进度
  $$('[data-row]').forEach(el => {
    el.onclick = e => {
      if (e.target.closest('[data-ho-btn]')) return;
      el.classList.toggle('open');
    };
  });

  const usable = state.found.filter(o => o.group !== 'skip');
  $('#lhTitle').innerHTML = `扫了 <b>47</b> 个，对得上 <b>${usable.length}</b> 个`;
  $('#lhMeta').textContent = `按匹配度排，不按薪资排`;
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
      case 'done': cls = 'done'; st = `写好了 · ${hhmm(t.arrivedAt)}`; break;
      case 'skip': cls = 'skip'; st = '这次不写'; break;
    }
    el.classList.remove('queue', 'run', 'waits', 'settle', 'done', 'skip', 'pinned', 'flash');
    el.classList.add(cls);
    // 卡住等你回的那条自动摊开：你看得出它卡在哪一条上
    if (t.phase === 'wait') el.classList.add('pinned', 'open');
    const stEl = el.querySelector('[data-st]');
    if (stEl) stEl.textContent = st;
    // 成稿区跟着状态走；用 key 比对，别每 120ms 重写一次
    const mbox = el.querySelector('.row-msg');
    if (mbox) {
      const key = `${t.o.msg ? t.o.msg.length + '|' + t.o.msg.slice(0, 10) + '|' + t.o.hook : ''}|${t.phase === 'wait'}`;
      if (mbox.dataset.key !== key) {
        mbox.dataset.key = key;
        mbox.innerHTML = msgHTML(t.o);
      }
    }
    const lg = el.querySelector('[data-log]');
    if (lg) lg.textContent = t.phase === 'run' ? t.log
      : t.phase === 'wait' ? '已停在第 3 步 · 微信里回一句就继续'
        : t.phase === 'settle' ? '成稿了，正在核对数字' : '';
  });
}

const RANK = { wait: 0, run: 1, settle: 2, queue: 3, done: 4, skip: 5 };
function sortRows() {
  const box = $('#rows');
  const want = state.tasks.slice().sort((a, b) => (RANK[a.phase] - RANK[b.phase]) || (b.o.v - a.o.v));
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

function renderHandoff() {
  const list = state.tasks.filter(t => t.handed && !t.arrivedAt);
  const el = $('#handoff');
  if (!list.length) { el.hidden = true; return; }
  el.hidden = false;
  $('#hoCount').textContent = String(list.filter(t => t.phase === 'wait').length);
  $('#hoList').innerHTML = list.map(t => {
    const answered = t.answered && !t.skip;
    const skipped = t.skip;
    return `<div class="ho ${answered ? 'answered' : ''}" data-ho="${t.o.id}">
      <div>
        ${t.o.hand.step ? `<div class="ho-s">${t.o.hand.step}</div>` : ''}
      <div class="ho-t">${t.o.hand.title}</div>
        <div class="ho-n">${t.o.hand.need}${t.said ? ` · <b>你回了「${t.said}」</b>` : ''}</div>
      </div>
      <button class="ho-act" data-ho-btn="${t.o.id}" type="button" ${answered || skipped ? 'disabled' : ''}>
        ${skipped ? '已跳过' : answered ? '已收到' : '在微信里回'}
      </button>
    </div>`;
  }).join('');
  $$('[data-ho-btn]').forEach(b => {
    b.onclick = () => {
      const t = state.tasks.find(x => x.o.id === b.dataset.hoBtn);
      if (t) openWx(t);
    };
  });
}

/* ---------- 结果分层 ----------
   跑完给三件事：扫了多少、哪些进了候选、先投哪几个。 */
function renderWrapup() {
  const written = state.tasks.filter(t => t.phase === 'done');
  const skipped = state.tasks.filter(t => t.skip);
  const answered = state.tasks.filter(t => t.answered).length;
  const scanned = 47;
  const dropped = scanned - state.tasks.length;

  $('#wrapup').hidden = false;

  $('#wuList').innerHTML = [
    ['扫过', `${scanned} 个在招的`, '按 JD 原文 + 你的简历逐条对'],
    ['过初筛', `${state.tasks.length} 个`, `差太多、位置不对的 ${dropped} 个没进`],
    ['写好了', `${written.length} 句`, skipped.length ? `${skipped.length} 个你放下了，一句没写` : '每个过筛的都写了句，一条没漏'],
    ['要你定', `${answered} 处`, '每条判断都留了依据 · 发送键仍是 0'],
  ].map(([k, v, n], i) => `<li>
      <span class="wu-i">${i + 1}</span>
      <div><b>${k} · <em>${v}</em></b><span>${n}</span></div>
    </li>`).join('');

  const top = written.slice().sort((a, b) => b.o.v - a.o.v).slice(0, 3);
  $('#wuTop').innerHTML = top.map((t, i) => `
    <div class="wu-c" data-wu="${t.o.id}">
      <span class="wu-n">${i + 1}</span>
      <div class="wu-c-t">
        <b>${t.o.name}</b>
        <span>${t.o.src}</span>
        <p>${t.o.how}</p>
      </div>
      <span class="wu-v">${t.o.v}</span>
    </div>`).join('');
  $$('[data-wu]').forEach(el => {
    el.onclick = () => {
      const row = document.querySelector(`[data-row="${el.dataset.wu}"]`);
      if (!row) return;
      row.classList.add('open');
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  });
}

function syncMini() {
  const done = state.tasks.filter(t => t.phase === 'done').length;
  const wait = state.tasks.filter(t => t.phase === 'wait').length;
  const found = state.found.filter(o => o.group !== 'skip').length;

  const set = (sel, v) => { const e = $(sel); if (e) e.textContent = v; };
  set('#ssMatch', found || '—');
  set('#ssDone', done);
  set('#ssNeed', wait);
  set('#stTotal', found ? found + ' 个' : '—');
  set('#ssFoot', state.phase === 'done'
    ? `这一轮 ${done} 句，明天再看`
    : state.phase === 'running'
      ? `还剩 ${state.tasks.filter(t => t.phase !== 'done' && t.phase !== 'skip').length} 件`
      : '还没开始翻');
}

function syncDial(done) {
  if (state.phase !== 'running') return;
  const total = state.tasks.length;
  if (!total) return;
  $('#dNum').textContent = `${done} / ${total}`;
  setRing(done / total);
}

/* ---------- 微信 ---------- */
function pushWx(m) { state.wxLog.push({ ...m, at: new Date() }); renderWx(); }

function renderWx() {
  const chat = $('#wxChat');
  if (!chat) return;
  chat.innerHTML = state.wxLog.map(m => {
    if (m.from === 'me') return `<div class="wx-msg me"><div class="wx-avatar">我</div><div class="wx-bub">${m.text}</div></div>`;
    return `<div class="wx-msg"><div class="wx-avatar">回</div><div class="wx-bub">
      ${m.step ? `<span class="wx-s">${m.step}</span>` : ''}
      ${m.title ? `<span class="wx-t">${m.title}</span>` : ''}${m.text}</div></div>`;
  }).join('');
  chat.scrollTop = chat.scrollHeight;
}

function openWx(t) {
  $('#wx').hidden = false;
  renderWx();
  renderWxInput(t);
}

function renderWxInput(t) {
  const opts = $('#wxOpts');
  const ph = $('#wxPh');
  if (!t) { opts.innerHTML = ''; ph.textContent = '没有待回的了'; return; }
  const h = t.o.hand;
  ph.textContent = h.need;
  opts.innerHTML = h.opts.map((o, i) =>
    `<button class="wx-opt" data-opt="${i}" type="button">${o.label}</button>`).join('');
  $$('[data-opt]').forEach(b => {
    b.onclick = () => {
      const opt = h.opts[+b.dataset.opt];
      answer(t, opt);
    };
  });
}

function closeWx() { $('#wx').hidden = true; }

/* ---------- 按钮 ---------- */
function setBtn(disabled, main, sub) {
  const b = $('#bigBtn');
  b.disabled = !!disabled;
  $('#bgMain').textContent = main;
  $('#bgSub').textContent = sub || '';
  b.classList.toggle('busy', !!disabled);
}

/* ---------- toast ---------- */
let toastTm = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTm);
  toastTm = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------- 绑定 ---------- */
$('#bigBtn').onclick = () => {
  if (state.phase === 'idle') startScan();
  else if (state.phase === 'done') { location.reload(); }
};

$$('[data-wx-close]').forEach(el => el.onclick = closeWx);

$$('.tab').forEach(tab => {
  tab.onclick = () => {
    const id = tab.dataset.tab;
    $$('.tab').forEach(t => t.classList.toggle('on', t === tab));
    $('#paneJob').hidden = id !== 'job';
    $('#paneSave').hidden = id !== 'save';
    $('#paneEarn').hidden = id !== 'earn';
  };
});
$('#paneJob').hidden = false;
$('#paneSave').hidden = true;
$('#paneEarn').hidden = true;

/* 速度 */
const spBtn = $('#speed'), spVal = $('#speedVal');
let spIdx = 0;
if (spBtn) spBtn.onclick = () => {
  spIdx = (spIdx + 1) % SPEEDS.length;
  state.speed = SPEEDS[spIdx];
  spVal.textContent = state.speed + '×';
};

renderPreviewAll();
syncMini();
