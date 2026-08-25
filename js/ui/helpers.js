/* Мелкие помощники интерфейса: сборка DOM, форматирование, всплывающие сообщения. */
(function () {
  'use strict';

  /* h('div.card', {...}, [дети]) — компактная сборка элементов без шаблонизатора. */
  function h(tagSpec, attrs, children) {
    const parts = tagSpec.split('.');
    const el = document.createElement(parts[0] || 'div');
    if (parts.length > 1) el.className = parts.slice(1).join(' ');

    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        const value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') el.className += (el.className ? ' ' : '') + value;
        else if (key === 'text') el.textContent = value;
        else if (key === 'html') el.innerHTML = value;
        else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
        else if (key.slice(0, 2) === 'on' && typeof value === 'function') el.addEventListener(key.slice(2), value);
        else if (key === 'value') el.value = value;
        else if (key === 'checked') el.checked = !!value;
        else el.setAttribute(key, value);
      });
    }

    append(el, children);
    return el;
  }

  function append(el, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) { children.forEach(c => append(el, c)); return; }
    if (children instanceof Node) { el.appendChild(children); return; }
    el.appendChild(document.createTextNode(String(children)));
  }

  function money(value) {
    const rounded = Math.round(value || 0);
    return rounded.toLocaleString('ru-RU') + ' ₽';
  }

  function num(value, digits) {
    const factor = Math.pow(10, digits || 0);
    return (Math.round((value || 0) * factor) / factor).toLocaleString('ru-RU');
  }

  function signedPct(value) {
    return (value > 0 ? '+' : '') + value + '%';
  }

  function card(title, children, extraClass) {
    return h('section.card' + (extraClass ? '.' + extraClass : ''), {}, [
      title ? h('h2.card-title', { text: title }) : null,
      h('div.card-body', {}, children)
    ]);
  }

  function field(label, control, hint) {
    return h('label.field', {}, [
      h('span.field-label', { text: label }),
      control,
      hint ? h('span.field-hint', { text: hint }) : null
    ]);
  }

  function input(attrs) {
    return h('input.input', Object.assign({ type: 'text' }, attrs));
  }

  function numberInput(value, onChange, attrs) {
    const el = h('input.input', Object.assign({
      type: 'number', value: value,
      onchange: function () { onChange(parseFloat(el.value) || 0); }
    }, attrs || {}));
    return el;
  }

  function select(options, value, onChange) {
    const el = h('select.input', {
      onchange: function () { onChange(el.value); }
    }, options.map(o => h('option', { value: o.value, selected: String(o.value) === String(value), text: o.label })));
    return el;
  }

  function button(label, onClick, cls) {
    return h('button.btn' + (cls ? '.' + cls : ''), { type: 'button', onclick: onClick, text: label });
  }

  /* Полоса «сколько от нормы набрано» — быстрее читается, чем голые цифры. */
  function bar(actual, target, label) {
    const ratio = target > 0 ? actual / target : 0;
    const width = Math.min(140, ratio * 100);
    let tone = 'ok';
    if (ratio < 0.9) tone = 'low';
    if (ratio > 1.1) tone = 'high';
    return h('div.bar-row', {}, [
      h('span.bar-label', { text: label }),
      h('div.bar-track', {}, h('div.bar-fill.' + tone, { style: { width: Math.min(100, width) + '%' } })),
      h('span.bar-value', { text: Math.round(actual) + ' / ' + Math.round(target) })
    ]);
  }

  let toastTimer = null;
  function toast(message, tone) {
    let el = document.getElementById('toast');
    if (!el) {
      el = h('div.toast', { id: 'toast' });
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = 'toast show' + (tone ? ' ' + tone : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
  }

  function modal(title, contentNode, actions) {
    const overlay = h('div.modal-overlay', {
      onclick: function (e) { if (e.target === overlay) close(); }
    });
    function close() { overlay.remove(); }

    overlay.appendChild(h('div.modal', {}, [
      h('div.modal-head', {}, [
        h('h3', { text: title }),
        button('✕', close, 'ghost')
      ]),
      h('div.modal-body', {}, contentNode),
      h('div.modal-foot', {}, (actions || []).map(a => button(a.label, function () {
        const keep = a.onClick && a.onClick();
        if (!keep) close();
      }, a.cls)))
    ]));

    document.body.appendChild(overlay);
    return { close: close, el: overlay };
  }

  /* Кнопки работы с бюджетом: подстроить жёстко и вернуться к норме.
     Компромисс обратим — после жёсткой подгонки рядом всегда стоит выход обратно. */
  function budgetActions() {
    const store = window.App.store;
    const plan = store.plan();
    if (!plan) return [];

    const limit = plan.budget ? plan.budget.food : store.weeklyBudget().food;
    const out = [];

    if (plan.cost > limit) {
      out.push(button('Подстроить жёстко под бюджет', function () {
        // План берём заново: за время между отрисовкой и нажатием его могла
        // заменить синхронизация, и прежняя ссылка вела бы в никуда.
        const live = store.plan();
        if (!live) return;
        window.App.planner.hardFit(live);
        window.App.ui.refresh();
        showHardFitResult();
      }, 'primary'));
    }

    if (plan.beforeHardFit) {
      out.push(button('Вернуть план по норме БЖУ', function () {
        const live = store.plan();
        if (!live || !live.beforeHardFit) {
          toast('Плана по норме нет — соберите неделю заново', 'bad');
          return;
        }
        const normal = Math.round(live.beforeHardFit.cost);
        window.App.planner.undoHardFit(live);
        window.App.ui.refresh();
        toast('Вернулись к плану по полной норме — ' + money(normal));
      }));
    }

    return out;
  }

  // Оставлено для совместимости со старым вызовом.
  function hardFitButton() { return budgetActions(); }

  /* Разбор перерасхода.
   *
   * Красная цифра «не хватает 149 ₽» говорит, что всё плохо, но не говорит,
   * что делать. Здесь видно, на чём именно ушли деньги, и что можно поставить
   * вместо. Предложения не навязываются: любое можно заменить на другое
   * из того же ряда или убрать навсегда, если оно не подходит. */
  function overspendCard(actualSpend) {
    const store = window.App.store;
    const plan = store.plan();
    if (!plan) return null;

    const advice = window.App.planner.overspendAdvice(plan, actualSpend);
    if (advice.over <= 0) return null;

    const rows = advice.ideas.map(function (idea) {
      // Выбранная замена хранится в самой строке: человек может перебрать
      // варианты, прежде чем применить.
      let chosen = idea.options[0];

      const costLabel = h('span.over-saves', { text: '−' + money(chosen.saves) });

      const picker = idea.options.length > 1
        ? select(idea.options.map(o => ({ value: o.id, label: o.name + ' (−' + money(o.saves) + ')' })),
            chosen.id,
            function (v) {
              chosen = idea.options.find(o => o.id === v) || chosen;
              costLabel.textContent = '−' + money(chosen.saves);
            })
        : h('span.over-to', { text: chosen.name });

      return h('div.over-row', {}, [
        h('div.over-main', {}, [
          h('span.over-from', { text: idea.name }),
          h('span.over-spend', { text: 'в плане на ' + money(idea.spend) })
        ]),
        h('span.over-arrow', { text: '→' }),
        h('div.over-pick', {}, picker),
        costLabel,
        h('div.over-actions', {}, [
          button('Заменить', function () {
            const live = store.plan();
            if (!live) return;
            const saved = window.App.planner.applyProductSwap(live, idea.id, chosen.id);
            window.App.ui.refresh();
            toast(saved > 0
              ? 'Заменено, неделя дешевле на ' + money(saved)
              : 'Замена не удешевила — вернул как было', saved > 0 ? null : 'bad');
          }, 'small primary'),
          button('Не предлагать', function () {
            store.dismissSwap(idea.id, chosen.id);
            window.App.ui.refresh();
            toast('Больше не предложу');
          }, 'ghost small')
        ])
      ]);
    });

    const dismissed = Object.keys(store.get().dismissedSwaps || {}).length;

    return card('Перерасход ' + money(advice.over), [
      h('p', { text: 'Потрачено ' + money(advice.spent) + ' при бюджете ' + money(advice.limit) + '.' }),
      rows.length
        ? h('div.over-list', {}, rows)
        : h('p.hint', { text: 'Заменить нечего: дешёвых аналогов той же роли в каталоге не осталось. ' +
            'Остаётся жёсткая подгонка или пересмотр бюджета.' }),
      rows.length
        ? h('p.hint', { text: 'Экономия оценена по цене грамма белка или килокалории. ' +
            'Итог может отличаться: продукты продаются целыми упаковками.' })
        : null,
      dismissed
        ? h('div.row-actions', {}, button('Вернуть отклонённые предложения (' + dismissed + ')', function () {
            store.restoreSwaps();
            window.App.ui.refresh();
          }, 'ghost small'))
        : null
    ], 'over-card');
  }

  function showHardFitResult() {
    const plan = window.App.store.plan();
    if (!plan) return;
    const r = plan.hardFit || {};
    const lines = [];

    if (r.fitted) {
      lines.push(h('p', { text: 'Уложились: ' + money(r.cost) + ' при бюджете ' + money(r.limit) + '.' }));
    } else {
      lines.push(h('p', { text: 'Уложиться не удалось даже с ослабленными требованиями: ' +
        money(r.cost) + ' против ' + money(r.limit) + '.' }));
    }

    if (r.compromises && r.compromises.length) {
      lines.push(h('p.hint', { text: 'Чем пришлось пожертвовать:' }));
      lines.push(h('ul.plain', {}, r.compromises.map(c => h('li', { text: c }))));
    } else if (r.fitted) {
      lines.push(h('p.hint', { text: 'Ничем жертвовать не пришлось — хватило пересборки меню.' }));
    }

    lines.push(h('p.hint', {
      text: 'Итог по неделе: калории ' + r.kcalShare + '% нормы, белок ' +
        r.proteinPerKg + ' г на кг веса при вашей цели ' + r.targetPerKg +
        ' и безопасном минимуме ' + r.safePerKg + '.'
    }));

    if (!r.fitted) {
      lines.push(h('p.hint', { text: 'Ниже приложение не опускается сознательно: белок уже на границе ' +
        '0,8 г на кг веса, а это рекомендуемый минимум, а не место для экономии.' }));
    }

    modal(r.fitted ? 'Подстроено под бюджет' : 'Бюджета не хватает', lines, [
      {
        label: 'Вернуть норму БЖУ', onClick: function () {
          const live = window.App.store.plan();
          if (!live || !live.beforeHardFit) return;
          window.App.planner.undoHardFit(live);
          window.App.ui.refresh();
          toast('Вернулись к плану по полной норме');
        }
      },
      { label: 'Оставить так', cls: 'primary' }
    ]);
  }

  window.App = window.App || {};
  window.App.ui = Object.assign(window.App.ui || {}, {
    h, money, num, signedPct, card, field, input, numberInput, select, button, bar, toast, modal,
    hardFitButton, budgetActions, overspendCard, showHardFitResult
  });
})();
