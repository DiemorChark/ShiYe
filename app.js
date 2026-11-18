/* =========================================================
   拾页 PAGE TUTOR
   上传资料 → 拆知识点 → 逐段讲解 + 随堂练习 → 存成书
   ========================================================= */
(function () {
  'use strict';

  /* ================= 小工具 ================= */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3200);
  }

  /* ================= 存储 ================= */
  var KEY_INDEX = 'pt.index.v1';
  var KEY_SET = 'pt.settings.v1';
  function keyLevel(id) { return 'pt.level.' + id; }

  function readJSON(k, dflt) {
    try {
      var v = localStorage.getItem(k);
      return v ? JSON.parse(v) : dflt;
    } catch (e) { return dflt; }
  }
  function writeJSON(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch (e) {
      toast('本地存储写满了，这本书可能保存不全');
      return false;
    }
  }

  var DEFAULT_SETTINGS = {
    base: 'https://api.deepseek.com/v1',
    key: '',
    model: 'deepseek-chat',
    proxy: false,
    proxyUrl: 'http://127.0.0.1:8765',
    mock: false,
    preset: 'deepseek'
  };

  /* 国内服务商预设。都兼容 OpenAI 的 /chat/completions 格式。 */
  var PRESETS = {
    deepseek: {
      base: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      hint: '杭州深度求索官方接口，按 token 计费。一份 20 页讲义大概几毛钱，讲解和出题质量最稳。'
    },
    zhipu: {
      base: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash',
      hint: '智谱 AI（北京）。GLM-4-Flash 免费，中文理解不错，适合当作不花钱的主力模型。'
    },
    dashscope: {
      base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-turbo',
      hint: '阿里云百炼。新用户每个模型送 100 万 tokens；' +
        '想换更强的可以把模型改成 qwen-plus、qwen-max，百炼上架的 deepseek-v3 也走同一个地址。'
    },
    hunyuan: {
      base: 'https://api.hunyuan.cloud.tencent.com/v1',
      model: 'hunyuan-lite',
      hint: '腾讯混元。hunyuan-lite 免费；想快一点可换 hunyuan-turbos-latest（少量计费）。'
    },
    siliconflow: {
      base: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen2.5-7B-Instruct',
      hint: '硅基流动（北京）。新用户有赠送额度，国内直连延迟低。' +
        '免费模型清单会变，报错就去控制台的模型广场挑一个标着「免费」的填进来。'
    },
    spark: {
      base: 'https://spark-api-open.xf-yun.com/v1',
      model: 'lite',
      hint: '科大讯飞星火。Lite 版本免费；Key 填控制台里的 APIPassword，不是 AppID。'
    },
    custom: {
      hint: '手动填写下面三项，任何兼容 OpenAI 格式的接口都可以（建议使用境内服务商）。'
    }
  };
  var settings = Object.assign({}, DEFAULT_SETTINGS, readJSON(KEY_SET, {}));
  function saveSettings() { writeJSON(KEY_SET, settings); }

  /* ================= 状态 ================= */
  var current = null;          // 当前打开的关卡对象
  var cardEls = {};            // qid -> DOM
  var pendingFile = null;      // 待生成的文件
  var abortCtrl = null;

  /* ================= 视图切换 ================= */
  function showView(name) {
    $('#view-shelf').hidden = name !== 'shelf';
    $('#view-level').hidden = name !== 'level';
    if (name === 'shelf') renderShelf();
    window.scrollTo(0, 0);
  }

  /* ================= 书架 ================= */
  var COVERS = ['#2c6e57', '#b4472e', '#2f4858', '#b8871f', '#6b3f5b', '#1f6f6f'];

  function coverFor(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973;
    return COVERS[h % COVERS.length];
  }

  function getIndex() {
    var idx = readJSON(KEY_INDEX, []);
    return Array.isArray(idx) ? idx : [];
  }
  function saveIndex(idx) { writeJSON(KEY_INDEX, idx); }

  function updateIndexEntry(level) {
    var idx = getIndex();
    var qTotal = 0, qDone = 0;
    level.segments.forEach(function (s) {
      qTotal += s.quiz.length;
      s.quiz.forEach(function (q) { if (s.answers && s.answers[q.id]) qDone++; });
    });
    var entry = {
      id: level.id,
      title: level.title,
      source: level.source,
      createdAt: level.createdAt,
      segCount: level.segments.length,
      points: level.pointCount || 0,
      qTotal: qTotal,
      qDone: qDone
    };
    var i = idx.findIndex(function (e) { return e.id === level.id; });
    if (i >= 0) idx[i] = entry; else idx.unshift(entry);
    saveIndex(idx);
  }

  function renderShelf() {
    var idx = getIndex().slice().sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    var shelf = $('#shelf');
    shelf.innerHTML = '';
    $('#shelf-count').textContent = idx.length ? idx.length + ' 本' : '';
    $('#shelf-empty').hidden = idx.length > 0;

    idx.forEach(function (e) {
      var pct = e.qTotal ? Math.round((e.qDone / e.qTotal) * 100) : 0;
      var btn = el('div', 'book');
      btn.tabIndex = 0;
      btn.setAttribute('role', 'button');
      btn.title = e.source || '';
      btn.innerHTML =
        '<div class="book-cover" style="--cover:' + coverFor(e.id) + '">' +
          '<div class="book-inner">' +
            '<div class="book-kicker">' + (e.segCount || 0) + ' 段 · ' + (e.qTotal || 0) + ' 题</div>' +
            '<h3 class="book-title">' + esc(e.title) + '</h3>' +
            '<div class="book-spacer"></div>' +
            '<div class="book-progress"><i style="width:' + pct + '%"></i></div>' +
            '<div class="book-foot"><span>' + pct + '%</span><span>' + fmtDate(e.createdAt) + '</span></div>' +
          '</div>' +
        '</div>' +
        '<button class="book-del" type="button" title="删除">×</button>';

      btn.addEventListener('click', function (ev) {
        if (ev.target.closest('.book-del')) return;
        openLevel(e.id);
      });
      btn.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openLevel(e.id); }
      });
      btn.querySelector('.book-del').addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (!confirm('删除《' + e.title + '》？聊天记录也会一起消失。')) return;
        try { localStorage.removeItem(keyLevel(e.id)); } catch (err) { /* ignore */ }
        saveIndex(getIndex().filter(function (x) { return x.id !== e.id; }));
        renderShelf();
        toast('已删除');
      });
      shelf.appendChild(btn);
    });
  }

  /* ================= 模型调用 ================= */
  function endpointFor(path) {
    if (settings.proxy) {
      return settings.proxyUrl.replace(/\/+$/, '') + '/api/chat';
    }
    var base = (settings.base || DEFAULT_SETTINGS.base).replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(base)) return base;
    return base + (path || '/chat/completions');
  }

  function apiError(res, text) {
    var msg = text || '';
    try {
      var j = JSON.parse(text);
      if (j && j.error && j.error.message) msg = j.error.message;
    } catch (e) { /* 保持原文 */ }
    if (res.status === 401) return new Error('鉴权失败（401）：API Key 不对或已失效');
    if (res.status === 402) return new Error('余额不足（402）：去平台充值，或换一个 Base URL');
    if (res.status === 429) return new Error('触发限流（429）：稍等一下再试');
    return new Error('接口报错 ' + res.status + '：' + String(msg).slice(0, 160));
  }

  async function callModel(messages, opts) {
    opts = opts || {};
    var body = {
      model: opts.model || settings.model || 'deepseek-chat',
      messages: messages,
      temperature: opts.temperature == null ? 0.35 : opts.temperature,
      max_tokens: opts.maxTokens || 2200,
      stream: false
    };
    if (opts.json) body.response_format = { type: 'json_object' };

    var useProxy = settings.proxy;
    var url = endpointFor();
    var headers = { 'Content-Type': 'application/json' };
    if (settings.key) headers['Authorization'] = 'Bearer ' + settings.key;

    var attempt = 0;
    while (true) {
      attempt++;
      var res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body),
          signal: opts.signal
        });
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        if (attempt >= 2) {
          throw new Error('网络请求失败。若浏览器拦截了跨域，请在设置里勾选「本地代理」并先运行 server.py');
        }
        await sleep(700);
        continue;
      }

      if (res.status === 400 && body.response_format) {
        // 有些兼容接口不支持 JSON 模式，去掉再试
        delete body.response_format;
        continue;
      }
      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        await sleep(1200 * attempt);
        continue;
      }
      if (!res.ok) {
        var txt = '';
        try { txt = await res.text(); } catch (e) { /* ignore */ }
        throw apiError(res, txt);
      }

      var data = await res.json();
      var choice = data && data.choices && data.choices[0];
      var content = choice && choice.message && choice.message.content;
      if (!content) throw new Error('模型没有返回内容');
      return String(content);
    }
  }

  /* ================= JSON 容错解析 ================= */
  function parseJSON(text) {
    if (!text) throw new Error('模型返回为空');
    var s = String(text).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(s); } catch (e) { /* 继续尝试 */ }

    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      var t = s.slice(a, b + 1);
      try { return JSON.parse(t); } catch (e) { /* 继续 */ }
      t = t.replace(/,\s*([}\]])/g, '$1').replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
      try { return JSON.parse(t); } catch (e) { /* 放弃 */ }
    }
    throw new Error('模型返回的不是合法 JSON');
  }

  /* ================= 文件解析 ================= */
  /* 解析库走 CDN：优先 jsDelivr，失败自动切国内镜像 npmmirror，再退到 unpkg。 */
  var CDN = {
    pdfjs: [
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
      'https://registry.npmmirror.com/pdfjs-dist/3.11.174/files/build/pdf.min.js',
      'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js'
    ],
    pdfworker: [
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
      'https://registry.npmmirror.com/pdfjs-dist/3.11.174/files/build/pdf.worker.min.js',
      'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
    ],
    mammoth: [
      'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
      'https://registry.npmmirror.com/mammoth/1.6.0/files/mammoth.browser.min.js',
      'https://unpkg.com/mammoth@1.6.0/mammoth.browser.min.js'
    ],
    jszip: [
      'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
      'https://registry.npmmirror.com/jszip/3.10.1/files/dist/jszip.min.js',
      'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js'
    ]
  };

  var loadedScripts = {};
  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      var settled = false;
      // CDN 有时不是报错而是卡住，9 秒没动静就换下一个源
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        s.onload = null;
        s.onerror = null;
        try { s.remove(); } catch (e) { /* ignore */ }
        reject(new Error('加载超时 ' + url));
      }, 9000);

      s.src = url;
      s.async = true;
      s.onload = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(url);
      };
      s.onerror = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('加载失败 ' + url));
      };
      document.head.appendChild(s);
      loadedScripts[url] = s;
    });
  }

  async function loadFirst(urls, ready) {
    if (ready()) return;
    var lastErr = null;
    for (var i = 0; i < urls.length; i++) {
      try {
        await loadScript(urls[i]);
        if (ready()) return;
      } catch (e) { lastErr = e; }
    }
    throw new Error('依赖库加载失败（可能没联网）：' + (lastErr ? lastErr.message : ''));
  }

  async function fetchTextFirst(urls) {
    for (var i = 0; i < urls.length; i++) {
      try {
        var r = await fetch(urls[i]);
        if (r.ok) return await r.text();
      } catch (e) { /* 试下一个 */ }
    }
    return null;
  }

  async function parsePDF(file, onStep) {
    await loadFirst(CDN.pdfjs, function () { return window.pdfjsLib; });
    var lib = window.pdfjsLib;
    try {
      var code = await fetchTextFirst(CDN.pdfworker);
      if (code) {
        var blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        lib.GlobalWorkerOptions.workerSrc = blobUrl;
      } else {
        lib.GlobalWorkerOptions.workerSrc = CDN.pdfworker[0];
      }
    } catch (e) {
      lib.GlobalWorkerOptions.workerSrc = CDN.pdfworker[0];
    }

    if (onStep) onStep('正在解析 PDF…');
    var doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    var out = [];
    for (var p = 1; p <= doc.numPages; p++) {
      if (onStep) onStep('正在解析 PDF… ' + p + '/' + doc.numPages);
      var page = await doc.getPage(p);
      var tc = await page.getTextContent();
      var buf = '';
      for (var i = 0; i < tc.items.length; i++) {
        var it = tc.items[i];
        if (typeof it.str !== 'string') continue;
        buf += it.str;
        if (it.hasEOL) buf += '\n';
      }
      out.push('［第 ' + p + ' 页］\n' + buf.replace(/[ \t]+/g, ' '));
    }
    return { text: out.join('\n\n'), pages: doc.numPages };
  }

  async function parseDocx(file) {
    await loadFirst(CDN.mammoth, function () { return window.mammoth; });
    var res = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { text: res.value || '', pages: null };
  }

  async function parsePptx(file, onStep) {
    await loadFirst(CDN.jszip, function () { return window.JSZip; });
    var zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    var names = Object.keys(zip.files).filter(function (n) {
      return /^ppt\/slides\/slide\d+\.xml$/.test(n);
    });
    names.sort(function (a, b) {
      return parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10);
    });
    var parser = new DOMParser();
    var out = [];
    for (var i = 0; i < names.length; i++) {
      if (onStep) onStep('正在解析 PPT… ' + (i + 1) + '/' + names.length);
      var xml = await zip.file(names[i]).async('string');
      var doc = parser.parseFromString(xml, 'application/xml');
      var ts = doc.getElementsByTagName('a:t');
      var parts = [];
      for (var j = 0; j < ts.length; j++) parts.push(ts[j].textContent || '');
      out.push('［第 ' + (i + 1) + ' 页］\n' + parts.join(' '));
    }
    return { text: out.join('\n\n'), pages: names.length };
  }

  async function parseFile(file, onStep) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
      if (onStep) onStep('正在读取文本…');
      return { text: await file.text(), pages: null, ext: ext };
    }
    if (ext === 'pdf') return Object.assign(await parsePDF(file, onStep), { ext: ext });
    if (ext === 'docx') return Object.assign(await parseDocx(file), { ext: ext });
    if (ext === 'pptx') return Object.assign(await parsePptx(file, onStep), { ext: ext });
    if (ext === 'doc' || ext === 'ppt') {
      throw new Error('旧版 .doc / .ppt 读不了，请用 Office 另存为 .docx / .pptx');
    }
    throw new Error('不支持的文件类型：.' + ext);
  }

  /* ================= 切块 ================= */
  function cleanText(t) {
    return String(t || '')
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function chunkText(text) {
    var SIZE = 2800, OVERLAP = 220;
    var lines = cleanText(text).split('\n');
    var chunks = [], buf = '';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (buf.length + line.length + 1 > SIZE && buf.length > SIZE * 0.55) {
        chunks.push(buf.trim());
        buf = buf.slice(Math.max(0, buf.length - OVERLAP)) + '\n';
      }
      buf += line + '\n';
    }
    if (buf.trim()) chunks.push(buf.trim());
    return chunks.filter(function (c) { return c.replace(/\s/g, '').length >= 60; }).slice(0, 34);
  }

  function normTitle(s) {
    return String(s || '').toLowerCase().replace(/[\s，。、；：:,.!?！？（）()【】\[\]“”"'’·\-—_]/g, '');
  }

  /* ================= 提示词 ================= */
  var SYS = '你是一位极其严谨的教学设计师，擅长把资料拆成可教、可考的知识点。只输出 JSON，不要任何解释性文字。';

  function extractPrompt(chunk, i, n) {
    return '下面是学习资料的片段（' + (i + 1) + '/' + n + '）。请提取其中的知识点。\n\n' +
      '要求：\n' +
      '1. 只输出 JSON：{"points":[{"title":"知识点标题，不超过20字","brief":"一句话要点，不超过50字"}]}\n' +
      '2. 覆盖片段里的概念、定义、公式、方法、步骤、易错点、结论。\n' +
      '3. 每个知识点要独立可考，不要写成泛泛的章节名。\n' +
      '4. 目录、页眉页脚、致谢、参考文献、无信息量的内容直接忽略。\n' +
      '5. 片段确实没有可用知识点时，返回 {"points":[]}。\n\n' +
      '资料片段：\n"""\n' + chunk + '\n"""';
  }

  function curatePrompt(points, perGroup) {
    var list = points.map(function (p, i) {
      return (i + 1) + '. ' + p.title + (p.brief ? ' —— ' + p.brief : '');
    }).join('\n');
    return '下面是从一份学习资料里抽出的全部知识点（可能重复或相近）。请把它们整理成若干小节，用于逐段教学。\n\n' +
      '要求：\n' +
      '1. 只输出 JSON：{"groups":[{"title":"小节标题，不超过16字","points":[{"title":"...","brief":"..."}]}]}\n' +
      '2. 每节大约 ' + perGroup + ' 个知识点（可以 3-6 个）。\n' +
      '3. 必须覆盖输入里所有不重复的知识点，一条都不能少；重复或高度相近的合并为一条。\n' +
      '4. 按教学顺序排列：先基础后进阶，有依赖的放在相邻小节。\n' +
      '5. 小节标题要具体（如"矩阵的秩与线性相关性"），不要写"第一部分"这类空标题。\n\n' +
      '知识点清单：\n' + list;
  }

  function segmentPrompt(group, nQuiz) {
    var pts = (group.points || []).map(function (p, i) {
      return (i + 1) + '. ' + p.title + (p.brief ? ' —— ' + p.brief : '');
    }).join('\n');
    return '你在给一位自学的学生上课。这节课要讲下面这些知识点。\n\n' +
      '【小节标题】' + (group.title || '本段') + '\n' +
      '【知识点】\n' + pts + '\n\n' +
      '请写一段讲解，并出 ' + nQuiz + ' 道随堂练习。\n\n' +
      '只输出 JSON：\n' +
      '{\n' +
      '  "teach": "讲解正文，400-700字。口语化，像老师面对面说话。先讲清概念，再举一个具体例子，最后点出容易出错的地方。可以用短段落，不要 Markdown 标题和加粗符号。",\n' +
      '  "quiz": [\n' +
      '    {"type":"choice","q":"题干","options":["选项A","选项B","选项C","选项D"],"answer":0,"explain":"为什么选它，其他选项错在哪"},\n' +
      '    {"type":"fill","q":"题干，空位用 ____ 表示","answer":"标准答案（不超过12字）","accept":["其他可接受的写法"],"explain":"解析"}\n' +
      '  ]\n' +
      '}\n\n' +
      '规则：\n' +
      '- 题目必须能从上面的讲解或知识点里找到明确依据，不要考没讲过的东西。\n' +
      '- 选择题固定 4 个选项、只有一个正确；干扰项要有迷惑性但必须明确错误。\n' +
      '- 填空题答案要短、唯一、可判定；accept 放同义写法或英文写法。\n' +
      '- answer 是正确选项的下标（从 0 开始）。\n' +
      '- 至少一题考理解和应用，不要全是背诵。\n' +
      '- explain 要讲清道理，不要写"见上文"。';
  }

  /* ================= 生成流程 ================= */
  function normalizePoints(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (p) {
      if (!p) return null;
      if (typeof p === 'string') return { title: p.slice(0, 40), brief: '' };
      if (!p.title) return null;
      return { title: String(p.title).slice(0, 40), brief: String(p.brief || '').slice(0, 90) };
    }).filter(Boolean);
  }

  function normalizeQuiz(items, segIndex) {
    var out = [];
    (items || []).forEach(function (q, j) {
      if (!q || !q.q) return;
      var text = String(q.q);
      var isFill = q.type === 'fill' || !q.options;
      if (isFill) {
        var answers = [];
        if (q.answer != null) answers.push(String(q.answer));
        if (Array.isArray(q.accept)) q.accept.forEach(function (a) { if (a != null) answers.push(String(a)); });
        answers = answers.filter(function (a) { return a.trim(); });
        if (!answers.length) return;
        out.push({
          id: 'q' + segIndex + '_' + j,
          type: 'fill',
          q: text,
          answer: answers[0],
          accept: answers.slice(1),
          explain: String(q.explain || '')
        });
      } else if (Array.isArray(q.options) && q.options.length >= 2) {
        var idx = q.answer;
        if (typeof idx === 'string') {
          var t = idx.trim();
          if (/^[A-Za-z]$/.test(t)) idx = t.toUpperCase().charCodeAt(0) - 65;
          else idx = q.options.findIndex(function (o) { return String(o).trim() === t; });
        }
        idx = Number(idx);
        if (!(idx >= 0 && idx < q.options.length)) idx = 0;
        out.push({
          id: 'q' + segIndex + '_' + j,
          type: 'choice',
          q: text,
          options: q.options.slice(0, 6).map(String),
          answer: idx,
          explain: String(q.explain || '')
        });
      }
    });
    return out;
  }

  function normalizeGroups(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (g) {
      if (!g) return null;
      var pts = normalizePoints(g.points);
      if (!pts.length) return null;
      return { title: String(g.title || '本段').slice(0, 30), points: pts };
    }).filter(Boolean);
  }

  function makeSegment(obj, group, i) {
    var teach = String((obj && obj.teach) || '').trim();
    if (!teach) {
      teach = '这一段包含：' + (group.points || []).map(function (p) { return p.title; }).join('、') + '。';
    }
    return {
      id: 'sg' + i,
      title: String((obj && obj.title) || group.title || ('第 ' + (i + 1) + ' 段')),
      points: (group.points || []).map(function (p) { return p.title; }),
      teach: teach,
      quiz: normalizeQuiz(obj && obj.quiz, i),
      answers: {}
    };
  }

  async function generateLevel(file, opts, cb, signal) {
    var raw = await parseFile(file, function (msg) { cb.step(msg, 0.02); });
    var text = cleanText(raw.text);
    var chars = text.replace(/\s/g, '').length;
    cb.log('解析完成：' + chars + ' 字' + (raw.pages ? '，' + raw.pages + ' 页' : ''));
    if (chars < 60) throw new Error('文件里没读到足够的文字（扫描版 PDF 需要先 OCR）');

    if (settings.mock) {
      return await mockGenerate(file, text, opts, cb, signal);
    }

    var chunks = chunkText(text);
    cb.log('切成 ' + chunks.length + ' 个片段，开始提取知识点');

    // ---- 阶段 1：逐片段提取知识点 ----
    var points = [];
    for (var i = 0; i < chunks.length; i++) {
      if (signal && signal.aborted) throw new Error('已停止');
      cb.step('提取知识点 ' + (i + 1) + ' / ' + chunks.length, 0.03 + 0.42 * (i / chunks.length));
      try {
        var r1 = await callModel([
          { role: 'system', content: SYS },
          { role: 'user', content: extractPrompt(chunks[i], i, chunks.length) }
        ], { json: true, maxTokens: 1500, signal: signal });
        var o1 = parseJSON(r1);
        var got = normalizePoints(o1.points);
        points = points.concat(got);
        cb.log('片段 ' + (i + 1) + '：' + got.length + ' 个知识点');
      } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('已停止');
        cb.log('片段 ' + (i + 1) + ' 失败：' + e.message, true);
      }
    }

    if (!points.length) throw new Error('没有提取到知识点，检查一下这份资料是不是纯图片');

    // 粗去重
    var seen = {};
    var uniq = [];
    points.forEach(function (p) {
      var k = normTitle(p.title);
      if (!k || seen[k]) return;
      seen[k] = 1;
      uniq.push(p);
    });
    cb.log('合并去重后：' + uniq.length + ' 个知识点');

    // ---- 阶段 2：整理成小节 ----
    cb.step('整理教学大纲…', 0.48);
    var groups = [];
    var BATCH = 46;
    for (var b = 0; b < uniq.length; b += BATCH) {
      if (signal && signal.aborted) throw new Error('已停止');
      var slice = uniq.slice(b, b + BATCH);
      try {
        var r2 = await callModel([
          { role: 'system', content: SYS },
          { role: 'user', content: curatePrompt(slice, opts.perGroup) }
        ], { json: true, maxTokens: 2200, signal: signal });
        var o2 = parseJSON(r2);
        var gs = normalizeGroups(o2.groups);
        if (gs.length) groups = groups.concat(gs);
      } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('已停止');
        cb.log('大纲整理失败：' + e.message, true);
      }
      if (uniq.length > BATCH) cb.log('大纲进度 ' + Math.min(b + BATCH, uniq.length) + '/' + uniq.length);
    }

    if (!groups.length) {
      cb.log('大纲整理没成功，改用机械分组', true);
      for (var g = 0; g < uniq.length; g += opts.perGroup) {
        groups.push({ title: '第 ' + (g / opts.perGroup + 1) + ' 段', points: uniq.slice(g, g + opts.perGroup) });
      }
    }
    cb.log('整理出 ' + groups.length + ' 个小节');

    // ---- 阶段 3：逐节写讲解 + 出题 ----
    var segments = [];
    for (var s = 0; s < groups.length; s++) {
      if (signal && signal.aborted) throw new Error('已停止');
      cb.step('编写第 ' + (s + 1) + ' / ' + groups.length + ' 段讲解', 0.52 + 0.45 * (s / groups.length));
      try {
        var r3 = await callModel([
          { role: 'system', content: SYS },
          { role: 'user', content: segmentPrompt(groups[s], opts.perQuiz) }
        ], { json: true, maxTokens: 2600, signal: signal });
        var o3 = parseJSON(r3);
        segments.push(makeSegment(o3, groups[s], s));
        cb.log('第 ' + (s + 1) + ' 段完成：' + ((o3.quiz || []).length) + ' 题');
      } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('已停止');
        cb.log('第 ' + (s + 1) + ' 段失败：' + e.message, true);
      }
    }

    if (!segments.length) throw new Error('关卡生成失败：一段都没写出来');

    return {
      id: uid('lv'),
      title: baseName(file.name),
      source: file.name,
      ext: raw.ext,
      createdAt: Date.now(),
      pointCount: uniq.length,
      segments: segments,
      cursor: 0
    };
  }

  async function mockGenerate(file, text, opts, cb, signal) {
    cb.log('演示模式：不调用模型，直接用文本切片拼出关卡', true);
    var chunks = chunkText(text).slice(0, 4);
    var segs = [];
    for (var i = 0; i < chunks.length; i++) {
      if (signal && signal.aborted) throw new Error('已停止');
      cb.step('演示模式：拼接第 ' + (i + 1) + ' 段', 0.1 + 0.8 * (i / Math.max(1, chunks.length)));
      await sleep(420);
      var body = chunks[i].replace(/［第 \d+ 页］/g, '').trim().slice(0, 620);
      segs.push({
        id: 'sg' + i,
        title: '第 ' + (i + 1) + ' 段 · 原文摘录',
        points: ['演示段落 ' + (i + 1)],
        teach: '（演示模式）下面是资料里的一段原文，正式生成时这里会是一段老师口吻的讲解：\n\n' + body,
        quiz: [],
        answers: {}
      });
    }
    return {
      id: uid('lv'),
      title: baseName(file.name),
      source: file.name,
      ext: 'txt',
      createdAt: Date.now(),
      pointCount: chunks.length,
      segments: segs,
      cursor: 0
    };
  }

  function baseName(name) {
    return String(name).replace(/\.[^.]+$/, '').slice(0, 42) || '未命名资料';
  }

  /* ================= 关卡：渲染 ================= */
  function openLevel(id) {
    var lv = readJSON(keyLevel(id), null);
    if (!lv) { toast('这本书读不出来了'); return; }
    lv.segments = lv.segments || [];
    lv.segments.forEach(function (s) {
      s.answers = s.answers || {};
      s.quiz = s.quiz || [];
    });
    if (typeof lv.cursor !== 'number') lv.cursor = 0;
    lv.cursor = Math.max(0, Math.min(lv.cursor, lv.segments.length - 1));
    current = lv;
    cardEls = {};

    $('#level-name').textContent = lv.title;
    $('#level-meta').textContent = (lv.source || '') + ' · ' + lv.segments.length + ' 段 · ' +
      (lv.pointCount || '?') + ' 个知识点';

    $('#chat').innerHTML = '';
    var totalQ = 0, doneQ = 0;
    lv.segments.forEach(function (s) {
      totalQ += s.quiz.length;
      s.quiz.forEach(function (q) { if (s.answers[q.id]) doneQ++; });
    });
    $('#chat').appendChild(el('div', 'sys', '共 ' + lv.segments.length + ' 段 · ' + totalQ + ' 题 · 随时可以往上翻'));

    showView('level');
    for (var i = 0; i <= lv.cursor; i++) renderSegment(i);
    updateComposer();
    updateProgress();
    scrollBottom(true);
  }

  function persist() {
    if (!current) return;
    writeJSON(keyLevel(current.id), current);
    updateIndexEntry(current);
  }

  function renderSegment(i) {
    var seg = current.segments[i];
    if (!seg) return;
    var chat = $('#chat');

    var msg = el('div', 'msg teacher');
    msg.dataset.seg = String(i);
    var av = el('div', 'avatar', '师');
    var bubble = el('div', 'bubble');

    var head = el('div', 'seg-head');
    head.appendChild(el('span', 'seg-no', '第 ' + (i + 1) + ' 段'));
    head.appendChild(el('span', 'seg-title', seg.title || ''));
    bubble.appendChild(head);

    String(seg.teach || '').split(/\n+/).forEach(function (para) {
      var p = el('p');
      p.textContent = para;
      bubble.appendChild(p);
    });

    if (seg.points && seg.points.length) {
      var pts = el('div', 'points');
      seg.points.forEach(function (t) { pts.appendChild(el('span', 'chip', t)); });
      bubble.appendChild(pts);
    }

    msg.appendChild(av);
    msg.appendChild(bubble);
    chat.appendChild(msg);

    // 练习：已答的 + 第一道未答的
    var revealed = seg.quiz.filter(function (q) { return seg.answers[q.id]; });
    var nextQ = seg.quiz.find(function (q) { return !seg.answers[q.id]; });
    revealed.forEach(function (q) { appendQuizCard(seg, i, q); });
    if (nextQ) appendQuizCard(seg, i, nextQ);
  }

  function appendQuizCard(seg, segIndex, q) {
    if (cardEls[q.id]) return;
    var chat = $('#chat');
    var box = el('div', 'quiz');
    box.dataset.qid = q.id;
    box.dataset.seg = String(segIndex);

    var tag = el('div', 'quiz-tag', (q.type === 'choice' ? '随堂练习 · 选择题' : '随堂练习 · 填空题'));
    box.appendChild(tag);

    var qEl = el('p', 'quiz-q');
    if (q.type === 'fill') {
      // 把 ____ 渲染成下划线
      var parts = String(q.q).split(/_{2,}/);
      parts.forEach(function (t, idx) {
        if (idx) qEl.appendChild(el('span', 'blank'));
        qEl.appendChild(document.createTextNode(t));
      });
    } else {
      qEl.textContent = q.q;
    }
    box.appendChild(qEl);

    if (q.type === 'choice') {
      var opts = el('div', 'options');
      q.options.forEach(function (opt, oi) {
        var b = el('button', 'opt');
        b.type = 'button';
        b.innerHTML = '<b>' + String.fromCharCode(65 + oi) + '</b><span></span>';
        b.querySelector('span').textContent = opt;
        b.addEventListener('click', function () { onChoice(seg, segIndex, q, oi, box); });
        opts.appendChild(b);
      });
      box.appendChild(opts);
    } else {
      var row = el('div', 'fill-row');
      var input = el('input');
      input.type = 'text';
      input.placeholder = '输入你的答案…';
      input.autocomplete = 'off';
      var submit = el('button', '', '提交');
      submit.type = 'button';
      var doSubmit = function () { onSubmitFill(seg, segIndex, q, input.value, box); };
      submit.addEventListener('click', doSubmit);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); doSubmit(); }
      });
      row.appendChild(input);
      row.appendChild(submit);
      box.appendChild(row);
    }

    var fb = el('div', 'feedback');
    fb.hidden = true;
    box.appendChild(fb);

    cardEls[q.id] = box;
    chat.appendChild(box);
    applyQuizState(box, seg, q);
  }

  function applyQuizState(box, seg, q) {
    var ans = seg.answers[q.id];
    var fb = box.querySelector('.feedback');
    if (!ans) {
      fb.hidden = true;
      return;
    }

    var opts = $$('.opt', box);
    var row = box.querySelector('.fill-row');
    if (row) {
      var input = row.querySelector('input');
      input.disabled = true;
      row.querySelector('button').disabled = true;
      if (!input.value) input.value = ans.value;
    }

    if (q.type === 'choice') {
      opts.forEach(function (b, i) {
        b.disabled = true;
        if (i === q.answer) b.classList.add('correct');
        else if (i === ans.value) b.classList.add('wrong');
      });
    }

    fb.hidden = false;
    fb.className = 'feedback ' + (ans.correct ? 'ok' : 'no');

    var verdict = el('span', 'verdict', ans.correct ? '答对了' : '不对');
    fb.appendChild(verdict);
    fb.appendChild(document.createTextNode(ans.correct ? ' ' : ' '));

    if (!ans.correct) {
      var right = q.type === 'choice' ? (String.fromCharCode(65 + q.answer) + '. ' + q.options[q.answer]) : q.answer;
      var sp = el('span', 'answer', right);
      var lead = document.createTextNode('正确答案：');
      fb.appendChild(lead);
      fb.appendChild(sp);
      fb.appendChild(document.createTextNode('　'));
    }
    if (q.explain) {
      var exp = el('span');
      exp.textContent = q.explain;
      fb.appendChild(exp);
    }

    var retry = el('button', 'retry', '重做这题');
    retry.type = 'button';
    retry.addEventListener('click', function () {
      delete seg.answers[q.id];
      persist();
      // 恢复可交互状态
      fb.hidden = true;
      fb.innerHTML = '';
      if (row) {
        row.querySelector('input').disabled = false;
        row.querySelector('input').value = ans.value || '';
        row.querySelector('button').disabled = false;
      }
      opts.forEach(function (b) { b.disabled = false; b.classList.remove('correct', 'wrong'); });
      updateProgress();
    });
    fb.appendChild(document.createElement('br'));
    fb.appendChild(retry);
  }

  function onChoice(seg, segIndex, q, idx, box) {
    if (seg.answers[q.id]) return;
    seg.answers[q.id] = { type: 'choice', value: idx, correct: idx === q.answer, at: Date.now() };
    persist();
    applyQuizState(box, seg, q);
    afterAnswer(seg, segIndex);
  }

  function onSubmitFill(seg, segIndex, q, raw, box) {
    if (seg.answers[q.id]) return;
    var val = String(raw || '').trim();
    if (!val) { toast('先写点什么再提交'); return; }
    var correct = isFillCorrect(val, q);
    seg.answers[q.id] = { type: 'fill', value: val, correct: correct, at: Date.now() };
    persist();
    var input = box.querySelector('.fill-row input');
    if (input) input.value = val;
    applyQuizState(box, seg, q);
    afterAnswer(seg, segIndex);
  }

  function normAnswer(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\s，。、；：:,.!?！？"'“”‘’（）()【】\[\]·\-—_＝=]/g, '');
  }

  function isFillCorrect(userRaw, q) {
    var u = normAnswer(userRaw);
    if (!u) return false;
    var pool = [q.answer].concat(q.accept || []);
    for (var i = 0; i < pool.length; i++) {
      var a = normAnswer(pool[i]);
      if (!a) continue;
      if (u === a) return true;
      if (a.length >= 3 && u.indexOf(a) >= 0) return true;
    }
    return false;
  }

  function afterAnswer(seg, segIndex) {
    // 该段还有没做的题 → 冒出下一题
    var nextQ = seg.quiz.find(function (q) { return !seg.answers[q.id]; });
    if (nextQ && !cardEls[nextQ.id]) {
      appendQuizCard(seg, segIndex, nextQ);
      scrollBottom();
    }
    updateComposer();
    updateProgress();
  }

  function segmentDone(seg) {
    return seg.quiz.every(function (q) { return seg.answers[q.id]; });
  }

  function updateComposer() {
    var comp = $('#composer');
    comp.innerHTML = '';
    var inner = el('div', 'composer-inner');
    var lv = current;
    if (!lv) return;

    var seg = lv.segments[lv.cursor];
    var last = lv.cursor >= lv.segments.length - 1;

    if (seg && !segmentDone(seg)) {
      inner.appendChild(el('div', 'step-hint', '完成上面的练习，才能继续下一段'));
    } else if (!last) {
      var b = el('button', 'next-btn', '继续下一段 →');
      b.type = 'button';
      b.addEventListener('click', advance);
      inner.appendChild(b);
      inner.appendChild(el('div', 'step-hint', '还剩 ' + (lv.segments.length - lv.cursor - 1) + ' 段'));
    } else {
      var card = el('div', 'done-card');
      var total = 0, right = 0;
      lv.segments.forEach(function (s) {
        s.quiz.forEach(function (q) {
          var a = s.answers[q.id];
          if (a) { total++; if (a.correct) right++; }
        });
      });
      card.innerHTML = '<h3>这一关通关了</h3>' +
        '<p>共 ' + lv.segments.length + ' 段、' + total + ' 题，答对 ' + right + ' 题。' +
        '记录已保存，随时回来往上翻。</p>';
      inner.appendChild(card);
    }
    comp.appendChild(inner);
  }

  function advance() {
    var lv = current;
    if (lv.cursor >= lv.segments.length - 1) return;
    lv.cursor++;
    persist();
    renderSegment(lv.cursor);
    updateComposer();
    updateProgress();
    scrollBottom();
    renderToc();
  }

  function updateProgress() {
    var lv = current;
    if (!lv) return;
    var total = 0, done = 0;
    lv.segments.forEach(function (s) {
      total += s.quiz.length;
      s.quiz.forEach(function (q) { if (s.answers[q.id]) done++; });
    });
    var pct = total ? Math.round((done / total) * 100) : (lv.cursor >= lv.segments.length - 1 ? 100 : 0);
    $('#level-bar').style.width = pct + '%';
    $('#level-pct').textContent = pct + '%';
  }

  function scrollBottom(instant) {
    var chat = $('#chat');
    if (!chat) return;
    window.requestAnimationFrame(function () {
      chat.scrollTo({ top: chat.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
    });
  }

  /* ================= 目录 ================= */
  function renderToc() {
    var toc = $('#toc');
    toc.innerHTML = '';

    var head = el('div', 'toc-head');
    head.appendChild(el('h4', '', '目录'));
    var close = el('button', 'toc-close', '×');
    close.type = 'button';
    close.title = '收起目录（Esc）';
    close.setAttribute('aria-label', '收起目录');
    close.addEventListener('click', function () { toc.hidden = true; });
    head.appendChild(close);
    toc.appendChild(head);

    var list = el('div', 'toc-list');
    toc.appendChild(list);

    current.segments.forEach(function (s, i) {
      var b = el('button', 'toc-item');
      b.type = 'button';
      var ok = segmentDone(s);
      if (ok) b.classList.add('done');
      if (i === current.cursor) b.classList.add('current');
      b.appendChild(el('span', 'no', ok ? '✓' : String(i + 1).padStart(2, '0')));
      b.appendChild(el('span', '', s.title || ('第 ' + (i + 1) + ' 段')));
      b.disabled = i > current.cursor;
      b.addEventListener('click', function () {
        var target = $('#chat').querySelector('[data-seg="' + i + '"]');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      list.appendChild(b);
    });
  }

  /* ================= 示例关卡 ================= */
  function demoLevel() {
    return {
      id: uid('lv'),
      title: '光合作用：把光变成糖',
      source: '示例 · 生物必修一',
      ext: 'txt',
      createdAt: Date.now(),
      pointCount: 8,
      cursor: 0,
      segments: [
        {
          id: 'sg0',
          title: '光合作用的两个阶段',
          points: ['光反应', '暗反应（卡尔文循环）', '类囊体薄膜', '叶绿体基质'],
          teach: '光合作用不是一步完成的，它分成前后衔接的两半：光反应和暗反应。\n' +
            '光反应发生在类囊体薄膜上。那里的色素分子（主要是叶绿素）吸收光子，把水分解成氧气和氢，' +
            '同时把光能转成两种"临时货币"：ATP 和 NADPH。这一步必须有光，所以叫光反应。\n' +
            '暗反应发生在叶绿体基质里。它不需要光直接参与，但要用掉上一步产出的 ATP 和 NADPH，' +
            '把二氧化碳一步步装进有机物里，最后变成糖。这条循环路径叫卡尔文循环。\n' +
            '容易搞混的地方：暗反应不是"只能在黑暗里进行"，而是"不直接需要光"。' +
            '如果光反应停了，ATP 和 NADPH 断供，暗反应很快也会停下来。',
          quiz: [
            {
              id: 'q0_0', type: 'choice',
              q: '光反应发生的场所是？',
              options: ['叶绿体基质', '类囊体薄膜', '线粒体内膜', '细胞质基质'],
              answer: 1,
              explain: '色素和光反应相关的酶都分布在类囊体薄膜上；叶绿体基质是暗反应的场所。'
            },
            {
              id: 'q0_1', type: 'fill',
              q: '暗反应把二氧化碳固定并最终合成糖的循环路径叫 ____ 循环。',
              answer: '卡尔文', accept: ['卡尔文循环', 'Calvin', 'calvin'],
              explain: '由 Melvin Calvin 发现，所以叫卡尔文循环，发生在叶绿体基质中。'
            }
          ],
          answers: {}
        },
        {
          id: 'sg1',
          title: '为什么光照不足会影响产量',
          points: ['光饱和点', '光补偿点', '限制因子', '呼吸作用'],
          teach: '植物一边光合作用造糖，一边呼吸作用耗糖。光照很弱时，造的还没耗的多，净积累是负的；' +
            '光照逐渐变强，某一点上两者刚好相等，这个点叫光补偿点。\n' +
            '继续加强光照，光合速率会跟着上升，但到某个强度后就不再涨了，这叫光饱和点。' +
            '此时限制光合的不再是光，而是二氧化碳浓度、温度或者酶的数量——这就是"限制因子"的思路。\n' +
            '所以大棚里补光不是越亮越好：如果在光饱和点以下，补光有效；超过饱和点，再多光也白费，' +
            '这时候该补的是二氧化碳。',
          quiz: [
            {
              id: 'q1_0', type: 'choice',
              q: '光合速率不再随光照增强而升高时的光照强度称为？',
              options: ['光补偿点', '光饱和点', '呼吸商', '临界夜长'],
              answer: 1,
              explain: '光补偿点是光合等于呼吸的点；光饱和点才是"再加光也没用"的点。'
            },
            {
              id: 'q1_1', type: 'choice',
              q: '一株植物在光饱和点以上，想继续提高光合速率，最该补充的是？',
              options: ['更强的光照', '二氧化碳浓度', '更多氧气', '更少水分'],
              answer: 1,
              explain: '超过光饱和点后，光已不是限制因子；此时通常二氧化碳浓度成为新的限制因子。'
            }
          ],
          answers: {}
        }
      ]
    };
  }

  function addDemo() {
    var lv = demoLevel();
    persistLevel(lv);
    renderShelf();
    toast('示例已放到书架');
  }

  function persistLevel(lv) {
    writeJSON(keyLevel(lv.id), lv);
    updateIndexEntry(lv);
  }

  /* ================= 上传 ================= */
  function openGen(file) {
    pendingFile = file;
    var ext = (file.name.split('.').pop() || '').toUpperCase();
    $('#gen-file-name').textContent = file.name;
    $('#gen-file-meta').textContent = ext + ' · ' + fmtSize(file.size);
    $('#gen-file-icon').textContent = ext.slice(0, 2);
    $('#gen-setup').hidden = false;
    $('#gen-run').hidden = true;
    $('#gen-log').innerHTML = '';
    $('#gen-modal').hidden = false;

    var est = $('#gen-estimate');
    var mb = file.size / 1024 / 1024;
    var guess = Math.max(1, Math.round(mb * 2.2));
    est.textContent = '文件约 ' + fmtSize(file.size) + '，预计 ' + guess + '-' + (guess * 2) +
      ' 分钟。生成期间请不要关闭页面。';

    if (!settings.key && !settings.mock) {
      est.textContent += '　⚠️ 还没填 API Key，先去「设置」填上，或打开演示模式。';
    }
  }

  async function startGeneration() {
    if (!pendingFile) return;
    if (!settings.key && !settings.mock) {
      $('#gen-modal').hidden = true;
      openSettings();
      toast('先填 API Key，或者打开演示模式');
      return;
    }
    var opts = {
      perGroup: parseInt($('#opt-points').value, 10) || 4,
      perQuiz: parseInt($('#opt-quiz').value, 10) || 2
    };

    $('#gen-setup').hidden = true;
    $('#gen-run').hidden = false;
    $('#gen-bar').style.width = '0%';
    $('#gen-log').innerHTML = '';
    $('#gen-step').textContent = '准备中…';

    abortCtrl = new AbortController();
    var t0 = Date.now();

    var cb = {
      step: function (msg, pct) {
        $('#gen-step').textContent = msg;
        if (pct != null) $('#gen-bar').style.width = Math.round(pct * 100) + '%';
      },
      log: function (msg) {
        var d = el('div', '', msg);
        var logBox = $('#gen-log');
        logBox.appendChild(d);
        logBox.scrollTop = logBox.scrollHeight;
      }
    };

    try {
      var lv = await generateLevel(pendingFile, opts, cb, abortCtrl.signal);
      cb.step('保存关卡…', 1);
      lv.cursor = 0;
      persistLevel(lv);
      await sleep(260);
      $('#gen-modal').hidden = true;
      openLevel(lv.id);
      toast('关卡生成完毕，共 ' + lv.segments.length + ' 段');
    } catch (e) {
      cb.step('出错了', 0);
      cb.log('✗ ' + e.message);
      toast(e.message, 5000);
      $('#gen-run').hidden = true;
      $('#gen-setup').hidden = false;
    } finally {
      abortCtrl = null;
      pendingFile = null;
    }
  }

  /* ================= 设置 ================= */
  function applyPreset(name, fillFields) {
    var p = PRESETS[name] || PRESETS.custom;
    if (fillFields && p.base) {
      $('#set-base').value = p.base;
      $('#set-model').value = p.model;
    }
    var hint = $('#set-hint');
    if (hint) {
      hint.textContent = p.hint || '';
      hint.hidden = !p.hint;
    }
  }

  async function testConnection() {
    var btn = $('#set-test');
    var out = $('#set-test-result');
    if (!btn || !out) return;
    out.hidden = false;
    out.className = 'test-result';
    out.textContent = '正在连接…';
    btn.disabled = true;

    // 临时用界面上的值去试，测完还原（点保存才真正生效）
    var backup = Object.assign({}, settings);
    settings.base = $('#set-base').value.trim() || DEFAULT_SETTINGS.base;
    settings.key = $('#set-key').value.trim();
    settings.model = $('#set-model').value.trim() || 'deepseek-chat';
    settings.proxy = $('#set-proxy').checked;
    settings.proxyUrl = $('#set-proxy-url').value.trim() || DEFAULT_SETTINGS.proxyUrl;
    settings.mock = false;

    try {
      var t0 = Date.now();
      var reply = await callModel([{ role: 'user', content: '只回复两个字：正常' }], {
        maxTokens: 24,
        temperature: 0
      });
      var secs = ((Date.now() - t0) / 1000).toFixed(1);
      out.className = 'test-result ok';
      out.textContent = '连通正常（' + secs + 's）· 模型回复：' + String(reply).trim().slice(0, 40);
    } catch (e) {
      out.className = 'test-result no';
      out.textContent = '连接失败：' + e.message;
    } finally {
      Object.assign(settings, backup);
      btn.disabled = false;
    }
  }

  function openSettings() {
    $('#set-base').value = settings.base;
    $('#set-key').value = settings.key;
    $('#set-model').value = settings.model;
    $('#set-proxy').checked = !!settings.proxy;
    $('#set-proxy-url').value = settings.proxyUrl;
    $('#set-mock').checked = !!settings.mock;

    var name = PRESETS[settings.preset] ? settings.preset : 'custom';
    var sel = $('#set-preset');
    if (sel) sel.value = name;
    applyPreset(name, false);

    var out = $('#set-test-result');
    if (out) { out.hidden = true; out.textContent = ''; }
    $('#set-modal').hidden = false;
  }

  function saveSettingsFromUI() {
    settings.base = $('#set-base').value.trim() || DEFAULT_SETTINGS.base;
    settings.key = $('#set-key').value.trim();
    settings.model = $('#set-model').value.trim() || 'deepseek-chat';
    settings.proxy = $('#set-proxy').checked;
    settings.proxyUrl = $('#set-proxy-url').value.trim() || DEFAULT_SETTINGS.proxyUrl;
    settings.mock = $('#set-mock').checked;
    settings.preset = $('#set-preset').value || 'custom';
    saveSettings();
    $('#set-modal').hidden = true;
    toast('设置已保存');
  }

  /* ================= 事件绑定 ================= */
  function bind() {
    $('#btn-upload').addEventListener('click', function () { $('#file-input').click(); });
    $('#file-input').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) openGen(f);
      e.target.value = '';
    });

    var dz = $('#dropzone');
    dz.addEventListener('click', function () { $('#file-input').click(); });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file-input').click(); }
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); });
    });
    dz.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) openGen(f);
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      if (e.target.closest && e.target.closest('#dropzone')) return;
      e.preventDefault();
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) openGen(f);
    });

    $('#btn-settings').addEventListener('click', openSettings);
    $('#set-preset').addEventListener('change', function () { applyPreset(this.value, true); });
    $('#set-test').addEventListener('click', testConnection);
    $('#set-cancel').addEventListener('click', function () { $('#set-modal').hidden = true; });
    $('#set-save').addEventListener('click', saveSettingsFromUI);
    $('#set-proxy').addEventListener('change', function () {
      $('.proxy-field').style.opacity = this.checked ? '1' : '0.5';
    });

    $('#gen-cancel').addEventListener('click', function () {
      $('#gen-modal').hidden = true;
      pendingFile = null;
    });
    $('#gen-start').addEventListener('click', startGeneration);
    $('#gen-stop').addEventListener('click', function () {
      if (abortCtrl) abortCtrl.abort();
      $('#gen-run').hidden = true;
      $('#gen-setup').hidden = false;
      toast('已停止');
    });

    $('#btn-back').addEventListener('click', function () {
      current = null;
      showView('shelf');
    });
    $('#btn-toc').addEventListener('click', function () {
      var t = $('#toc');
      t.hidden = !t.hidden;
      if (!t.hidden) renderToc();
    });
    // 点目录外面也能收起
    document.addEventListener('click', function (e) {
      var toc = $('#toc');
      if (toc.hidden) return;
      if (e.target.closest && (e.target.closest('#toc') || e.target.closest('#btn-toc'))) return;
      toc.hidden = true;
    });
    $('#btn-del').addEventListener('click', function () {
      if (!current) return;
      if (!confirm('删除《' + current.title + '》？')) return;
      try { localStorage.removeItem(keyLevel(current.id)); } catch (e) { /* ignore */ }
      saveIndex(getIndex().filter(function (x) { return x.id !== current.id; }));
      current = null;
      showView('shelf');
      toast('已删除');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        $('#gen-modal').hidden = true;
        $('#set-modal').hidden = true;
        $('#toc').hidden = true;
      }
    });
  }

  /* ================= 启动 ================= */
  function init() {
    bind();
    renderShelf();

    if (!localStorage.getItem(KEY_INDEX)) {
      // 第一次来：给个示例，别让书架空着
      var empty = $('#shelf-empty');
      if (empty) {
        var btn = el('button', 'ghost', '先看一个示例关卡');
        btn.type = 'button';
        btn.style.marginTop = '14px';
        btn.addEventListener('click', function () { addDemo(); openLevel(getIndex()[0].id); });
        empty.appendChild(btn);
      }
    }

    if (!localStorage.getItem(KEY_SET)) {
      setTimeout(openSettings, 400);
    }

    // 测试钩子
    window.STUDY = {
      get settings() { return settings; },
      get current() { return current; },
      openLevel: openLevel,
      addDemo: addDemo,
      demoLevel: demoLevel,
      generateLevel: generateLevel,
      parseFile: parseFile,
      chunkText: chunkText,
      parseJSON: parseJSON,
      isFillCorrect: isFillCorrect,
      normalizeQuiz: normalizeQuiz,
      persistLevel: persistLevel,
      renderShelf: renderShelf,
      showView: showView,
      setSettings: function (patch) { Object.assign(settings, patch); saveSettings(); }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
