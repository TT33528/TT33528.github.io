//由 config.json 的 script 字段以 <script src> 外链加载，仅作用于文章页。
(function () {
    'use strict';

    /* ================= 通用小工具（与 allhead.js 各自独立，不共享全局变量） ================= */

    var TAG = '[tt-post]';

    function warn(name, err) {
        try { if (window.console && console.warn) console.warn(TAG + ' ' + name + ' 失败：', err); } catch (e) { }
    }

    function onReady(fn) {
        if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn, false); }
        else { fn(); }
    }

    function onLoad(fn) {
        if (document.readyState === 'complete') { fn(); return; }
        window.addEventListener('load', fn, false);
    }

    function bindScroll(fn) {
        try { window.addEventListener('scroll', fn, { passive: true }); }
        catch (e) { window.addEventListener('scroll', fn, false); }
    }

    function reducedMotion() {
        try {
            return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (e) { return false; }
    }

    function getScrollTop() {
        return window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }

    function scrollToY(y) {
        if (y < 0) { y = 0; }
        if (reducedMotion()) { window.scrollTo(0, y); return; }
        try { window.scrollTo({ top: y, behavior: 'smooth' }); }
        catch (e) { window.scrollTo(0, y); }
    }

    function rafThrottle(fn) {
        var ticking = false;
        var raf = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
        return function () {
            if (ticking) { return; }
            ticking = true;
            raf(function () { ticking = false; fn(); });
        };
    }

    // 与 allhead.js 里同名函数保持一致（两边都靠它给标题补 id）
    function slugify(text) {
        var s = String(text == null ? '' : text).toLowerCase().replace(/[\s\u3000]+/g, '-');
        s = s.replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-z0-9-]/g, '');
        s = s.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
        if (!s) { s = 'section'; }
        if (/^[0-9]/.test(s)) { s = 'h-' + s; }
        return s;
    }

    function uniqueSlug(base, used) {
        var id = base;
        var n = 1;
        while (used[id] || document.getElementById(id)) { n++; id = base + '-' + n; }
        return id;
    }

    // 取标题纯文本：排除 allhead.js 插入的 .tt-anchor 与 svg，避免污染目录文案
    function headingText(head) {
        var clone = head.cloneNode(true);
        var extras = clone.querySelectorAll('.tt-anchor, svg, .anchor');
        for (var i = extras.length - 1; i >= 0; i--) {
            if (extras[i].parentNode) { extras[i].parentNode.removeChild(extras[i]); }
        }
        return (clone.textContent || '').replace(/\s+/g, ' ').trim();
    }

    // 固定/吸顶页头的高度偏移，跳转时留出空间
    function headerOffset() {
        var header = document.getElementById('header');
        if (!header) { return 12; }
        var pos = '';
        try { pos = window.getComputedStyle(header).position; } catch (e) { pos = ''; }
        if (pos === 'fixed' || pos === 'sticky') {
            return (header.getBoundingClientRect().height || 0) + 12;
        }
        return 12;
    }

    /* ================= 1. 文章目录 #tt-toc / #tt-toc-btn ================= */

    function featureToc() {
        var body = document.getElementById('postBody');
        if (!body) { return; }
        if (document.getElementById('tt-toc') || document.getElementById('tt-toc-btn')) { return; } // 幂等

        var nodes = body.querySelectorAll('h2, h3, h4');
        var heads = [];
        var used = {};
        var i;

        for (i = 0; i < nodes.length; i++) {
            if (nodes[i].id) { used[nodes[i].id] = true; }
        }
        for (i = 0; i < nodes.length; i++) {
            if (!(nodes[i].textContent || '').replace(/\s+/g, '')) { continue; } // 空标题不进目录
            heads.push(nodes[i]);
        }
        if (heads.length < 3) { return; } // 标题太少就不生成，避免出现无用按钮

        var list = document.createElement('div');
        list.className = 'tt-toc-list';

        var entries = [];   // [{ link, head }]
        var indexById = {}; // id -> entries 下标

        for (i = 0; i < heads.length; i++) {
            var head = heads[i];
            var level = Number(head.tagName.charAt(1)) || 2;
            if (!head.id) { head.id = uniqueSlug(slugify(headingText(head)), used); }
            used[head.id] = true;

            var link = document.createElement('a');
            link.className = 'tt-toc-link';
            link.setAttribute('data-level', String(level));
            link.setAttribute('href', '#' + head.id);
            link.textContent = headingText(head) || head.id;
            list.appendChild(link);

            indexById[head.id] = entries.length;
            entries.push({ link: link, head: head });
        }

        var toc = document.createElement('nav');
        toc.id = 'tt-toc';
        toc.setAttribute('aria-label', '文章目录');
        toc.appendChild(list);

        var btn = document.createElement('button');
        btn.id = 'tt-toc-btn';
        btn.type = 'button';
        btn.setAttribute('aria-controls', 'tt-toc');
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = '目录';

        var content = document.getElementById('content') || body.parentNode;
        if (!content) { return; }
        content.insertBefore(toc, content.firstChild); // 最终顺序：btn 在前、面板在后
        content.insertBefore(btn, content.firstChild);

        var current = -1;
        var offsets = [];

        function setActive(idx) {
            if (idx === current) { return; }
            current = idx;
            for (var k = 0; k < entries.length; k++) {
                if (k === idx) { entries[k].link.classList.add('tt-active'); }
                else { entries[k].link.classList.remove('tt-active'); }
            }
        }

        function measure() {
            var base = getScrollTop();
            for (var k = 0; k < entries.length; k++) {
                offsets[k] = entries[k].head.getBoundingClientRect().top + base;
            }
        }

        var updateActive = rafThrottle(function () {
            if (!offsets.length) { return; }
            var line = getScrollTop() + headerOffset() + 24;
            var idx = 0;
            for (var k = 0; k < offsets.length; k++) {
                if (offsets[k] <= line) { idx = k; }
            }
            // 已经滚到底：直接高亮最后一节
            var doc = document.documentElement;
            if (getScrollTop() + (window.innerHeight || 0) >= (doc.scrollHeight || 0) - 2) {
                idx = offsets.length - 1;
            }
            setActive(idx);
        });

        function setOpen(open) {
            if (open) { toc.classList.add('tt-open'); }
            else { toc.classList.remove('tt-open'); }
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            setOpen(!toc.classList.contains('tt-open'));
        }, false);

        // 点击面板外收起
        document.addEventListener('click', function (e) {
            if (!toc.classList.contains('tt-open')) { return; }
            if (toc.contains(e.target) || btn.contains(e.target)) { return; }
            setOpen(false);
        }, false);

        // Esc 收起
        document.addEventListener('keydown', function (e) {
            var key = e.key || e.keyCode;
            if (key === 'Escape' || key === 'Esc' || key === 27) { setOpen(false); }
        }, false);

        list.addEventListener('click', function (e) {
            var target = e.target;
            var link = (target && target.closest) ? target.closest('a.tt-toc-link') : null;
            if (!link) { return; }
            var id = (link.getAttribute('href') || '').slice(1);
            var heading = id ? document.getElementById(id) : null;
            if (!heading) { return; }
            e.preventDefault();
            scrollToY(heading.getBoundingClientRect().top + getScrollTop() - headerOffset());
            try { history.replaceState(null, '', '#' + id); } catch (err) { }
            if (indexById[id] != null) { setActive(indexById[id]); }
        }, false);

        // 宽屏默认展开，窄屏默认收起
        try {
            if (window.matchMedia && window.matchMedia('(min-width: 1100px)').matches) { setOpen(true); }
        } catch (e) { }

        var remeasure = rafThrottle(function () { measure(); updateActive(); });
        bindScroll(updateActive);
        window.addEventListener('resize', remeasure, false);
        onLoad(function () { try { measure(); updateActive(); } catch (e) { warn('目录高亮重算', e); } });

        measure();
        updateActive();
    }

    /* ================= 2. 阅读时长 / 字数统计 #tt-meta ================= */

    function featureMeta() {
        var body = document.getElementById('postBody');
        if (!body) { return; }
        if (document.getElementById('tt-meta')) { return; } // 幂等

        // 克隆一份来统计，剔除脚本/样式/自带锚点，避免把非正文内容算进去
        var clone = body.cloneNode(true);
        var drop = clone.querySelectorAll('script, style, noscript, .tt-anchor, [id^="tt-"]');
        for (var i = drop.length - 1; i >= 0; i--) {
            if (drop[i].parentNode) { drop[i].parentNode.removeChild(drop[i]); }
        }

        var text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
        var noSpace = text.replace(/\s/g, '').length;
        if (!noSpace) { return; } // 空文章不显示

        var cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
        var words = (text.match(/[A-Za-z0-9][A-Za-z0-9'_-]*/g) || []).length;
        // 中文按 400 字/分钟、英文按 200 词/分钟估算，向上取整，最少 1 分钟
        var minutes = Math.ceil(cjk / 400 + words / 200);
        if (minutes < 1) { minutes = 1; }

        var meta = document.createElement('div');
        meta.id = 'tt-meta';
        meta.textContent = '约 ' + noSpace + ' 字符 · 中文 ' + cjk + ' 字 · 阅读约 ' + minutes + ' 分钟';
        body.appendChild(meta);
    }

    /* ================= 装配：每个功能独立 try/catch，互不影响 ================= */

    onReady(function () {
        // allhead.js 的 DOMContentLoaded 回调先注册、先执行，此时标题 id 已就绪，TOC 直接复用
        try { featureToc(); } catch (e) { warn('文章目录', e); }
        try { featureMeta(); } catch (e) { warn('阅读统计', e); }
    });
})();
