(function () {
  "use strict";

  var DATA = window.EC_DATA || { lectures: [], expressions: [], sentences: [] };
  var EXP = {};
  DATA.expressions.forEach(function (e, i) { e.order = i; EXP[e.id] = e; });
  DATA.sentences.forEach(function (s, i) { s.order = i; });
  var LECTURE = {};
  DATA.lectures.forEach(function (l) { LECTURE[l.no] = l; });

  // 表現 → それを使っている例文
  var USED_IN = {};
  DATA.sentences.forEach(function (s) {
    s.exps.forEach(function (id) { (USED_IN[id] = USED_IN[id] || []).push(s); });
  });

  var KIND_LABEL = { rule: "原則", phrase: "頻出表現", note: "例題の解説", column: "コラム" };
  var INTERVALS = [0, 1, 2, 4, 8, 16, 32]; // box ごとの復習間隔（日）
  var KNOWN_BOX = 3;

  // ---------- 小物 ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function today() {
    var d = new Date();
    return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function lectureName(no) {
    var l = LECTURE[no];
    return l ? "Lecture " + l.no + " " + l.title : "";
  }
  // 英語形の [ ] ( ) を薄く、× △ を色づけ
  function formatForm(s) {
    var h = esc(s);
    h = h.replace(/\[([^\]]*)\]/g, '<span class="alt">[$1]</span>');
    h = h.replace(/(×|✕)/g, '<span class="ng">×</span>').replace(/△/g, '<span class="so">△</span>');
    return h;
  }

  // ---------- 保存（端末 + 可能ならアカウントに同期） ----------
  var LS_KEY = "ec-progress-v1";
  var LS_PREFS = "ec-prefs-v1";
  var progress = {};   // cardKey -> {b, d, n, l, t}
  var remote = null;   // {ref}
  var saveTimer = null;

  function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 保存不可の環境 */ }
  }
  function mergeProgress(a, b) {
    var out = {}, k;
    for (k in a) out[k] = a[k];
    for (k in b) if (!out[k] || (b[k].t || 0) > (out[k].t || 0)) out[k] = b[k];
    return out;
  }
  function setSyncStatus(text) { var el = $("sync-status"); if (el) el.textContent = text; }

  function scheduleSave() {
    lsSet(LS_KEY, progress);
    if (!remote) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      remote.ref.set({ cards: progress, savedAt: Date.now() }).then(function () {
        setSyncStatus("学習記録はアカウントに保存されています。別の端末でも続きから学習できます。");
      }, function () {
        setSyncStatus("学習記録をアカウントに保存できませんでした。この端末には保存されています。");
      });
    }, 1200);
  }

  function initRemote() {
    if (!window.claude || typeof window.claude.use !== "function") {
      setSyncStatus("学習記録はこの端末のブラウザに保存されます。");
      return;
    }
    Promise.all([window.claude.use("db"), window.claude.use("user")]).then(function (r) {
      var db = r[0], user = r[1];
      if (!db || !user) { setSyncStatus("学習記録はこの端末のブラウザに保存されます。"); return; }
      return user.id().then(function (uid) {
        if (!uid) { setSyncStatus("学習記録はこの端末のブラウザに保存されます。"); return; }
        var ref = db.doc("data/users/" + uid + "/progress");
        return ref.get().then(function (snap) {
          var stored = snap.exists ? (snap.data().cards || {}) : {};
          progress = mergeProgress(progress, stored);
          lsSet(LS_KEY, progress);
          remote = { ref: ref };
          setSyncStatus("学習記録はアカウントに保存されています。別の端末でも続きから学習できます。");
          renderCurrent();
        });
      });
    }).catch(function () {
      setSyncStatus("学習記録はこの端末のブラウザに保存されます。");
    });
  }

  // ---------- 設定 ----------
  var prefs = Object.assign({
    lectures: DATA.lectures.map(function (l) { return l.no; }),
    kinds: ["rule", "phrase", "note", "column"],
    newLimit: "20", order: "book", direction: "jp", senScope: "main",
  }, lsGet(LS_PREFS) || {});
  // 新しい Lecture が追加されたら範囲に含める
  var knownLectures = lsGet("ec-known-lectures") || [];
  DATA.lectures.forEach(function (l) {
    if (knownLectures.indexOf(l.no) < 0 && prefs.lectures.indexOf(l.no) < 0) prefs.lectures.push(l.no);
  });
  lsSet("ec-known-lectures", DATA.lectures.map(function (l) { return l.no; }));
  function savePrefs() { lsSet(LS_PREFS, prefs); }

  // ---------- 学習状態 ----------
  function cardKey(type, id) { return type + ":" + id; }
  function state(key) { return progress[key]; }
  function status(key) {
    var s = progress[key];
    if (!s) return "new";
    if (s.w && s.w >= today() - 7) return "weak";
    return s.b >= KNOWN_BOX ? "known" : "learning";
  }
  function grade(key, g) {
    var s = Object.assign({ b: 0, d: 0, n: 0, l: 0 }, progress[key] || {});
    var t = today();
    s.n += 1;
    if (g === "again") { s.b = 0; s.d = t; s.l += 1; s.w = t; }
    else if (g === "hard") { s.b = Math.max(1, Math.min(s.b, 2)); s.d = t + 1; }
    else { s.b = Math.min(s.b + 1, INTERVALS.length - 1); s.d = t + INTERVALS[s.b]; }
    s.t = Date.now();
    progress[key] = s;
    scheduleSave();
  }

  function expPool() {
    return DATA.expressions.filter(function (e) {
      return prefs.lectures.indexOf(e.lecture) >= 0 && prefs.kinds.indexOf(e.kind) >= 0;
    });
  }
  function senPool(scope) {
    return DATA.sentences.filter(function (s) {
      return prefs.lectures.indexOf(s.lecture) >= 0 && (scope === "all" || s.main);
    });
  }
  function counts(type, items) {
    var t = today(), c = { total: items.length, known: 0, due: 0, fresh: 0, weak: 0 };
    items.forEach(function (it) {
      var k = cardKey(type, it.id), s = progress[k];
      if (!s) { c.fresh++; return; }
      if (s.b >= KNOWN_BOX) c.known++;
      if (s.d <= t) c.due++;
      if (s.w && s.w >= t - 7) c.weak++;
    });
    return c;
  }

  // ---------- ハイライト ----------
  // spans: [[start, end, expId], ...] → 区間ごとに使われている表現の集合でまとめる
  function segments(text, spans) {
    var cuts = [0, text.length];
    spans.forEach(function (sp) { cuts.push(sp[0], sp[1]); });
    cuts = cuts.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    var out = [];
    for (var i = 0; i < cuts.length - 1; i++) {
      var a = cuts[i], b = cuts[i + 1];
      var ids = spans.filter(function (sp) { return sp[0] <= a && sp[1] >= b; })
        .map(function (sp) { return sp[2]; });
      out.push({ text: text.slice(a, b), ids: ids.filter(function (v, j, arr) { return arr.indexOf(v) === j; }) });
    }
    return out;
  }
  function primaryKind(ids) {
    var order = ["phrase", "rule", "note", "column"];
    var kinds = ids.map(function (id) { return EXP[id] ? EXP[id].kind : "note"; });
    for (var i = 0; i < order.length; i++) if (kinds.indexOf(order[i]) >= 0) return order[i];
    return "note";
  }
  function highlight(text, spans, focus) {
    return segments(text, spans).map(function (seg) {
      if (!seg.ids.length) return esc(seg.text);
      var cls = "hl k-" + primaryKind(seg.ids);
      if (focus) cls += seg.ids.indexOf(focus) >= 0 ? " focus" : " dim";
      return '<span role="button" tabindex="0" class="' + cls + '" data-exps="' + esc(seg.ids.join(" ")) + '">' +
        esc(seg.text) + "</span>";
    }).join("");
  }
  // 穴埋め：表現が使われている部分を空欄に
  function cloze(text, spans) {
    return segments(text, spans).map(function (seg) {
      if (!seg.ids.length) return esc(seg.text);
      var w = Math.max(2, Math.min(seg.text.length, 28));
      return '<button type="button" class="blank" data-answer="' + esc(seg.text) + '" style="min-width:' +
        (w * 0.55) + 'em" aria-label="空欄（タップで表示）"></button>';
    }).join("");
  }

  // ---------- 表現の詳細 ----------
  function expTag(e) {
    return '<span class="tag k-' + e.kind + '">' + esc(KIND_LABEL[e.kind]) + "</span>";
  }
  function source(e) {
    var h = esc(e.label);
    if (e.group) h += "「" + esc(e.group) + "」";
    if (e.page) h += " · p." + esc(e.page);
    return h;
  }
  function wrongList(items) {
    return '<ul class="wrong">' + items.map(function (f) {
      var m = f.replace(/^[×△]\s*/, "").match(/^(.*?)\s*(（.*）)?$/);
      return '<li><span class="ng-mark" aria-label="誤り">×</span><s>' + esc(m[1]) + "</s>" +
        (m[2] ? ' <span class="why">' + esc(m[2]) + "</span>" : "") + "</li>";
    }).join("") + "</ul>";
  }
  function noteList(items) {
    return '<ul class="notes">' + items.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>";
  }
  function statusBadge(key) {
    var st = status(key);
    var label = { new: "未学習", weak: "苦手", learning: "学習中", known: "覚えた" }[st];
    return '<span class="status s-' + st + '">' + label + "</span>";
  }
  function expBody(e, opts) {
    opts = opts || {};
    var h = "";
    h += '<ul class="forms">' + e.forms.map(function (f) { return "<li>" + formatForm(f) + "</li>"; }).join("") + "</ul>";
    if (e.wrong.length) h += wrongList(e.wrong);
    if (e.notes.length) h += noteList(e.notes);
    (e.book || []).forEach(function (b) {
      h += '<details class="book"' + (opts.bookOpen ? " open" : "") + '><summary>本文の解説：' + esc(b.jp) +
        ' <span class="muted">' + esc(b.label) + (b.page ? " · p." + esc(b.page) : "") + "</span></summary>" +
        '<ul class="forms small">' + b.forms.map(function (f) { return "<li>" + formatForm(f) + "</li>"; }).join("") + "</ul>" +
        (b.wrong.length ? wrongList(b.wrong) : "") + (b.notes.length ? noteList(b.notes) : "") + "</details>";
    });
    var used = USED_IN[e.id] || [];
    if (used.length && opts.examples !== false) {
      var list = opts.exampleLimit ? used.slice(0, opts.exampleLimit) : used;
      h += '<h3 class="mini-title">この表現を使っている例文 <span class="muted">' + used.length + "</span></h3>";
      h += '<div class="examples">' + list.map(function (s) { return sentenceMini(s, e.id); }).join("") + "</div>";
    }
    return h;
  }
  function sentenceMini(s, focus) {
    var en = s.en.map(function (t, i) {
      if (focus && !s.spans[i].some(function (sp) { return sp[2] === focus; })) return "";
      return '<p class="en">' + highlight(t, s.spans[i], focus) + "</p>";
    }).join("");
    return '<div class="example">' +
      '<p class="example-label">' + esc(s.label) + (s.page ? " · p." + esc(s.page) : "") + "</p>" +
      '<p class="jp">' + esc(s.jp) + "</p>" + en + "</div>";
  }
  function openExp(id, focusFrom) {
    var e = EXP[id];
    if (!e) return;
    var others = "";
    if (focusFrom && focusFrom.length > 1) {
      others = '<div class="also">同じ箇所の表現：' + focusFrom.filter(function (x) { return x !== id; }).map(function (x) {
        return EXP[x] ? '<button type="button" class="chip-link" data-open="' + esc(x) + '">' + esc(EXP[x].jp) + "</button>" : "";
      }).join("") + "</div>";
    }
    $("sheet-body").innerHTML =
      '<p class="eyebrow">' + expTag(e) + " " + source(e) + " · " + esc(lectureName(e.lecture)) +
      " " + statusBadge(cardKey("e", e.id)) + "</p>" +
      '<h2 id="sheet-title" class="sheet-title">' + esc(e.jp) + "</h2>" + others + expBody(e, { bookOpen: true });
    $("sheet").hidden = false;
    $("sheet-backdrop").hidden = false;
    $("sheet").scrollTop = 0;
    document.body.classList.add("sheet-open");
    $("sheet-close").focus();
  }
  function closeSheet() {
    $("sheet").hidden = true;
    $("sheet-backdrop").hidden = true;
    document.body.classList.remove("sheet-open");
  }

  // ---------- 画面切り替え ----------
  var currentView = "home";
  function show(view) {
    if (view !== "study" && study) study = null;
    currentView = view;
    ["home", "expressions", "sentences", "study"].forEach(function (v) {
      $("view-" + v).hidden = v !== view;
    });
    document.querySelectorAll("[data-view]").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-view") === view);
    });
    document.body.classList.toggle("studying", view === "study");
    renderCurrent();
    window.scrollTo(0, 0);
  }
  function renderCurrent() {
    if (currentView === "home") renderHome();
    else if (currentView === "expressions") renderExpList();
    else if (currentView === "sentences") renderSenList();
  }

  // ---------- ホーム ----------
  function stat(label, value, sub) {
    return '<div class="stat"><span class="stat-value">' + value + '</span><span class="stat-label">' + label +
      "</span>" + (sub ? '<span class="stat-sub">' + sub + "</span>" : "") + "</div>";
  }
  function renderHome() {
    var ce = counts("e", expPool()), cs = counts("s", senPool(prefs.senScope));
    var allE = counts("e", DATA.expressions), allS = counts("s", DATA.sentences.filter(function (s) { return s.main; }));
    $("stats").innerHTML =
      stat("今日の復習", ce.due + cs.due, "表現 " + ce.due + " · 例文 " + cs.due) +
      stat("覚えた表現", allE.known + '<small> / ' + allE.total + "</small>", meter(allE.known, allE.total)) +
      stat("覚えた例題", allS.known + '<small> / ' + allS.total + "</small>", meter(allS.known, allS.total)) +
      stat("苦手", allE.weak + counts("s", DATA.sentences).weak, "直近7日で間違えたカード");
    $("deck-exp-meta").innerHTML = deckMeta(ce);
    $("deck-sen-meta").innerHTML = deckMeta(cs);
    $("exp-direction").value = prefs.direction;
    $("sen-scope").value = prefs.senScope;
    $("new-limit").value = prefs.newLimit;
    $("order").value = prefs.order;
    $("scope-lectures").innerHTML = DATA.lectures.map(function (l) {
      var on = prefs.lectures.indexOf(l.no) >= 0;
      return '<label class="chip' + (on ? " on" : "") + '"><input type="checkbox" data-lecture="' + esc(l.no) + '"' +
        (on ? " checked" : "") + "> " + esc(l.no) + " " + esc(l.title) + "</label>";
    }).join("");
    $("scope-kinds").innerHTML = ["rule", "phrase", "note", "column"].map(function (k) {
      var on = prefs.kinds.indexOf(k) >= 0;
      return '<label class="chip' + (on ? " on" : "") + '"><input type="checkbox" data-kind="' + k + '"' +
        (on ? " checked" : "") + "> " + KIND_LABEL[k] + "</label>";
    }).join("");
  }
  function meter(a, b) {
    var pct = b ? Math.round(a / b * 100) : 0;
    return '<span class="meter" role="img" aria-label="' + pct + '%"><span style="width:' + pct + '%"></span></span>';
  }
  function deckMeta(c) {
    return '<span><b>' + c.due + "</b> 復習</span><span><b>" + c.fresh + "</b> 未学習</span><span><b>" +
      c.known + "</b> / " + c.total + " 覚えた</span>";
  }

  // ---------- 表現一覧 ----------
  function lectureOptions(sel) {
    $(sel).innerHTML = '<option value="">すべての Lecture</option>' + DATA.lectures.map(function (l) {
      return '<option value="' + esc(l.no) + '">' + esc(l.no) + " " + esc(l.title) + "</option>";
    }).join("");
  }
  function norm(s) { return String(s).toLowerCase().replace(/\s+/g, " "); }
  var expShown = 60;
  function renderExpList() {
    var q = norm($("exp-search").value.trim()), lec = $("exp-lecture").value,
      kind = $("exp-kind").value, st = $("exp-status").value;
    var items = DATA.expressions.filter(function (e) {
      if (lec && e.lecture !== lec) return false;
      if (kind && e.kind !== kind) return false;
      if (st && status(cardKey("e", e.id)) !== st) return false;
      if (q) {
        var hay = norm([e.jp, e.label, e.group || ""].concat(e.forms, e.notes, e.wrong, (e.book || []).map(function (b) {
          return [b.jp].concat(b.forms, b.notes, b.wrong).join(" ");
        })).join(" "));
        return q.split(" ").every(function (w) { return hay.indexOf(w) >= 0; });
      }
      return true;
    });
    $("exp-count").textContent = items.length + " 件";
    var html = "", last = null;
    items.slice(0, expShown).forEach(function (e) {
      if (e.lecture !== last) { html += '<h2 class="group">' + esc(lectureName(e.lecture)) + "</h2>"; last = e.lecture; }
      html += '<details class="exp" data-id="' + esc(e.id) + '"><summary>' +
        '<span class="exp-head">' + expTag(e) + '<span class="exp-label">' + source(e) + "</span>" +
        statusBadge(cardKey("e", e.id)) + "</span>" +
        '<span class="exp-jp">' + esc(e.jp) + "</span>" +
        '<span class="exp-first">' + formatForm(e.forms[0] || "") + "</span></summary>" +
        '<div class="exp-body"></div></details>';
    });
    if (items.length > expShown) html += '<button type="button" class="btn more" id="exp-more">さらに表示（残り ' + (items.length - expShown) + " 件）</button>";
    if (!items.length) html = '<p class="empty">条件に合う表現はありません。検索語や絞り込みを変えてください。</p>';
    $("exp-list").innerHTML = html;
  }

  // ---------- 例文一覧 ----------
  var senShown = 30;
  function renderSenList() {
    var q = norm($("sen-search").value.trim()), lec = $("sen-lecture").value, scope = $("sen-type").value,
      hide = $("sen-hide").checked;
    var items = DATA.sentences.filter(function (s) {
      if (lec && s.lecture !== lec) return false;
      if (scope === "main" && !s.main) return false;
      if (q) {
        var hay = norm([s.jp].concat(s.en).join(" "));
        return q.split(" ").every(function (w) { return hay.indexOf(w) >= 0; });
      }
      return true;
    });
    $("sen-count").textContent = items.length + " 件";
    var html = "", last = null;
    items.slice(0, senShown).forEach(function (s) {
      if (s.lecture !== last) { html += '<h2 class="group">' + esc(lectureName(s.lecture)) + "</h2>"; last = s.lecture; }
      html += sentenceCard(s, hide);
    });
    if (items.length > senShown) html += '<button type="button" class="btn more" id="sen-more">さらに表示（残り ' + (items.length - senShown) + " 件）</button>";
    if (!items.length) html = '<p class="empty">条件に合う例文はありません。</p>';
    $("sen-list").innerHTML = html;
  }
  function chips(s) {
    return '<div class="exp-chips">' + s.exps.map(function (id) {
      var e = EXP[id];
      return '<button type="button" class="exp-chip k-' + e.kind + '" data-open="' + esc(id) + '">' + esc(e.jp) + "</button>";
    }).join("") + "</div>";
  }
  function sentenceCard(s, hide) {
    var en = s.en.map(function (t, i) {
      return '<p class="en"><span class="ans-no">' + (s.en.length > 1 ? "解答" + (i + 1) : "") + "</span>" +
        highlight(t, s.spans[i]) + "</p>";
    }).join("");
    return '<article class="sen' + (s.main ? " main" : "") + '">' +
      '<p class="example-label">' + esc(s.label) + (s.page ? " · p." + esc(s.page) : "") + " " + statusBadge(cardKey("s", s.id)) + "</p>" +
      '<p class="jp">' + esc(s.jp) + "</p>" +
      (hide ? '<details class="reveal"><summary>英文を表示</summary>' + en + chips(s) + "</details>" : en + chips(s)) +
      "</article>";
  }

  // ---------- 学習セッション ----------
  var study = null;
  function buildQueue(type, items) {
    var t = today(), due = [], fresh = [];
    items.forEach(function (it) {
      var s = progress[cardKey(type, it.id)];
      if (!s) fresh.push(it); else if (s.d <= t) due.push(it);
    });
    due.sort(function (a, b) { return progress[cardKey(type, a.id)].d - progress[cardKey(type, b.id)].d; });
    if (prefs.order === "random") { shuffle(due); shuffle(fresh); }
    return due.concat(fresh.slice(0, Number(prefs.newLimit)));
  }
  function startStudy(type) {
    var items = type === "e" ? expPool() : senPool(prefs.senScope);
    var queue = buildQueue(type, items);
    var extra = false;
    if (!queue.length && items.length) {
      // 予定のカードがなければ、覚えていない順に先取り復習
      queue = items.slice().sort(function (a, b) {
        var sa = progress[cardKey(type, a.id)], sb = progress[cardKey(type, b.id)];
        return (sa ? sa.b : 0) - (sb ? sb.b : 0) || (sa ? sa.d : 0) - (sb ? sb.d : 0);
      }).slice(0, Number(prefs.newLimit) === 9999 ? items.length : Number(prefs.newLimit));
      extra = true;
    }
    if (!queue.length) {
      $("study-card").innerHTML = "";
      return;
    }
    study = { type: type, queue: queue, done: 0, total: queue.length, again: 0, extra: extra, revealed: false };
    show("study");
    renderStudy();
  }
  function renderStudy() {
    if (!study) return;
    var pct = study.total ? Math.round(study.done / study.total * 100) : 0;
    $("study-bar").style.width = pct + "%";
    $("study-count").textContent = study.done + " / " + study.total;
    if (!study.queue.length) return renderFinish();
    var it = study.queue[0];
    $("study-card").innerHTML = study.type === "e" ? expCard(it) : senCardStudy(it);
    var input = $("my-answer");
    if (input) {
      if (study.draft) input.value = study.draft;
      input.focus({ preventScroll: true });
    }
  }
  function gradeButtons(key) {
    var s = progress[key], b = s ? s.b : 0;
    var next = INTERVALS[Math.min(b + 1, INTERVALS.length - 1)];
    return '<div class="grades">' +
      '<button type="button" class="grade again" data-grade="again"><b>もう一度</b><span>このあとすぐ</span></button>' +
      '<button type="button" class="grade hard" data-grade="hard"><b>あやふや</b><span>明日</span></button>' +
      '<button type="button" class="grade good" data-grade="good"><b>覚えた</b><span>' + next + "日後</span></button></div>";
  }
  function expCard(e) {
    var key = cardKey("e", e.id), front, back = "";
    var head = '<p class="eyebrow">' + expTag(e) + " " + source(e) + " " + statusBadge(key) + "</p>";
    if (prefs.direction === "en") {
      front = head + '<p class="prompt-en">' + formatForm(e.forms[0] || "") + "</p>" +
        '<p class="prompt-hint">この英語は、どんな日本語の表現に当たりますか。</p>';
    } else {
      front = head + '<h2 class="prompt-jp">' + esc(e.jp) + "</h2>" +
        '<p class="prompt-hint">英語でどう書くか、思い出してから答えを見てください。</p>';
    }
    if (study.revealed) {
      back = '<div class="answer">' +
        (prefs.direction === "en" ? '<h2 class="answer-jp">' + esc(e.jp) + "</h2>" : "") +
        expBody(e, { exampleLimit: 2 }) + "</div>" + gradeButtons(key);
    } else {
      back = '<button type="button" class="btn primary reveal-btn" id="reveal">答えを見る</button>';
    }
    return '<article class="card">' + front + back + "</article>";
  }
  function senCardStudy(s) {
    var key = cardKey("s", s.id);
    var h = '<p class="eyebrow">' + esc(s.label) + " · " + esc(lectureName(s.lecture)) + (s.page ? " · p." + esc(s.page) : "") + " " + statusBadge(key) + "</p>" +
      '<p class="prompt-sentence">' + esc(s.jp) + "</p>";
    if (!study.revealed) {
      h += '<label class="answer-label" for="my-answer">自分の英訳（書かなくても進めます）</label>' +
        '<textarea id="my-answer" rows="4" spellcheck="false" placeholder="ここに英訳を書く"></textarea>' +
        '<div class="hints">' +
        '<button type="button" class="btn ghost" id="hint-exps"' + (study.hintExps ? " hidden" : "") + '>ヒント：使う表現</button>' +
        '<button type="button" class="btn ghost" id="hint-cloze"' + (study.hintCloze ? " hidden" : "") + '>ヒント：穴埋めで見る</button>' +
        "</div>";
      if (study.hintExps) {
        h += '<div class="hint-box"><p class="mini-title">この文で使う表現</p>' + s.exps.map(function (id) {
          return '<span class="hint-exp k-' + EXP[id].kind + '">' + esc(EXP[id].jp) + "</span>";
        }).join("") + "</div>";
      }
      if (study.hintCloze) {
        h += '<div class="hint-box"><p class="mini-title">空欄をタップすると表示されます</p><p class="en cloze">' +
          cloze(s.en[0], s.spans[0]) + "</p></div>";
      }
      h += '<button type="button" class="btn primary reveal-btn" id="reveal">模範解答を見る</button>';
    } else {
      if (study.draft && study.draft.trim()) {
        h += '<div class="mine"><p class="mini-title">あなたの英訳</p><p class="en">' + esc(study.draft) + "</p></div>";
      }
      h += '<div class="answer"><p class="mini-title">模範解答</p>' + s.en.map(function (t, i) {
        return '<p class="en big"><span class="ans-no">' + (s.en.length > 1 ? "解答" + (i + 1) : "") + "</span>" +
          highlight(t, s.spans[i]) + "</p>";
      }).join("") +
        '<p class="mini-title">使われている表現 <span class="muted">タップで説明</span></p>' + chips(s) + "</div>" +
        gradeButtons(key);
    }
    return '<article class="card">' + h + "</article>";
  }
  function onGrade(g) {
    var it = study.queue.shift();
    var key = cardKey(study.type, it.id);
    grade(key, g);
    if (g === "again") {
      study.again++;
      study.queue.splice(Math.min(3, study.queue.length), 0, it);
    } else {
      study.done++;
    }
    study.revealed = false; study.draft = ""; study.hintExps = false; study.hintCloze = false;
    renderStudy();
    window.scrollTo(0, 0);
  }
  function renderFinish() {
    $("study-bar").style.width = "100%";
    var type = study.type;
    $("study-card").innerHTML = '<article class="card finish">' +
      '<h2 class="prompt-jp">おつかれさまでした</h2>' +
      "<p>" + study.total + " 枚を学習しました" + (study.again ? "（もう一度：" + study.again + " 回）" : "") + "。</p>" +
      (study.extra ? '<p class="fine">今日の予定分は終わっていたので、覚えていない順に先取りで復習しました。</p>' : "") +
      '<div class="finish-actions"><button type="button" class="btn primary" id="again-session" data-type="' + type + '">続けて学習する</button>' +
      '<a class="btn" href="#home" data-view="home">学習ホームへ</a></div></article>';
  }

  // ---------- イベント ----------
  document.addEventListener("click", function (ev) {
    var t = ev.target;
    var nav = t.closest("[data-view]");
    if (nav) { ev.preventDefault(); location.hash = nav.getAttribute("data-view"); show(nav.getAttribute("data-view")); return; }
    var hl = t.closest(".hl[data-exps]");
    if (hl) { var ids = hl.getAttribute("data-exps").split(" "); openExp(ids[0], ids); return; }
    var op = t.closest("[data-open]");
    if (op) { openExp(op.getAttribute("data-open")); return; }
    var blank = t.closest(".blank");
    if (blank) { blank.textContent = blank.getAttribute("data-answer"); blank.classList.add("shown"); return; }
    var gr = t.closest("[data-grade]");
    if (gr && study) { onGrade(gr.getAttribute("data-grade")); return; }
    switch (t.id) {
      case "start-exp": startStudy("e"); break;
      case "start-sen": startStudy("s"); break;
      case "again-session": startStudy(t.getAttribute("data-type")); break;
      case "reveal": if (study) { var a = $("my-answer"); if (a) study.draft = a.value; study.revealed = true; renderStudy(); } break;
      case "hint-exps": if (study) { study.draft = ($("my-answer") || {}).value || ""; study.hintExps = true; renderStudy(); } break;
      case "hint-cloze": if (study) { study.draft = ($("my-answer") || {}).value || ""; study.hintCloze = true; renderStudy(); } break;
      case "study-quit": location.hash = "home"; show("home"); break;
      case "sheet-close": case "sheet-backdrop": closeSheet(); break;
      case "exp-more": expShown += 60; renderExpList(); break;
      case "sen-more": senShown += 30; renderSenList(); break;
      case "scope-all": prefs.lectures = DATA.lectures.map(function (l) { return l.no; }); savePrefs(); renderHome(); break;
      case "scope-none": prefs.lectures = []; savePrefs(); renderHome(); break;
      case "reset-progress": $("reset-confirm").hidden = false; break;
      case "reset-no": $("reset-confirm").hidden = true; break;
      case "reset-yes":
        progress = {}; scheduleSave(); $("reset-confirm").hidden = true; renderHome(); break;
    }
  });
  // 一覧の表現を開いたときに本文を描画
  document.addEventListener("toggle", function (ev) {
    var d = ev.target;
    if (d.classList && d.classList.contains("exp") && d.open) {
      var body = d.querySelector(".exp-body");
      if (!body.innerHTML) body.innerHTML = expBody(EXP[d.getAttribute("data-id")]);
    }
  }, true);
  document.addEventListener("change", function (ev) {
    var t = ev.target;
    if (t.hasAttribute("data-lecture")) {
      var no = t.getAttribute("data-lecture");
      prefs.lectures = prefs.lectures.filter(function (x) { return x !== no; });
      if (t.checked) prefs.lectures.push(no);
      savePrefs(); renderHome(); return;
    }
    if (t.hasAttribute("data-kind")) {
      var k = t.getAttribute("data-kind");
      prefs.kinds = prefs.kinds.filter(function (x) { return x !== k; });
      if (t.checked) prefs.kinds.push(k);
      savePrefs(); renderHome(); return;
    }
    var map = { "exp-direction": "direction", "sen-scope": "senScope", "new-limit": "newLimit", order: "order" };
    if (map[t.id]) { prefs[map[t.id]] = t.value; savePrefs(); renderHome(); return; }
    if (["exp-lecture", "exp-kind", "exp-status"].indexOf(t.id) >= 0) { expShown = 60; renderExpList(); }
    if (["sen-lecture", "sen-type", "sen-hide"].indexOf(t.id) >= 0) { senShown = 30; renderSenList(); }
  });
  var searchTimer;
  document.addEventListener("input", function (ev) {
    if (ev.target.id === "exp-search") { clearTimeout(searchTimer); searchTimer = setTimeout(function () { expShown = 60; renderExpList(); }, 150); }
    if (ev.target.id === "sen-search") { clearTimeout(searchTimer); searchTimer = setTimeout(function () { senShown = 30; renderSenList(); }, 150); }
    if (ev.target.id === "my-answer" && study) study.draft = ev.target.value;
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !$("sheet").hidden) { closeSheet(); return; }
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.classList && ev.target.classList.contains("hl")) {
      ev.preventDefault(); ev.target.click(); return;
    }
    if (currentView !== "study" || !study || !$("sheet").hidden) return;
    if (ev.target.tagName === "TEXTAREA" || ev.target.tagName === "INPUT") {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); $("reveal") && $("reveal").click(); }
      return;
    }
    if (!study.revealed && (ev.key === " " || ev.key === "Enter")) { ev.preventDefault(); $("reveal") && $("reveal").click(); }
    else if (study.revealed && ["1", "2", "3"].indexOf(ev.key) >= 0) onGrade(["again", "hard", "good"][Number(ev.key) - 1]);
  });

  // ---------- 起動 ----------
  progress = lsGet(LS_KEY) || {};
  lectureOptions("exp-lecture");
  lectureOptions("sen-lecture");
  window.addEventListener("hashchange", function () {
    var v = (location.hash || "").replace("#", "");
    if (["home", "expressions", "sentences"].indexOf(v) >= 0 && v !== currentView) show(v);
  });
  var start = (location.hash || "").replace("#", "");
  show(["home", "expressions", "sentences"].indexOf(start) >= 0 ? start : "home");
  initRemote();
})();
