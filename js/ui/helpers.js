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
    const plan = store.get().plan;
    if (!plan) return [];

    const limit = plan.budget ? plan.budget.food : store.weeklyBudget().food;
    const out = [];

    if (plan.cost > limit) {
      out.push(button('Подстроить жёстко под бюджет', function () {
        const updated = window.App.planner.hardFit(plan);
        window.App.ui.refresh();
        showHardFitResult(updated);
      }, 'primary'));
    }

    if (plan.beforeHardFit) {
      const normal = Math.round(plan.beforeHardFit.cost);
      out.push(button('Вернуть план по норме БЖУ', function () {
        window.App.planner.undoHardFit(plan);
        window.App.ui.refresh();
        toast('Вернулись к плану по полной норме — ' + money(normal));
      }));
    }

    return out;
  }

  // Оставлено для совместимости со старым вызовом.
  function hardFitButton() { return budgetActions(); }

  function showHardFitResult(plan) {
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
      text: 'Итог по неделе: калории ' + r.kcalShare + '% нормы, белок ' + r.proteinShare + '%.'
    }));

    if (!r.fitted) {
      lines.push(h('p.hint', { text: 'Ниже приложение не опускается сознательно: белок уже на границе ' +
        '0,8 г на кг веса, а это рекомендуемый минимум, а не место для экономии.' }));
    }

    modal(r.fitted ? 'Подстроено под бюджет' : 'Бюджета не хватает', lines, [
      {
        label: 'Вернуть норму БЖУ', onClick: function () {
          window.App.planner.undoHardFit(plan);
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
    hardFitButton, budgetActions, showHardFitResult
  });
})();
