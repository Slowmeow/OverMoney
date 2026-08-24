/* Небольшой набор графиков на чистом SVG: без библиотек, работает офлайн.
 *
 * Правила, по которым здесь всё построено:
 *  - палитра проверена валидатором на обеих поверхностях приложения, а не на глаз;
 *  - цвет закреплён за сущностью, а не за местом в списке: марка, скрытая
 *    фильтром, не перекрашивает остальные;
 *  - две величины разного масштаба никогда не делят одну ось — вместо второй оси
 *    два отдельных графика;
 *  - у каждого графика есть таблица-близнец: значение можно прочитать без мыши,
 *    и это же закрывает требование по контрасту светлых цветов на белом;
 *  - подписи приходят от пользователя (названия марок), поэтому вставляются
 *    только текстом, никогда как разметка.
 */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';

  // Слоты палитры. Значения задаются в CSS, здесь — только имена ролей,
  // чтобы светлая и тёмная темы переключались в одном месте.
  const SERIES_VARS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];

  function seriesColor(index) {
    // Девятого цвета не бывает: остаток сворачивается в «Прочее» вызывающей стороной.
    return SERIES_VARS[index % SERIES_VARS.length];
  }

  function el(tag, attrs, children) {
    const node = document.createElementNS(NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') node.textContent = v;          // никогда не innerHTML
        else node.setAttribute(k, v);
      });
    }
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  const H = () => window.App.ui.h;

  /* Ширина под экран: на телефоне график не должен уезжать за край. */
  function chartWidth() {
    const available = (window.innerWidth || 760) - 64;
    return Math.max(300, Math.min(760, available));
  }

  /* Круглые деления оси: 0 / 50 / 100, а не 0 / 47,3 / 94,6. */
  function niceScale(min, max, count) {
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (min === max) { max = min + Math.abs(min || 1) * 0.2; min = min - Math.abs(min || 1) * 0.2; }
    const raw = (max - min) / (count || 5);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { min: lo, max: hi, ticks: ticks };
  }

  function fmtInt(v) { return Math.round(v).toLocaleString('ru-RU'); }
  function fmtDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // ---------------------------------------------------------------- каркас

  /* Общая обёртка: заголовок, пояснение, легенда, полотно и таблица-близнец. */
  function figure(opts, svgNode, tableNode) {
    const h = H();
    const parts = [
      h('div.viz-head', {}, [
        h('h3.viz-title', { text: opts.title }),
        opts.subtitle ? h('p.viz-sub', { text: opts.subtitle }) : null
      ])
    ];

    // Легенда обязательна от двух рядов; при одном ряде её роль играет заголовок.
    if (opts.legend && opts.legend.length > 1) {
      parts.push(h('div.viz-legend', {}, opts.legend.map(function (item) {
        return h('span.viz-legend-item', {}, [
          h('span.viz-key' + (item.shape === 'line' ? '.line' : ''), { style: { background: item.color } }),
          h('span', { text: item.name })
        ]);
      })));
    }

    const plot = h('div.viz-plot', {}, svgNode);
    parts.push(plot);

    if (tableNode) {
      const details = h('details.viz-table', {}, [
        h('summary', { text: 'Показать числа' }),
        tableNode
      ]);
      parts.push(details);
    }

    return h('figure.viz', {}, parts);
  }

  /* Всплывающая подсказка живёт над полотном и повторяет то, что и так есть
     в таблице, — она дополняет, а не прячет значения. */
  function makeTip(container) {
    const h = H();
    const tip = h('div.viz-tip', { 'aria-hidden': 'true' });
    container.appendChild(tip);
    return {
      show: function (x, y, rows, head) {
        tip.innerHTML = '';
        tip.appendChild(h('div.viz-tip-head', { text: head }));
        rows.forEach(function (r) {
          tip.appendChild(h('div.viz-tip-row', {}, [
            h('span.viz-tip-key', { style: { background: r.color } }),
            h('span.viz-tip-val', { text: r.value }),
            h('span.viz-tip-name', { text: r.name })
          ]));
        });
        tip.classList.add('on');
        const box = container.getBoundingClientRect();
        const w = tip.offsetWidth || 150;
        tip.style.left = Math.max(4, Math.min(box.width - w - 4, x - w / 2)) + 'px';
        tip.style.top = Math.max(0, y - tip.offsetHeight - 12) + 'px';
      },
      hide: function () { tip.classList.remove('on'); }
    };
  }

  function tableOf(headers, rows) {
    const h = H();
    return h('table.table', {}, [
      h('thead', {}, h('tr', {}, headers.map((t, i) => h(i ? 'th.num' : 'th', { text: t })))),
      h('tbody', {}, rows.map(r => h('tr', {}, r.map((c, i) => h(i ? 'td.num' : 'td', { text: c })))))
    ]);
  }

  // ---------------------------------------------------------------- линии

  /* Несколько рядов во времени. Ось одна: если понадобилась вторая — это два
     разных графика, а не два масштаба на одном полотне. */
  function lineChart(opts) {
    const h = H();
    const series = opts.series.filter(s => s.points && s.points.length);
    const W = chartWidth();
    const HGT = opts.height || 220;
    const m = { t: 10, r: opts.endLabels === false ? 14 : 64, b: 26, l: 52 };

    if (!series.length) return emptyFigure(opts);

    const xs = [];
    series.forEach(s => s.points.forEach(p => { if (xs.indexOf(p.x) === -1) xs.push(p.x); }));
    xs.sort();

    const times = xs.map(x => new Date(x + 'T00:00:00').getTime());
    const tMin = Math.min.apply(null, times);
    const tMax = Math.max.apply(null, times);
    const span = tMax - tMin || 1;

    let vMin = Infinity, vMax = -Infinity;
    series.forEach(s => s.points.forEach(p => { vMin = Math.min(vMin, p.y); vMax = Math.max(vMax, p.y); }));
    const pad = (vMax - vMin) * 0.15 || Math.abs(vMax) * 0.1 || 1;
    const scale = niceScale(opts.zeroBased ? 0 : vMin - pad, vMax + pad, 4);

    const px = t => m.l + (t - tMin) / span * (W - m.l - m.r);
    const py = v => HGT - m.b - (v - scale.min) / (scale.max - scale.min) * (HGT - m.t - m.b);

    const layers = [];

    // Сетка — сплошные волосяные линии, никаких пунктиров.
    scale.ticks.forEach(function (t) {
      layers.push(el('line', { x1: m.l, x2: W - m.r, y1: py(t), y2: py(t), class: 'viz-grid' }));
      layers.push(el('text', { x: m.l - 8, y: py(t) + 4, class: 'viz-tick viz-tick-y', text: opts.yFormat ? opts.yFormat(t) : fmtInt(t) }));
    });

    // Подписи по оси времени: только края и середина, иначе они наезжают.
    const xTicks = xs.length <= 4 ? xs : [xs[0], xs[Math.floor(xs.length / 2)], xs[xs.length - 1]];
    xTicks.forEach(function (x) {
      const t = new Date(x + 'T00:00:00').getTime();
      layers.push(el('text', { x: px(t), y: HGT - 8, class: 'viz-tick viz-tick-x', text: fmtDate(x) }));
    });

    layers.push(el('line', { x1: m.l, x2: W - m.r, y1: HGT - m.b, y2: HGT - m.b, class: 'viz-axis' }));

    series.forEach(function (s, si) {
      const color = s.color || seriesColor(si);
      const pts = s.points.slice().sort((a, b) => (a.x < b.x ? -1 : 1));
      const d = pts.map(function (p, i) {
        const t = new Date(p.x + 'T00:00:00').getTime();
        return (i ? 'L' : 'M') + px(t).toFixed(1) + ' ' + py(p.y).toFixed(1);
      }).join(' ');

      layers.push(el('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

      // Точки с кольцом цвета поверхности — чтобы не слипались на пересечениях.
      pts.forEach(function (p) {
        const t = new Date(p.x + 'T00:00:00').getTime();
        layers.push(el('circle', { cx: px(t), cy: py(p.y), r: 4, fill: color, stroke: 'var(--surface-1)', 'stroke-width': 2 }));
      });

      // Подпись у последней точки — идентичность не должна держаться на цвете.
      if (opts.endLabels !== false) {
        const last = pts[pts.length - 1];
        const t = new Date(last.x + 'T00:00:00').getTime();
        layers.push(el('text', {
          x: px(t) + 9, y: py(last.y) + 4, class: 'viz-endlabel',
          text: (opts.yFormat ? opts.yFormat(last.y) : fmtInt(last.y))
        }));
      }
    });

    const cross = el('line', { x1: 0, x2: 0, y1: m.t, y2: HGT - m.b, class: 'viz-cross', opacity: 0 });
    layers.push(cross);

    const svgNode = el('svg', {
      viewBox: '0 0 ' + W + ' ' + HGT,
      width: '100%', height: 'auto',
      role: 'img', 'aria-label': opts.title
    }, layers);

    const wrap = h('div.viz-canvas', {}, svgNode);
    const tip = makeTip(wrap);

    // Прицел ищет дату: читатель целится в день, а не в двухпиксельную линию.
    function onMove(ev) {
      const box = svgNode.getBoundingClientRect();
      const k = W / box.width;
      const localX = (ev.clientX - box.left) * k;
      let best = xs[0], bestD = Infinity;
      xs.forEach(function (x) {
        const d = Math.abs(px(new Date(x + 'T00:00:00').getTime()) - localX);
        if (d < bestD) { bestD = d; best = x; }
      });
      const t = new Date(best + 'T00:00:00').getTime();
      cross.setAttribute('x1', px(t));
      cross.setAttribute('x2', px(t));
      cross.setAttribute('opacity', 1);

      const rows = [];
      series.forEach(function (s, si) {
        const hit = s.points.find(p => p.x === best);
        if (!hit) return;
        rows.push({
          color: s.color || seriesColor(si),
          name: s.name,
          value: opts.yFormat ? opts.yFormat(hit.y) : fmtInt(hit.y)
        });
      });
      if (!rows.length) return;
      tip.show(px(t) / k, py(rows.length ? scale.max : 0) / k, rows, fmtDate(best));
    }

    svgNode.addEventListener('pointermove', onMove);
    svgNode.addEventListener('pointerleave', function () {
      cross.setAttribute('opacity', 0);
      tip.hide();
    });

    const rows = xs.map(function (x) {
      return [fmtDate(x)].concat(series.map(function (s) {
        const hit = s.points.find(p => p.x === x);
        return hit ? (opts.yFormat ? opts.yFormat(hit.y) : fmtInt(hit.y)) : '—';
      }));
    });

    return figure(
      Object.assign({}, opts, {
        legend: series.map((s, i) => ({ name: s.name, color: s.color || seriesColor(i), shape: 'line' }))
      }),
      wrap,
      tableOf(['Дата'].concat(series.map(s => s.name)), rows)
    );
  }

  // ---------------------------------------------------------------- столбики

  /* Сгруппированные столбики с линией ориентира (бюджет).
     Ориентир — не ряд данных, поэтому рисуется чертой, а не третьим цветом. */
  function groupedBars(opts) {
    const h = H();
    const groups = opts.groups || [];
    if (!groups.length) return emptyFigure(opts);

    const W = chartWidth();
    const HGT = opts.height || 240;
    const m = { t: 14, r: 14, b: 34, l: 56 };

    const names = [];
    groups.forEach(g => g.values.forEach(v => { if (names.indexOf(v.name) === -1) names.push(v.name); }));

    let vMax = 0;
    groups.forEach(g => g.values.forEach(v => { vMax = Math.max(vMax, v.value); }));
    if (opts.refLine) vMax = Math.max(vMax, opts.refLine.value);
    const scale = niceScale(0, vMax, 4);   // столбики всегда от нуля

    const plotW = W - m.l - m.r;
    const band = plotW / groups.length;
    const barW = Math.min(24, (band - 10) / Math.max(1, names.length) - 2);   // 2px воздуха между соседями
    const py = v => HGT - m.b - v / (scale.max || 1) * (HGT - m.t - m.b);

    const layers = [];
    scale.ticks.forEach(function (t) {
      layers.push(el('line', { x1: m.l, x2: W - m.r, y1: py(t), y2: py(t), class: 'viz-grid' }));
      layers.push(el('text', { x: m.l - 8, y: py(t) + 4, class: 'viz-tick viz-tick-y', text: fmtInt(t) }));
    });

    const bars = [];
    groups.forEach(function (g, gi) {
      const groupW = names.length * (barW + 2) - 2;
      const x0 = m.l + band * gi + (band - groupW) / 2;

      g.values.forEach(function (v, vi) {
        const color = seriesColor(names.indexOf(v.name));
        const x = x0 + vi * (barW + 2);
        const y = py(v.value);
        const height = Math.max(1, HGT - m.b - y);
        // Скруглённый верх, прямая опора на базовую линию.
        const r = Math.min(4, barW / 2, height);
        const d = 'M' + x + ' ' + (HGT - m.b) +
          ' L' + x + ' ' + (y + r) +
          ' Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y +
          ' L' + (x + barW - r) + ' ' + y +
          ' Q' + (x + barW) + ' ' + y + ' ' + (x + barW) + ' ' + (y + r) +
          ' L' + (x + barW) + ' ' + (HGT - m.b) + ' Z';
        const bar = el('path', { d: d, fill: color, class: 'viz-bar' });
        bars.push({ node: bar, group: g, item: v, color: color, x: x + barW / 2, y: y });
        layers.push(bar);
      });

      layers.push(el('text', { x: m.l + band * gi + band / 2, y: HGT - 12, class: 'viz-tick viz-tick-x', text: g.label }));
    });

    layers.push(el('line', { x1: m.l, x2: W - m.r, y1: HGT - m.b, y2: HGT - m.b, class: 'viz-axis' }));

    if (opts.refLine) {
      const y = py(opts.refLine.value);
      layers.push(el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: 'viz-ref' }));
      layers.push(el('text', { x: m.l + 4, y: y - 6, class: 'viz-ref-label', text: opts.refLine.label }));
    }

    const svgNode = el('svg', {
      viewBox: '0 0 ' + W + ' ' + HGT, width: '100%', height: 'auto',
      role: 'img', 'aria-label': opts.title
    }, layers);

    const wrap = h('div.viz-canvas', {}, svgNode);
    const tip = makeTip(wrap);

    // На столбиках цель наведения — сам столбик, прицел не нужен.
    bars.forEach(function (b) {
      b.node.addEventListener('pointerenter', function () {
        b.node.classList.add('hot');
        const box = svgNode.getBoundingClientRect();
        const k = W / box.width;
        tip.show(b.x / k, b.y / k, [{
          color: b.color, name: b.item.name,
          value: (opts.yFormat ? opts.yFormat(b.item.value) : fmtInt(b.item.value))
        }], b.group.label);
      });
      b.node.addEventListener('pointerleave', function () {
        b.node.classList.remove('hot');
        tip.hide();
      });
    });

    const rows = groups.map(g => [g.label].concat(names.map(function (n) {
      const hit = g.values.find(v => v.name === n);
      return hit ? (opts.yFormat ? opts.yFormat(hit.value) : fmtInt(hit.value)) : '—';
    })));

    return figure(
      Object.assign({}, opts, { legend: names.map((n, i) => ({ name: n, color: seriesColor(i) })) }),
      wrap,
      tableOf(['Неделя'].concat(names), rows)
    );
  }

  // ---------------------------------------------------------------- рейтинг

  /* Горизонтальные столбики одного цвета: категорий больше семи, и раскрашивать
     их в семь цветов значило бы тратить единственный свободный канал на то,
     что и так написано подписью. Длина столбика — и есть величина. */
  function rankedBars(opts) {
    const h = H();
    const items = (opts.items || []).slice().sort((a, b) => b.value - a.value);
    if (!items.length) return emptyFigure(opts);

    const W = chartWidth();
    const rowH = 26;
    const vMax = Math.max.apply(null, items.map(i => i.value));
    const total = items.reduce((s, i) => s + i.value, 0) || 1;

    // Поле справа считаем по самой длинной подписи, а не берём с потолка:
    // при фиксированном значении «1 200 ₽ · 31%» вылезала за край полотна.
    const labels = items.map(i => fmtInt(i.value) + ' ₽ · ' + Math.round(i.value / total * 100) + '%');
    const widest = labels.reduce((n, t) => Math.max(n, t.length), 0);

    const m = {
      t: 6, b: 6,
      r: Math.min(150, widest * 6.1 + 14),
      l: Math.min(150, Math.round(W * 0.32))
    };
    const HGT = m.t + m.b + items.length * rowH;
    const plotW = Math.max(40, W - m.l - m.r);

    const layers = [];
    const bars = [];

    items.forEach(function (it, i) {
      const y = m.t + i * rowH + 4;
      const barH = rowH - 12;
      const w = Math.max(2, it.value / vMax * plotW);
      const r = Math.min(4, barH / 2, w);

      layers.push(el('text', { x: m.l - 10, y: y + barH - 2, class: 'viz-rowlabel', text: it.label }));

      const d = 'M' + m.l + ' ' + y +
        ' L' + (m.l + w - r) + ' ' + y +
        ' Q' + (m.l + w) + ' ' + y + ' ' + (m.l + w) + ' ' + (y + r) +
        ' L' + (m.l + w) + ' ' + (y + barH - r) +
        ' Q' + (m.l + w) + ' ' + (y + barH) + ' ' + (m.l + w - r) + ' ' + (y + barH) +
        ' L' + m.l + ' ' + (y + barH) + ' Z';
      const bar = el('path', { d: d, fill: 'var(--s1)', class: 'viz-bar' });
      layers.push(bar);
      bars.push({ node: bar, item: it, x: m.l + w, y: y });

      // Значение у конца столбика — снаружи, поэтому обрезаться нечему.
      layers.push(el('text', {
        x: m.l + w + 8, y: y + barH - 2, class: 'viz-endlabel', text: labels[i]
      }));
    });

    const svgNode = el('svg', {
      viewBox: '0 0 ' + W + ' ' + HGT, width: '100%', height: 'auto',
      role: 'img', 'aria-label': opts.title
    }, layers);

    const wrap = h('div.viz-canvas', {}, svgNode);

    const rows = items.map(i => [i.label, fmtInt(i.value) + ' ₽', Math.round(i.value / total * 100) + '%']);
    return figure(
      Object.assign({}, opts, { legend: null }),
      wrap,
      tableOf(['Категория', 'Сумма', 'Доля'], rows)
    );
  }

  // ---------------------------------------------------------------- пусто

  function emptyFigure(opts) {
    const h = H();
    return h('figure.viz.viz-empty', {}, [
      h('div.viz-head', {}, [
        h('h3.viz-title', { text: opts.title }),
        opts.subtitle ? h('p.viz-sub', { text: opts.subtitle }) : null
      ]),
      h('p.hint', { text: opts.empty || 'Пока нет данных для графика.' })
    ]);
  }

  /* Плитка с числом — когда величина одна, столбик из одного столбика не нужен. */
  function statTile(label, value, delta) {
    const h = H();
    return h('div.viz-stat', {}, [
      h('span.viz-stat-label', { text: label }),
      h('span.viz-stat-value', { text: value }),
      delta ? h('span.viz-stat-delta' + (delta.good ? '.good' : delta.bad ? '.bad' : ''), { text: delta.text }) : null
    ]);
  }

  window.App = window.App || {};
  window.App.charts = {
    lineChart, groupedBars, rankedBars, statTile, emptyFigure,
    seriesColor, fmtInt, fmtDate, niceScale
  };
})();
