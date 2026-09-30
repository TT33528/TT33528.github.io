//由 config.json 的 indexScript 字段以 <script src> 外链加载，仅作用于首页（列表页）。
(function () {
    'use strict';

    var TAG = '[tt-index]';

    function warn(name, err) {
        try { if (window.console && console.warn) console.warn(TAG + ' ' + name + ' 失败：', err); } catch (e) { }
    }

    function onReady(fn) {
        if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn, false); }
        else { fn(); }
    }

    // 列表项：真实 DOM 里 a.SideNav-item 直接挂在 nav.SideNav 下；
    // 若被包了一层等宽的 div 包裹层，就隐藏包裹层，避免留下空行
    function collectItems(nav) {
        var anchors = nav.querySelectorAll('a.SideNav-item');
        var items = [];
        for (var i = 0; i < anchors.length; i++) {
            var a = anchors[i];
            var host = (a.parentNode && a.parentNode !== nav) ? a.parentNode : a;
            items.push({ anchor: a, host: host, tags: [] });
        }
        return items;
    }

    // 标签名取自 .LabelName 内的 <a>（真实结构：span.Label.LabelName > object > a）
    // 返回 [{ key, name }]，key 用于匹配（忽略大小写），name 是首次出现时的原始写法
    function readTags(anchor) {
        var labels = anchor.querySelectorAll('.LabelName');
        var tags = [];
        var seen = {};
        for (var i = 0; i < labels.length; i++) {
            var inner = labels[i].querySelector('a');
            var name = ((inner || labels[i]).textContent || '').replace(/\s+/g, ' ').trim();
            if (!name) { continue; }
            var key = name.toLowerCase();
            if (seen[key]) { continue; }
            seen[key] = true;
            tags.push({ key: key, name: name });
        }
        return tags;
    }

    /* ================= 1. 标签筛选 #tt-filter ================= */

    function featureFilter() {
        var nav = document.querySelector('nav.SideNav');
        if (!nav) { return; }
        if (document.getElementById('tt-filter')) { return; } // 幂等

        var items = collectItems(nav);
        if (!items.length) { return; }

        var dict = {};   // key -> { key, name, count }
        var order = [];
        var i, j;

        for (i = 0; i < items.length; i++) {
            var tags = readTags(items[i].anchor);
            items[i].tags = tags.map(function (t) { return t.key; });
            for (j = 0; j < tags.length; j++) {
                var key = tags[j].key;
                if (!dict[key]) {
                    dict[key] = { key: key, name: tags[j].name, count: 0 };
                    order.push(dict[key]);
                }
                dict[key].count++;
            }
        }

        if (!order.length) { return; } // 无标签：不渲染筛选栏

        order.sort(function (x, y) {
            if (y.count !== x.count) { return y.count - x.count; }
            try { return x.name.localeCompare(y.name, 'zh'); } catch (e) { return x.name < y.name ? -1 : 1; }
        });

        var bar = document.createElement('div');
        bar.id = 'tt-filter';
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', '按标签筛选文章');

        var buttons = [];

        function makeButton(text, title, key) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'tt-filter-btn';
            b.textContent = text;
            if (title) { b.setAttribute('title', title); }
            b.setAttribute('aria-pressed', 'false');
            b.setAttribute('data-tt-tag', key);
            bar.appendChild(b);
            buttons.push(b);
            return b;
        }

        function apply(key) {
            for (var k = 0; k < items.length; k++) {
                // 用内联 display 控制，不依赖外部 CSS，保证一定生效；只切换显隐，绝不动 DOM 顺序
                var visible = (key === '' || items[k].tags.indexOf(key) !== -1);
                items[k].host.style.display = visible ? '' : 'none';
            }
            for (var m = 0; m < buttons.length; m++) {
                var on = buttons[m].getAttribute('data-tt-tag') === key;
                if (on) { buttons[m].classList.add('tt-active'); }
                else { buttons[m].classList.remove('tt-active'); }
                buttons[m].setAttribute('aria-pressed', on ? 'true' : 'false');
            }
            // 高度变了，通知进度条 / 回到顶部重算
            try { window.dispatchEvent(new Event('resize')); } catch (e) { }
        }

        var all = makeButton('全部', '共 ' + items.length + ' 篇', '');
        all.classList.add('tt-active');
        all.setAttribute('aria-pressed', 'true');

        for (i = 0; i < order.length; i++) {
            makeButton(order[i].name, '共 ' + order[i].count + ' 篇', order[i].key);
        }

        bar.addEventListener('click', function (e) {
            var t = e.target;
            var b = (t && t.closest) ? t.closest('button.tt-filter-btn') : null;
            if (!b) { return; }
            apply(b.getAttribute('data-tt-tag') || '');
        }, false);

        var content = document.getElementById('content') || nav.parentNode;
        if (!content) { return; }
        content.insertBefore(bar, nav);
    }

    /* ================= 2. 站点统计 #tt-count ================= */

    function featureCount() {
        var nav = document.querySelector('nav.SideNav');
        if (!nav) { return; }
        if (document.getElementById('tt-count')) { return; } // 幂等

        var total = nav.querySelectorAll('a.SideNav-item').length;
        if (!total) { return; }

        var count = document.createElement('span');
        count.id = 'tt-count';
        count.textContent = '共 ' + total + ' 篇文章';

        // 副标题是 #content 里第一个 div（无 id）
        var host = null;
        var content = document.getElementById('content');
        if (content) {
            var kids = content.children;
            for (var i = 0; i < kids.length; i++) {
                if (kids[i].tagName === 'DIV') { host = kids[i]; break; }
            }
        }

        if (host) {
            host.appendChild(document.createTextNode(' '));
            host.appendChild(count);
        } else if (content) {
            content.insertBefore(count, content.firstChild);
        }
    }

    /* ================= 装配：每个功能独立 try/catch，互不影响 ================= */

    onReady(function () {
        try { featureFilter(); } catch (e) { warn('标签筛选', e); }
        try { featureCount(); } catch (e) { warn('站点统计', e); }
    });
})();
