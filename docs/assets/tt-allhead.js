//由 config.json 的 allHead 字段以 <script src> 外链加载，作用于全站所有页面。
//注意：注入时 <body> 尚不存在，所有逻辑都包在 DOMContentLoaded 回调里。
(function () {
    'use strict';

    /* ================= 通用小工具（不挂任何全局变量） ================= */

    var TAG = '[tt]';

    function warn(name, err) {
        try { if (window.console && console.warn) console.warn(TAG + ' ' + name + ' 失败：', err); } catch (e) { }
    }

    // allHead 注入时 body 还不存在，必须等 DOM 就绪
    function onReady(fn) {
        if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn, false); }
        else { fn(); }
    }

    function onLoad(fn) {
        if (document.readyState === 'complete') { fn(); return; }
        window.addEventListener('load', fn, false);
    }

    // passive 不被支持的老浏览器会忽略 options 对象，这里做一次降级
    function bindScroll(fn) {
        try { window.addEventListener('scroll', fn, { passive: true }); }
        catch (e) { window.addEventListener('scroll', fn, false); }
    }

    function bindResize(fn) { window.addEventListener('resize', fn, false); }

    function reducedMotion() {
        try {
            return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (e) { return false; }
    }

    function getScrollTop() {
        return window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }

    function getMaxScroll() {
        var doc = document.documentElement;
        var body = document.body;
        var height = Math.max(doc.scrollHeight, body ? body.scrollHeight : 0);
        var view = window.innerHeight || doc.clientHeight || 0;
        return Math.max(0, height - view);
    }

    function scrollToY(y) {
        if (y < 0) { y = 0; }
        if (reducedMotion()) { window.scrollTo(0, y); return; }
        try { window.scrollTo({ top: y, behavior: 'smooth' }); }
        catch (e) { window.scrollTo(0, y); } // 不支持 options 对象时直接跳
    }

    // rAF 节流，滚动回调只跑一帧一次
    function rafThrottle(fn) {
        var ticking = false;
        var raf = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
        return function () {
            if (ticking) { return; }
            ticking = true;
            raf(function () { ticking = false; fn(); });
        };
    }

    function makeEl(tag, className) {
        var node = document.createElement(tag);
        if (className) { node.className = className; }
        return node;
    }

    // 中文友好 slug：保留中文/字母/数字，空白转连字符，其余符号去掉
    // 注意：post.js 里有一份完全相同的实现（两个文件互不依赖），改动时请同步
    function slugify(text) {
        var s = String(text == null ? '' : text).toLowerCase().replace(/[\s\u3000]+/g, '-');
        s = s.replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-z0-9-]/g, '');
        s = s.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
        if (!s) { s = 'section'; }
        if (/^[0-9]/.test(s)) { s = 'h-' + s; } // 避免生成 CSS 选择器里非法的 id
        return s;
    }

    function uniqueSlug(base, used) {
        var id = base;
        var n = 1;
        while (used[id] || document.getElementById(id)) { n++; id = base + '-' + n; }
        return id;
    }

    // 复制：优先 Clipboard API，失败降级到 execCommand
    function legacyCopy(text) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            if (ta.setSelectionRange) { ta.setSelectionRange(0, ta.value.length); }
            document.execCommand('copy');
            document.body.removeChild(ta);
        } catch (e) { warn('复制到剪贴板', e); }
    }

    function copyText(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                var p = navigator.clipboard.writeText(text);
                if (p && typeof p.catch === 'function') { p.catch(function () { legacyCopy(text); }); }
                return;
            }
        } catch (e) { }
        legacyCopy(text);
    }

    /* ================= 1. 阅读进度条 #tt-progress ================= */

    function featureProgress() {
        var bar = document.getElementById('tt-progress');
        if (!bar) {
            bar = makeEl('div');
            bar.id = 'tt-progress';
            bar.setAttribute('aria-hidden', 'true');
            document.body.appendChild(bar);
        }

        var update = function () {
            var max = getMaxScroll();
            var pct = max > 0 ? getScrollTop() / max : 0;
            if (pct < 0) { pct = 0; }
            if (pct > 1) { pct = 1; }
            bar.style.width = (pct * 100).toFixed(2) + '%';
        };
        var onScroll = rafThrottle(update);

        bindScroll(onScroll);
        bindResize(onScroll);
        onLoad(update);
        update();
    }

    /* ================= 2. 回到顶部 #tt-top ================= */

    function featureTop() {
        var btn = document.getElementById('tt-top');
        if (!btn) {
            btn = makeEl('button');
            btn.id = 'tt-top';
            btn.type = 'button';
            btn.setAttribute('aria-label', '回到顶部');
            btn.setAttribute('title', '回到顶部');
            btn.textContent = '↑';
            document.body.appendChild(btn);
        }

        var update = function () {
            // 超过一屏才出现
            if (getScrollTop() > (window.innerHeight || 0)) { btn.classList.remove('tt-hide'); }
            else { btn.classList.add('tt-hide'); }
        };
        var onScroll = rafThrottle(update);

        btn.addEventListener('click', function (e) {
            e.preventDefault();
            scrollToY(0);
        }, false);

        bindScroll(onScroll);
        bindResize(onScroll);
        update();
    }

    /* ================= 3. 图片灯箱 #tt-lightbox ================= */

    function featureLightbox() {
        var box = document.getElementById('tt-lightbox');
        var img = null;
        var closeBtn = null;

        if (!box) {
            box = makeEl('div');
            box.id = 'tt-lightbox';
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');
            box.setAttribute('aria-hidden', 'true');

            img = makeEl('img', 'tt-lightbox-img');
            img.alt = '';

            closeBtn = makeEl('button', 'tt-lightbox-close');
            closeBtn.type = 'button';
            closeBtn.setAttribute('aria-label', '关闭图片预览');
            closeBtn.textContent = '×';

            box.appendChild(img);
            box.appendChild(closeBtn);
            document.body.appendChild(box);
        } else {
            img = box.querySelector('.tt-lightbox-img');
            closeBtn = box.querySelector('.tt-lightbox-close');
        }
        if (!img || !closeBtn) { return; }

        var locked = { overflow: '', paddingRight: '' };

        function lockBody() {
            var body = document.body;
            locked.overflow = body.style.overflow;
            locked.paddingRight = body.style.paddingRight;
            var gap = (window.innerWidth || 0) - (document.documentElement.clientWidth || 0);
            if (gap > 0) {
                var pad = 0;
                try { pad = parseFloat(window.getComputedStyle(body).paddingRight) || 0; } catch (e) { pad = 0; }
                body.style.paddingRight = (pad + gap) + 'px'; // 补滚动条宽度，避免打开时页面横向抖动
            }
            body.style.overflow = 'hidden';
        }

        function unlockBody() {
            var body = document.body;
            body.style.overflow = locked.overflow;
            body.style.paddingRight = locked.paddingRight;
        }

        function open(src, alt) {
            if (!src) { return; }
            img.src = src;
            img.alt = alt || '';
            box.setAttribute('aria-hidden', 'false');
            box.classList.add('tt-open');
            lockBody();
            try { closeBtn.focus(); } catch (e) { }
        }

        function close() {
            if (!box.classList.contains('tt-open')) { return; }
            box.classList.remove('tt-open');
            box.setAttribute('aria-hidden', 'true');
            img.removeAttribute('src');
            unlockBody();
        }

        // 点遮罩 / 关闭按钮关闭，点图片本身不关闭
        box.addEventListener('click', function (e) {
            if (e.target === closeBtn || closeBtn.contains(e.target)) { close(); return; }
            if (e.target === box) { close(); }
        }, false);

        document.addEventListener('keydown', function (e) {
            var key = e.key || e.keyCode;
            if ((key === 'Escape' || key === 'Esc' || key === 27) && box.classList.contains('tt-open')) { close(); }
        }, false);

        // 正文/页面图片：排除头像、灯箱自身与显式声明 data-tt-nozoom 的图
        var nodes = document.querySelectorAll('#postBody img, .markdown-body img, #content img');
        for (var i = 0; i < nodes.length; i++) {
            (function (node) {
                if (node.id === 'avatarImg') { return; }
                if (node.classList.contains('tt-lightbox-img')) { return; }
                if (node.getAttribute('data-tt-nozoom') !== null) { return; }
                if (node.getAttribute('data-tt-zoom') === '1') { return; } // 幂等
                node.setAttribute('data-tt-zoom', '1');
                node.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    open(node.currentSrc || node.src, node.getAttribute('alt') || '');
                }, false);
            })(nodes[i]);
        }
    }

    /* ================= 4. 外链处理 ================= */

    function injectExternalStyle() {
        if (document.querySelector('style[data-tt="external"]')) { return; }
        var style = document.createElement('style');
        style.setAttribute('data-tt', 'external');
        // 用内容转义写箭头，避免文件编码影响；颜色走 CSS 变量并有 fallback
        style.textContent =
            '.tt-external::after{content:"\\2197";display:inline-block;margin-left:.15em;' +
            'font-size:.72em;line-height:1;vertical-align:.55em;opacity:.6;' +
            'color:var(--tt-accent,currentColor);text-decoration:none;}';
        (document.head || document.documentElement).appendChild(style);
    }

    function featureExternal() {
        var links = document.querySelectorAll('a[href]');
        var here = window.location.hostname;
        var painted = false;

        for (var i = 0; i < links.length; i++) {
            var a = links[i];
            var raw = a.getAttribute('href');
            if (!raw || /^(#|mailto:|tel:|javascript:|data:)/i.test(raw)) { continue; }

            var url = null;
            try { url = new URL(a.href, window.location.href); } catch (e) { continue; }
            if (!/^https?:$/i.test(url.protocol)) { continue; }
            if (url.hostname === here) { continue; } // 站内

            if (a.getAttribute('data-tt-external') === '1') { continue; } // 幂等
            a.setAttribute('data-tt-external', '1');
            a.setAttribute('target', '_blank');

            var rel = (a.getAttribute('rel') || '').toLowerCase();
            var add = [];
            if (rel.indexOf('noopener') === -1) { add.push('noopener'); }
            if (rel.indexOf('noreferrer') === -1) { add.push('noreferrer'); }
            if (add.length) { a.setAttribute('rel', (rel ? rel + ' ' : '') + add.join(' ')); }

            // 只给「有文字」的链接加图标：头部纯图标按钮、导航类链接加了会破坏排版
            var hasText = !!(a.textContent || '').replace(/\s+/g, '');
            var inHeader = !!(a.closest && a.closest('#header'));
            if (hasText && !inHeader) {
                a.classList.add('tt-external');
                painted = true;
            }
        }

        if (painted) { injectExternalStyle(); }
    }

    /* ================= 5. 正文标题锚点 .tt-anchor ================= */

    function featureAnchor() {
        var scope = document.getElementById('postBody') || document.querySelector('.markdown-body');
        if (!scope) { return; } // 首页 / tag 页没有正文，直接跳过

        var heads = scope.querySelectorAll('h1, h2, h3, h4, h5, h6');
        var used = {};
        var i;
        for (i = 0; i < heads.length; i++) {
            if (heads[i].id) { used[heads[i].id] = true; }
        }

        for (i = 0; i < heads.length; i++) {
            (function (head) {
                if (head.getAttribute('data-tt-anchor') === '1') { return; } // 幂等，避免重复插入
                if (!(head.textContent || '').replace(/\s+/g, '')) { return; } // 空标题不加
                head.setAttribute('data-tt-anchor', '1');

                if (!head.id) { head.id = uniqueSlug(slugify(head.textContent), used); }
                used[head.id] = true;

                var anchor = makeEl('a', 'tt-anchor');
                anchor.setAttribute('href', '#' + head.id);
                anchor.setAttribute('title', '复制该标题的链接');
                anchor.setAttribute('aria-label', '复制该标题的链接');
                anchor.textContent = '#';
                head.appendChild(anchor);

                anchor.addEventListener('click', function (e) {
                    e.preventDefault();
                    // 用「去掉 hash 的当前地址 + 新 hash」，file:// 本地预览同样成立
                    var base = window.location.href.split('#')[0];
                    copyText(base + '#' + head.id);
                    try { history.replaceState(null, '', '#' + head.id); } catch (err) { }
                    // 复用契约里的 .tt-active 做一次短暂反馈（样式未定义时无副作用）
                    try {
                        head.classList.add('tt-active');
                        setTimeout(function () { head.classList.remove('tt-active'); }, 600);
                    } catch (err) { }
                }, false);
            })(heads[i]);
        }
    }

    /* ================= 装配：每个功能独立 try/catch，互不影响 ================= */

    onReady(function () {
        try { featureProgress(); } catch (e) { warn('阅读进度条', e); }
        try { featureTop(); } catch (e) { warn('回到顶部', e); }
        try { featureLightbox(); } catch (e) { warn('图片灯箱', e); }
        try { featureExternal(); } catch (e) { warn('外链处理', e); }
        try { featureAnchor(); } catch (e) { warn('标题锚点', e); }
    });
})();
