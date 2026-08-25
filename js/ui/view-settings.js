/* Настройки: бюджет, профили едоков, режим питания, регулярные траты, данные. */
(function () {
  'use strict';

  const U = () => window.App.ui;
  const S = () => window.App.store;
  const N = () => window.App.nutrition;

  function render() {
    const u = U(), h = u.h;
    return h('div.view', {}, [
      budgetCard(),
      peopleCard(),
      modeCard(),
      regularsCard(),
      historyCard(),
      dataCard()
    ]);
  }

  function set(path, value) {
    const s = S().get();
    s.settings[path] = value;
    S().save();
  }

  function budgetCard() {
    const u = U(), h = u.h;
    const s = S().get().settings;
    const b = S().weeklyBudget();

    return u.card('Бюджет', [
      h('div.form-grid', {}, [
        u.field('Сумма, ₽', u.numberInput(s.budget, v => { set('budget', v); window.App.ui.refresh(); }, { min: '0', step: '100' })),
        u.field('Период', u.select([
          { value: 'month', label: 'на месяц' },
          { value: 'week', label: 'на неделю' }
        ], s.period, v => { set('period', v); window.App.ui.refresh(); })),
        u.field('Еда вне дома за период, ₽', u.numberInput(s.outsideFood, v => { set('outsideFood', v); window.App.ui.refresh(); }, { min: '0', step: '100' }),
          'кофе, обеды на работе, доставка'),
        u.field('Допустимое превышение', u.select([
          { value: '0', label: 'нельзя, жёсткий потолок' },
          { value: '0.05', label: 'до 5%' },
          { value: '0.1', label: 'до 10%' }
        ], String(s.overspend), v => { set('overspend', parseFloat(v)); window.App.ui.refresh(); }))
      ]),
      h('p.hint', {
        text: 'На продукты остаётся ' + u.money(b.food) + ' в неделю ' +
          '(' + u.money(b.gross) + ' минус ' + u.money(b.outside) + ' вне дома и ' +
          u.money(b.regulars) + ' на регулярное).'
      })
    ]);
  }

  function peopleCard() {
    const u = U(), h = u.h;
    const state = S().get();
    const total = N().householdTargets(state.people);

    return u.card('Кто ест', [
      h('div.people', {}, state.people.map(personBlock)),
      h('div.row-actions', {}, [
        u.button('Добавить человека', function () {
          state.people.push(S().defaultPerson('p' + Date.now().toString(36), 'Профиль ' + (state.people.length + 1), 'm'));
          S().save();
          window.App.ui.refresh();
        })
      ]),
      h('p.hint', {
        text: 'Суммарная норма на всех: ' + total.kcal + ' ккал, Б ' + total.p + ' · Ж ' + total.f + ' · У ' + total.c + ' в день. ' +
          'Именно под неё собирается меню.'
      })
    ]);
  }

  function personBlock(person) {
    const u = U(), h = u.h;
    const state = S().get();
    const t = N().personTargets(person);

    function upd(key, value) {
      person[key] = value;
      person.needsSetup = false;
      S().save();
      window.App.ui.refresh();
    }

    const manual = !!(person.manual && person.manual.kcal > 0);

    return h('div.person' + (person.needsSetup ? '.needs-setup' : ''), {}, [
      h('div.person-head', {}, [
        h('input.input.person-name', {
          value: person.name,
          onchange: e => upd('name', e.target.value)
        }),
        state.people.length > 1 ? u.button('Удалить', function () {
          state.people = state.people.filter(p => p.id !== person.id);
          S().save();
          window.App.ui.refresh();
        }, 'ghost small') : null
      ]),
      h('div.form-grid.compact', {}, [
        u.field('Пол', u.select([{ value: 'm', label: 'мужской' }, { value: 'f', label: 'женский' }], person.sex, v => upd('sex', v))),
        u.field('Возраст', u.numberInput(person.age, v => upd('age', v), { min: '10', max: '100' })),
        u.field('Рост, см', u.numberInput(person.height, v => upd('height', v), { min: '120', max: '230' })),
        u.field('Вес, кг', u.numberInput(person.weight, v => upd('weight', v), { min: '30', max: '250' })),
        u.field('Активность', u.select(
          Object.keys(N().ACTIVITY).map(k => ({ value: k, label: N().ACTIVITY[k] })),
          person.activity, v => upd('activity', parseFloat(v)))),
        u.field('Цель', u.select(
          Object.keys(N().GOALS).map(k => ({ value: k, label: N().GOALS[k].n })),
          person.goal, v => upd('goal', v)))
      ]),
      h('div.person-meals', {}, [
        h('span.field-label', { text: 'Ест' }),
        h('div.checkgroup', {}, Object.keys(window.App.MEALS).map(function (key) {
          const on = (person.meals || []).indexOf(key) !== -1;
          return h('label.checkline', {}, [
            h('input', {
              type: 'checkbox', checked: on,
              onchange: function (e) {
                const list = (person.meals || []).slice();
                if (e.target.checked) list.push(key);
                person.meals = e.target.checked ? list : list.filter(m => m !== key);
                // Совсем без приёмов пищи человек остаться не может —
                // иначе его норма просто исчезнет из расчёта.
                if (!person.meals.length) person.meals = [key];
                S().save();
                window.App.ui.refresh();
              }
            }),
            h('span', { text: window.App.MEALS[key].n })
          ]);
        }))
      ]),
      dietsBlock(person),
      h('label.checkline', {}, [
        h('input', {
          type: 'checkbox', checked: manual,
          onchange: function (e) {
            person.manual = e.target.checked ? { kcal: t.kcal, p: t.p, f: t.f, c: t.c } : null;
            S().save();
            window.App.ui.refresh();
          }
        }),
        h('span', { text: 'задать КБЖУ вручную вместо расчёта' })
      ]),
      manual ? h('div.form-grid.compact', {}, [
        u.field('Ккал', u.numberInput(person.manual.kcal, v => { person.manual.kcal = v; S().save(); window.App.ui.refresh(); })),
        u.field('Белки, г', u.numberInput(person.manual.p, v => { person.manual.p = v; S().save(); window.App.ui.refresh(); })),
        u.field('Жиры, г', u.numberInput(person.manual.f, v => { person.manual.f = v; S().save(); window.App.ui.refresh(); })),
        u.field('Углеводы, г', u.numberInput(person.manual.c, v => { person.manual.c = v; S().save(); window.App.ui.refresh(); }))
      ]) : h('div.person-result', {}, [
        h('span', { text: 'Норма: ' + t.kcal + ' ккал · Б ' + t.p + ' · Ж ' + t.f + ' · У ' + t.c }),
        h('span.person-formula', {
          text: 'Белок ' + t.protPerKg + ' г/кг, жиры ' + t.fatPerKg + ' г/кг — ставка зависит от активности и цели. ' +
            'Прибавьте нагрузку, и норма белка вырастет.' +
            (t.protCapped ? ' Белок ограничен третью рациона — выше он не даёт пользы.' : '')
        })
      ])
    ]);
  }

  /* Диетические режимы человека.
   *
   * Сознательно отделены от «не предлагать этот продукт»: там личный вкус,
   * здесь — ограничение по здоровью, у которого есть причина и последствия.
   * Поэтому у каждого режима видно, что именно он убирает и почему. */
  function dietsBlock(person) {
    const u = U(), h = u.h;
    const chosen = person.diets || [];

    return h('div.diets', {}, [
      h('span.field-label', { text: 'Ограничения по здоровью и диеты' }),
      h('div.diet-grid', {}, window.App.DIETS.map(function (d) {
        const on = chosen.indexOf(d.id) !== -1;
        return h('label.diet-chip' + (on ? '.on' : ''), {}, [
          h('input', {
            type: 'checkbox', checked: on,
            onchange: function (e) {
              const list = (person.diets || []).slice();
              person.diets = e.target.checked
                ? list.concat([d.id])
                : list.filter(x => x !== d.id);
              S().save();
              window.App.ui.refresh();
            }
          }),
          h('span.diet-main', {}, [
            h('span.diet-name', { text: d.n }),
            h('span.diet-short', { text: d.short })
          ]),
          u.button('?', function () { explainDiet(d); }, 'ghost small')
        ]);
      })),
      chosen.length ? h('p.field-hint', {
        text: 'Готовим одно блюдо на всех, поэтому ограничения этого профиля действуют ' +
          'на общее меню — иначе пришлось бы готовить дважды.'
      }) : null
    ]);
  }

  function explainDiet(d) {
    const u = U(), h = u.h;
    u.modal(d.n, [
      h('p', { text: d.why }),
      h('p.hint', { text: d.note }),
      h('div.note', {}, [
        h('p', { text: 'Это фильтр продуктов, а не лечение.' }),
        h('p', { text: 'Приложение убирает из меню то, что при этом состоянии обычно ограничивают, ' +
          'и не более того. Оно не ставит диагноз, не знает форму и стадию вашего заболевания ' +
          'и не заменяет врача. Если врач разрешил или запретил что-то иначе — поправьте список ' +
          'вручную на вкладке «Цены» галочкой «не предлагать».' })
      ])
    ], [{ label: 'Понятно', cls: 'primary' }]);
  }

  function modeCard() {
    const u = U(), h = u.h;
    const s = S().get().settings;
    const meals = window.App.MEALS;

    const targets = window.App.planner.slotTargets(S().get().people);

    return u.card('Режим питания', [
      h('p.hint', { text: 'Приёмы пищи задаются отдельно для каждого человека в блоке «Кто ест». ' +
        'Блюдо готовится одно, а порция считается по тем, кто в этом приёме участвует.' }),
      h('div.slot-summary', {}, Object.keys(meals).filter(k => targets[k]).map(function (key) {
        const t = targets[key];
        // Общая сумма на двоих не говорит, кому сколько класть, — поэтому
        // разворачиваем норму по людям.
        const byPerson = (t.byPerson || []).map(x => x.name + ' ' + x.kcal + ' ккал');
        return h('div.slot-chip', {}, [
          h('span.slot-chip-name', { text: meals[key].n }),
          h('span.slot-chip-meta', { text: byPerson.join(' · ') || (t.kcal + ' ккал') }),
          t.byPerson && t.byPerson.length > 1
            ? h('span.slot-chip-total', { text: 'вместе ' + t.kcal + ' ккал' })
            : null
        ]);
      })),
      h('div.form-grid', {}, [
        u.field('Одно блюдо за неделю не чаще', u.select([
          { value: '1', label: '1 раза — максимум разнообразия' },
          { value: '2', label: '2 раз' },
          { value: '3', label: '3 раз' },
          { value: '4', label: '4 раз' },
          { value: '5', label: '5 раз' },
          { value: '7', label: '7 раз — хоть каждый день' }
        ], String(s.maxRepeat), v => { set('maxRepeat', parseInt(v, 10)); window.App.ui.refresh(); }),
          s.maxRepeat >= 4 ? 'при 4 и выше разрешены повторы два дня подряд' : 'подряд одно блюдо не повторяется'),
        u.field('Супы и рагу на два дня', u.select([
          { value: 'yes', label: 'да, так дешевле' },
          { value: 'no', label: 'нет, готовлю каждый день заново' }
        ], s.batchTwoDays ? 'yes' : 'no', v => { set('batchTwoDays', v === 'yes'); window.App.ui.refresh(); })),
        u.field('Белок не ниже', u.select([
          { value: '0.8', label: '80% нормы' },
          { value: '0.9', label: '90% нормы' },
          { value: '1', label: '100% нормы' }
        ], String(s.proteinFloor), v => { set('proteinFloor', parseFloat(v)); window.App.ui.refresh(); }),
          'граница, ниже которой экономия запрещена'),
        u.field('Неделя начинается с', u.h('input.input', {
          type: 'date', value: s.startDay,
          onchange: e => { set('startDay', e.target.value); window.App.ui.refresh(); }
        }))
      ])
    ]);
  }

  function regularsCard() {
    const u = U(), h = u.h;
    const state = S().get();
    const byId = S().productsById();
    const products = S().products().sort((a, b) => a.n.localeCompare(b.n, 'ru'));

    return u.card('Регулярные покупки', [
      h('p.hint', { text: 'Бытовая химия, кофе, специи — всё, что покупается по циклу, а не по меню. ' +
        'Стоимость раскладывается по неделям и вычитается из бюджета до того, как подбирается еда.' }),
      h('div.regulars', {}, (state.regulars || []).map(function (r, idx) {
        const prod = byId[r.p];
        return h('div.regular-row', {}, [
          u.select(products.map(p => ({ value: p.id, label: p.n })), r.p, function (v) {
            r.p = v; S().save(); window.App.ui.refresh();
          }),
          u.numberInput(r.qty, function (v) { r.qty = v; S().save(); window.App.ui.refresh(); }, { min: '0', step: '0.5', class: 'input small-input' }),
          u.select(Object.keys(S().PERIODS).map(k => ({ value: k, label: S().PERIODS[k].n })), r.per, function (v) {
            r.per = v; S().save(); window.App.ui.refresh();
          }),
          h('span.regular-cost', {
            text: prod ? u.money(prod.pr * r.qty / S().periodWeeks(r.per)) + ' / нед' : ''
          }),
          u.button('✕', function () {
            state.regulars.splice(idx, 1);
            S().save();
            window.App.ui.refresh();
          }, 'ghost small')
        ]);
      })),
      u.button('Добавить строку', function () {
        state.regulars.push({ p: products[0].id, qty: 1, per: 'month' });
        S().save();
        window.App.ui.refresh();
      })
    ]);
  }

  function historyCard() {
    const u = U(), h = u.h;
    const history = S().get().history || [];
    if (!history.length) {
      return u.card('История закупок', [
        h('p.hint', { text: 'Пока пусто. После первой отметки «Закупка завершена» здесь появится сравнение плана с чеком.' })
      ], 'muted');
    }

    return u.card('История закупок', [
      h('table.table', {}, [
        h('thead', {}, h('tr', {}, [
          h('th', { text: 'Дата' }), h('th.num', { text: 'План' }),
          h('th.num', { text: 'Факт' }), h('th.num', { text: 'Бюджет' }), h('th.num', { text: 'Отклонение' })
        ])),
        h('tbody', {}, history.slice().reverse().map(function (r) {
          const dev = r.planned > 0 ? Math.round((r.actual - r.planned) / r.planned * 100) : 0;
          return h('tr', {}, [
            h('td', { text: r.date }),
            h('td.num', { text: u.money(r.planned) }),
            h('td.num', { text: u.money(r.actual) }),
            h('td.num', { text: u.money(r.budget) }),
            h('td.num' + (Math.abs(dev) > 10 ? '.bad' : ''), { text: u.signedPct(dev) })
          ]);
        }))
      ])
    ]);
  }

  function dataCard() {
    const u = U(), h = u.h;

    const fileInput = h('input', {
      type: 'file', accept: '.json', style: { display: 'none' },
      onchange: function (e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function () {
          try {
            S().importJson(reader.result);
            u.toast('Данные загружены');
            window.App.ui.refresh();
          } catch (err) {
            u.toast('Не получилось: ' + err.message, 'bad');
          }
        };
        reader.readAsText(file);
      }
    });

    const sync = window.App.sync ? window.App.sync.status() : { available: false };

    return u.card('Данные', [
      h('p', { text: sync.available
        ? 'Сейчас телефон и компьютер работают с общей базой: она лежит файлом data.json ' +
          'рядом с приложением на компьютере, и правки с любого устройства видны везде.'
        : 'Сейчас данные живут только в этом браузере: общая база недоступна — ' +
          'скорее всего, не запущен start.bat. Правки с телефона сюда не попадут.' }),

      h('p.hint', { text: 'Всё остаётся у вас: ни на какие серверы в интернете данные не уходят. ' +
        'Браузер может очистить своё хранилище сам — например, при чистке истории, — поэтому ' +
        'раз в месяц имеет смысл выгружать копию в файл.' }),

      h('ul.plain', {}, [
        h('li', { text: 'Выгрузить в файл — скачивает всё: бюджет, профили, цены с историей, ' +
          'кладовую, планы и закупки. Это ваша резервная копия, её можно положить куда угодно.' }),
        h('li', { text: 'Загрузить из файла — заменяет текущие данные содержимым копии. ' +
          'Пригодится при переезде на другой компьютер или если что-то пошло не так.' }),
        h('li', { text: 'Сбросить всё — стирает данные и возвращает приложение к первому запуску. ' +
          'Отменить это нельзя, поэтому сначала выгрузите копию.' })
      ]),

      h('div.row-actions', {}, [
        u.button('Выгрузить в файл', function () {
          const blob = new Blob([S().exportJson()], { type: 'application/json' });
          const link = h('a', { href: URL.createObjectURL(blob), download: 'spendings-' + S().today() + '.json' });
          document.body.appendChild(link);
          link.click();
          link.remove();
        }),
        u.button('Загрузить из файла', () => fileInput.click()),
        u.button('Сбросить всё', function () {
          if (!confirm('Удалить все данные: бюджет, профили, цены, кладовую и планы?')) return;
          S().reset();
          u.toast('Сброшено');
          window.App.ui.go('dashboard');
        }, 'danger')
      ]),
      fileInput
    ]);
  }

  window.App = window.App || {};
  window.App.views = window.App.views || {};
  window.App.views.settings = { title: 'Настройки', render: render };
})();
