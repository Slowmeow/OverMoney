/* Список покупок: что взять, сколько это стоит и что уже есть дома. */
(function () {
  'use strict';

  const U = () => window.App.ui;
  const S = () => window.App.store;
  const SH = () => window.App.shopping;

  /* Сводка по всему месяцу.
   *
   * Появляется, только когда собрана не одна неделя: на одной она повторяла бы
   * недельный список слово в слово и лишь занимала место.
   *
   * Вес — то, ради чего это и нужно помимо суммы: «20 500 ₽» ничего не говорит
   * о том, донесёшь ли ты это, а «102 кг за месяц» сразу объясняет, почему
   * за один раз не выйдет. Считается по купленному весу, а не съедобному:
   * кожуру от картошки тоже несут в руках. Миллилитры в вес не идут —
   * складывать литры с килограммами приложение не станет. */
  function monthCard() {
    const u = U(), h = u.h;
    const weeks = S().allWeeks();
    const starts = Object.keys(weeks).sort();
    if (starts.length < 2) return null;

    const plans = starts.map(function (start) {
      return { start: start, plan: weeks[start], label: weekLabel(start) };
    });
    const sum = SH().monthSummary(plans);

    return u.card('Все закупки: ' + starts.length + ' нед.', [
      h('div.big-figure.under', {}, [
        h('span.big-num', { text: u.money(sum.cost) }),
        h('span.big-cap', { text: 'и ' + sum.weightKg + ' кг нести из магазина' })
      ]),
      h('p.hint', { text: 'Это сумма отдельных закупок, а не одного похода: упаковки покупаются ' +
        'в каждый заход заново, и складывать их в один список значило бы занизить сумму ' +
        'на переплате за целые пачки.' }),
      h('table.kv', {}, h('tbody', {}, sum.weeks.map(function (w) {
        return h('tr', {}, [
          h('td', { text: w.label }),
          h('td.num', { text: u.money(w.list.total) })
        ]);
      }))),
      h('h3', { text: 'Что покупается чаще всего' }),
      h('ul.plain', {}, sum.items.slice(0, 10).map(function (i) {
        return h('li', { text: i.product.n + ' — ' + SH().formatAmount(i.product, i.amount) +
          ' на ' + u.money(i.cost) });
      }))
    ]);
  }

  /* Название списка человеческое: «неделя с 8 сентября», а не голая дата. */
  function weekLabel(start) {
    const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    const d = new Date(start + 'T12:00:00');
    return 'Неделя с ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  function render() {
    const u = U(), h = u.h;
    const state = S().get();
    const plan = state.plan;

    if (!plan) {
      return h('div.view', {}, u.card('Списка нет', [
        h('p', { text: 'Список появится, как только будет собрана неделя.' }),
        u.button('Собрать неделю', () => window.App.ui.generate(), 'primary')
      ]));
    }

    const list = SH().buildList(plan);
    const budget = S().weeklyBudget();

    return h('div.view', {}, [
      monthCard(),
      summary(list, budget, plan),
      u.overspendCard(list.total),
      h('div.list-groups', {}, list.byCategory.map(group => groupCard(group))),
      pantryCovered(list),
      regularsCard(),
      finishCard(plan, list)
    ]);
  }

  function summary(list, budget, plan) {
    const u = U(), h = u.h;
    const diff = budget.food - list.total;
    return u.card('Итого ' + u.money(list.total), [
      h('div.summary-grid', {}, [
        stat('Бюджет на продукты', u.money(budget.food)),
        stat(diff >= 0 ? 'Остаётся' : 'Не хватает', u.money(Math.abs(diff)), diff >= 0 ? 'good' : 'bad'),
        stat('Сэкономлено кладовой', u.money(list.savedByPantry), 'good'),
        stat('Позиций купить', String(list.byCategory.reduce((s, g) => s + g.items.length, 0)))
      ]),
      h('p.hint', { text: 'Цены с пометкой ~ ещё не проверялись вами. Поправьте их прямо в списке ' +
        'после закупки — приложение запомнит и следующая неделя посчитается точнее.' }),
      h('div.row-actions', {}, [
        u.budgetActions(),
        u.button('Печать / PDF', () => window.print()),
        u.button('Скопировать текстом', copyAsText)
      ])
    ]);
  }

  function stat(label, value, tone) {
    const u = U(), h = u.h;
    return h('div.stat' + (tone ? '.' + tone : ''), {}, [
      h('span.stat-value', { text: value }),
      h('span.stat-label', { text: label })
    ]);
  }

  function groupCard(group) {
    const u = U(), h = u.h;
    const state = S().get();

    return h('section.card.list-group', {}, [
      h('h2.card-title', {}, [
        h('span', { text: group.name }),
        h('span.group-sum', { text: u.money(group.sum) })
      ]),
      h('div.card-body', {}, group.items.map(function (item) {
        const id = item.product.id;
        const checked = !!state.listState[id];

        const priceBox = u.numberInput(item.product.pr, function (value) {
          if (value <= 0) return;
          S().setPrice(id, value);
          u.toast('Цена обновлена: ' + item.product.n);
          window.App.ui.refresh();
        }, { step: '1', min: '0', class: 'input price-input' });

        return h('div.item' + (checked ? '.done' : ''), {}, [
          h('input.check', {
            type: 'checkbox', checked: checked,
            onchange: function (e) {
              if (e.target.checked) state.listState[id] = true;
              else delete state.listState[id];
              S().save();
              window.App.ui.refresh();
            }
          }),
          h('div.item-main', {}, [
            h('span.item-name', { text: item.product.n }),
            h('span.item-meta', {
              text: SH().formatPurchase(item) +
                (item.fromPantry > 0 ? ' · дома уже есть ' + SH().formatMass(item.product, item.fromPantry) : '') +
                (item.leftover > 20 ? ' · останется ' + SH().formatMass(item.product, item.leftover) : '')
            })
          ]),
          h('div.item-price', {}, [
            h('span.item-cost', { text: (item.stale ? '~' : '') + u.money(item.cost) }),
            h('label.price-edit', {}, [
              h('span', { text: 'цена за ' + item.product.pl }),
              priceBox
            ])
          ])
        ]);
      }))
    ]);
  }

  function pantryCovered(list) {
    const u = U(), h = u.h;
    const covered = list.items.filter(i => i.fromPantry > 0);
    if (!covered.length) return null;

    return u.card('Берём из кладовой, покупать не нужно', [
      h('ul.plain', {}, covered.map(i => h('li', {
        text: i.product.n + ' — ' + SH().formatMass(i.product, i.fromPantry) +
          (i.remaining > 0.5 ? ' (не хватает ' + SH().formatMass(i.product, i.remaining) + ', это в списке выше)' : '')
      }))),
      h('p.hint', { text: 'Итого не потрачено: ' + u.money(list.savedByPantry) + '.' })
    ], 'muted');
  }

  function regularsCard() {
    const u = U(), h = u.h;
    const reg = S().regularsWeeklyCost();
    if (!reg.items.length) return null;

    return u.card('Регулярное и бытовое', [
      h('p.hint', { text: 'Это не привязано к меню — берите по мере окончания. ' +
        'В бюджете уже зарезервировано ' + u.money(reg.total) + ' в неделю.' }),
      h('ul.plain', {}, reg.items.map(i => h('li', {
        text: i.product.n + ' — ' + i.product.pl + ', ' + u.money(i.product.pr) +
          ' (≈' + u.money(i.cost) + ' в неделю)'
      })))
    ], 'muted');
  }

  function finishCard(plan, list) {
    const u = U(), h = u.h;
    const R = window.App.receipt;

    return u.card('После закупки', [
      h('p', { text: 'Нажмите, когда вернётесь из магазина: остатки от начатых упаковок ' +
        'перейдут в кладовую, и следующая неделя будет дешевле на их стоимость.' }),
      h('div.row-actions', {}, [
        u.button('Закупка завершена', () => finish(plan, list), 'primary'),
        u.button('Внести чек', () => receiptDialog(plan, list))
      ]),
      h('p.hint', { text: R && R.canScan()
        ? 'Чек можно отсканировать: из QR-кода приложение возьмёт дату и сумму по кассе.'
        : 'Этот браузер не умеет читать QR-коды — сумму и дату с чека можно вписать вручную.' })
    ]);
  }

  /* Внесение чека.
   *
   * Из QR берутся только дата и сумма: списка товаров в коде нет, его отдаёт
   * лишь сервис ФНС, которому нужны интернет и авторизация. Обещать разбор
   * позиций было бы враньём. Зато позиции у нас уже есть — в этом самом
   * списке покупок, — поэтому сверка сводится к галочкам и правке цен,
   * а расхождение с суммой чека видно сразу. */
  function receiptDialog(plan, list) {
    const u = U(), h = u.h;
    const R = window.App.receipt;
    const state = S().get();

    let parsed = null;
    let camera = null;

    const dateInput = h('input.input', { type: 'date', value: S().today() });
    const sumInput = h('input.input', { type: 'number', min: '0', step: '1', value: list.total });
    const qrInput = h('input.input', { type: 'search', placeholder: 't=20260824T1830&s=3155.00&fn=…' });
    const status = h('p.hint', { text: 'Дата и сумма заполнены расчётными значениями — поправьте по чеку.' });
    const video = h('video.receipt-video', { playsinline: 'true', muted: 'true' });

    function applyParsed(text) {
      parsed = R.parseQr(text);
      if (!parsed) {
        status.textContent = 'Это не похоже на фискальный QR-код. Впишите дату и сумму вручную.';
        return;
      }
      if (parsed.date) dateInput.value = parsed.date;
      if (parsed.sum) sumInput.value = parsed.sum;
      status.textContent = 'Чек распознан: ' + (parsed.date || '') + ' ' + (parsed.time || '') +
        ', сумма ' + u.money(parsed.sum || 0) + '. Позиции сверьте ниже — в QR их нет.';
    }

    const fileInput = h('input', {
      type: 'file', accept: 'image/*', style: { display: 'none' },
      onchange: function (e) {
        const file = e.target.files[0];
        if (!file) return;
        status.textContent = 'Читаю фотографию…';
        R.scanImage(file).then(applyParsed).catch(err => { status.textContent = err.message; });
      }
    });

    // Позиции берём из своего же списка: отмечено — значит куплено.
    const lines = [];
    list.byCategory.forEach(function (group) {
      group.items.forEach(function (item) {
        const id = item.product.id;
        const row = { id: id, item: item, bought: state.listState[id] !== false };
        const priceBox = h('input.input.rg-input', {
          type: 'number', min: '0', step: '1', value: item.product.pr,
          onchange: function (e) {
            const value = parseFloat(e.target.value);
            if (value > 0) S().setPrice(id, value);
          }
        });
        const check = h('input.check', {
          type: 'checkbox', checked: row.bought,
          onchange: function (e) { row.bought = e.target.checked; }
        });
        row.priceBox = priceBox;
        lines.push(row);
        row.node = h('div.receipt-row', {}, [
          check,
          h('span.receipt-name', { text: item.product.n }),
          h('span.receipt-qty', { text: SH().formatPurchase(item) }),
          priceBox
        ]);
      });
    });

    const body = [
      h('div.row-actions', {}, [
        R.canScan() ? u.button('Сканировать камерой', function () {
          status.textContent = 'Наведите камеру на QR-код чека…';
          video.style.display = 'block';
          camera = R.scanCamera(video);
          camera.result.then(function (text) {
            camera.stop();
            video.style.display = 'none';
            applyParsed(text);
          }).catch(function (err) {
            camera.stop();
            video.style.display = 'none';
            status.textContent = err.message;
          });
        }) : null,
        R.canScan() ? u.button('Загрузить фото чека', () => fileInput.click()) : null
      ]),
      video,
      fileInput,
      u.field('Строка из QR-кода', qrInput, 'если сканировали чек другим приложением — вставьте сюда'),
      u.button('Разобрать строку', () => applyParsed(qrInput.value), 'small'),
      status,
      h('div.form-grid', {}, [
        u.field('Дата чека', dateInput),
        u.field('Сумма по чеку, ₽', sumInput)
      ]),
      h('h4.sub-head', { text: 'Что из списка куплено' }),
      h('p.hint', { text: 'Снимите галочку с того, что не брали, и поправьте цены. ' +
        'Списка товаров в QR-коде нет — его отдаёт только сервис ФНС, а он требует интернета и входа.' }),
      h('div.receipt-list', {}, lines.map(l => l.node))
    ];

    const dlg = u.modal('Внести чек', body, [
      { label: 'Отмена', onClick: function () { if (camera) camera.stop(); } },
      {
        label: 'Записать', cls: 'primary', onClick: function () {
          if (camera) camera.stop();
          const actual = parseFloat(sumInput.value) || list.total;
          const date = dateInput.value || S().today();

          // Не купленное остаётся в списке: план на него по-прежнему рассчитан.
          lines.forEach(function (l) {
            if (l.bought) state.listState[l.id] = true;
            else delete state.listState[l.id];
          });

          const fresh = SH().buildList(plan);
          const byCat = {};
          fresh.byCategory.forEach(g => { byCat[g.cat] = g.sum; });

          state.pantry = SH().pantryAfter(plan, fresh);
          state.history.push({
            date: date,
            planned: fresh.total,
            actual: actual,
            budget: S().weeklyBudget().food,
            kcal: plan.nutrition ? plan.nutrition.week.kcal : null,
            protein: plan.nutrition ? plan.nutrition.week.p : null,
            byCat: byCat,
            receipt: parsed ? { fn: parsed.fn, doc: parsed.doc, sign: parsed.sign } : null
          });
          state.listState = {};
          S().save();

          const diff = Math.round(actual - fresh.total);
          u.toast(Math.abs(diff) < 20
            ? 'Чек записан, сходится с расчётом'
            : 'Чек записан: ' + (diff > 0 ? 'на ' + u.money(diff) + ' больше' : 'на ' + u.money(-diff) + ' меньше') + ' расчёта');
          window.App.ui.go('reports');
        }
      }
    ]);

    return dlg;
  }

  function finish(plan, list) {
    const u = U(), h = u.h;
    const computed = list.total;
    const inputEl = u.numberInput(computed, () => {}, { step: '1', min: '0' });

    u.modal('Сколько получилось по чеку?', [
      h('p.hint', { text: 'Расчётная сумма — ' + u.money(computed) + '. ' +
        'Если в чеке другая цифра, впишите её: она попадёт в историю и покажет, ' +
        'насколько план расходится с реальностью.' }),
      u.field('Фактическая сумма, ₽', inputEl)
    ], [
      { label: 'Отмена' },
      {
        label: 'Записать', cls: 'primary', onClick: function () {
          const state = S().get();
          const actual = parseFloat(inputEl.value) || computed;

          state.pantry = SH().pantryAfter(plan, list);

          // Сохраняем не только сумму: без калорий, белка и разбивки по отделам
          // потом невозможно построить ни структуру трат, ни стоимость калории.
          const byCat = {};
          list.byCategory.forEach(g => { byCat[g.cat] = g.sum; });

          state.history.push({
            date: S().today(),
            planned: computed,
            actual: actual,
            budget: S().weeklyBudget().food,
            kcal: plan.nutrition ? plan.nutrition.week.kcal : null,
            protein: plan.nutrition ? plan.nutrition.week.p : null,
            byCat: byCat
          });
          state.listState = {};
          S().save();
          u.toast('Записано. Остатки перенесены в кладовую.');
          window.App.ui.go('pantry');
        }
      }
    ]);
  }

  function copyAsText() {
    const u = U();
    const plan = S().get().plan;
    const list = SH().buildList(plan);
    const lines = [];
    list.byCategory.forEach(function (g) {
      lines.push('— ' + g.name + ' —');
      g.items.forEach(i => lines.push('  ' + i.product.n + ': ' + SH().formatPurchase(i) + ' — ' + Math.round(i.cost) + ' ₽'));
    });
    lines.push('');
    lines.push('Итого: ' + list.total + ' ₽');

    const text = lines.join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => u.toast('Список скопирован'));
    } else {
      u.modal('Список покупок', window.App.ui.h('pre.pre', { text: text }), [{ label: 'Закрыть' }]);
    }
  }

  window.App = window.App || {};
  window.App.views = window.App.views || {};
  window.App.views.list = { title: 'Список', render: render };
})();
