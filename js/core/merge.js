/* Слияние двух хозяйств в одно.
 *
 * Случается ровно в один момент: человек со своими данными присоединяется
 * к чужому хозяйству. Выбросить одну из сторон нельзя — с обеих сторон
 * это месяцы правок цен и заполненная кладовая.
 *
 * Правило, из которого выведено всё остальное: складывается то, что в жизни
 * складывается, и объединяется то, что в жизни объединяется. Двое съехались —
 * едоков стало двое, бюджеты сложились, крупа с двух полок оказалась на одной.
 * А вот план на неделю не складывается никак: он был рассчитан на одного,
 * и на двоих его не растянуть. Поэтому план отбрасывается и собирается заново.
 */
(function () {
  'use strict';

  /* Бюджеты заданы за разные периоды: у одного 15 000 в месяц, у другого
     4 000 в неделю. Складывать их как числа — бессмыслица, поэтому обе
     стороны приводятся к неделе, складываются и выражаются обратно
     в периоде принимающей стороны. */
  function weeksOf(settings) {
    return settings.period === 'month' ? (settings.weeksInMonth || 4.3) : 1;
  }

  function sumPerPeriod(hostValue, hostSettings, guestValue, guestSettings) {
    const perWeek = (hostValue || 0) / weeksOf(hostSettings) +
                    (guestValue || 0) / weeksOf(guestSettings);
    return Math.round(perWeek * weeksOf(hostSettings));
  }

  /* Профили обоих становятся едоками одного хозяйства.
     Совпавшие коды переименовываются: код — это ключ, по которому за человеком
     закреплены приёмы пищи и раскладка по тарелкам, и два разных человека
     под одним кодом слились бы в одного. */
  function mergePeople(host, guest) {
    const used = {};
    host.forEach(p => { used[p.id] = true; });
    const added = guest.map(function (p) {
      const copy = Object.assign({}, p);
      if (used[copy.id]) {
        let n = 2;
        while (used[copy.id + '_' + n]) n++;
        copy.id = copy.id + '_' + n;
      }
      used[copy.id] = true;
      return copy;
    });
    return host.concat(added);
  }

  /* Кладовая складывается буквально: две пачки гречки на одной кухне —
     это две пачки гречки. */
  function mergePantry(host, guest) {
    const out = Object.assign({}, host);
    Object.keys(guest || {}).forEach(function (id) {
      out[id] = (out[id] || 0) + guest[id];
    });
    return out;
  }

  /* Журнал цен — это накопленное знание о магазинах, и оно тем ценнее,
     чем длиннее. Объединяем целиком, отбрасывая лишь буквальные повторы:
     одна и та же марка в одном магазине в один день. */
  function mergePriceLog(host, guest) {
    const seen = {};
    const out = [];
    host.concat(guest || []).forEach(function (e) {
      if (!e || !e.p) return;
      const key = [e.p, e.brand || '', e.store || '', e.d || ''].join('|');
      if (seen[key]) return;
      seen[key] = true;
      out.push(e);
    });
    return out;
  }

  function mergeFlags(host, guest) {
    return Object.assign({}, guest || {}, host || {});
  }

  function mergeById(host, guest, key) {
    const seen = {};
    const out = [];
    (host || []).concat(guest || []).forEach(function (item) {
      if (!item) return;
      const id = item[key];
      if (id !== undefined && seen[id]) return;
      if (id !== undefined) seen[id] = true;
      out.push(item);
    });
    return out;
  }

  function mergeStrings(host, guest) {
    const out = (host || []).slice();
    (guest || []).forEach(s => { if (out.indexOf(s) === -1) out.push(s); });
    return out;
  }

  /* Регулярные покупки: шампунь у обоих, но кухня одна. Берём больший
     расход — он ближе к правде для двоих, чем меньший. */
  function mergeRegulars(host, guest) {
    const byId = {};
    (host || []).forEach(r => { if (r && r.p) byId[r.p] = Object.assign({}, r); });
    (guest || []).forEach(function (r) {
      if (!r || !r.p) return;
      const have = byId[r.p];
      if (!have) { byId[r.p] = Object.assign({}, r); return; }
      const weeksHave = window.App.store.periodWeeks(have.per);
      const weeksNew = window.App.store.periodWeeks(r.per);
      if ((r.qty || 0) / weeksNew > (have.qty || 0) / weeksHave) byId[r.p] = Object.assign({}, r);
    });
    return Object.keys(byId).map(k => byId[k]);
  }

  /* host — хозяйство, к которому присоединяются; guest — тот, кто приходит
     со своими данными. Настройки берутся у принимающей стороны: это её
     сложившийся уклад, а гость к нему присоединяется. Складываются только
     деньги — они и правда становятся общими. */
  function mergeStates(host, guest) {
    if (!guest) return host;
    if (!host) return guest;

    const out = JSON.parse(JSON.stringify(host));
    const hs = out.settings, gs = guest.settings || {};

    hs.budget = sumPerPeriod(hs.budget, hs, gs.budget, gs);
    hs.outsideFood = sumPerPeriod(hs.outsideFood, hs, gs.outsideFood, gs);

    out.people = mergePeople(out.people || [], guest.people || []);
    out.pantry = mergePantry(out.pantry || {}, guest.pantry || {});
    out.priceLog = mergePriceLog(out.priceLog || [], guest.priceLog || []);
    out.excluded = mergeFlags(out.excluded, guest.excluded);
    out.disabledRecipes = mergeFlags(out.disabledRecipes, guest.disabledRecipes);
    out.dismissedSwaps = mergeFlags(out.dismissedSwaps, guest.dismissedSwaps);
    out.brandChoice = mergeFlags(out.brandChoice, guest.brandChoice);
    out.customProducts = mergeById(out.customProducts, guest.customProducts, 'id');
    out.customRecipes = mergeById(out.customRecipes, guest.customRecipes, 'id');
    out.stores = mergeStrings(out.stores, guest.stores);
    out.regulars = mergeRegulars(out.regulars, guest.regulars);
    out.history = (out.history || []).concat(guest.history || []);

    // План считался на прежний состав едоков и прежние деньги. Оставить его —
    // значит показывать меню, которое никого уже не кормит по норме.
    out.plan = null;
    out.listState = {};

    return out;
  }

  /* Что именно изменится при слиянии — показывается человеку до того,
     как он согласится. Слияние необратимо, и соглашаться вслепую он не должен. */
  function describeMerge(host, guest) {
    if (!host || !guest) return [];
    const hs = host.settings || {}, gs = guest.settings || {};
    const lines = [];

    const budget = sumPerPeriod(hs.budget, hs, gs.budget, gs);
    if (budget !== hs.budget) {
      lines.push('Бюджет станет ' + budget + ' ₽ вместо ' + (hs.budget || 0) + ' ₽ — суммы сложатся');
    }
    const people = (guest.people || []).length;
    if (people) lines.push('Едоков станет ' + ((host.people || []).length + people) +
      ': ваши профили добавятся к тем, что уже есть');

    const pantry = Object.keys(guest.pantry || {}).length;
    if (pantry) lines.push('В кладовую добавится ' + pantry + ' поз. — количества сложатся');

    const prices = (guest.priceLog || []).length;
    if (prices) lines.push('В журнал цен добавится ваших записей: ' + prices);

    const own = (guest.customProducts || []).length + (guest.customRecipes || []).length;
    if (own) lines.push('Перенесутся ваши продукты и рецепты: ' + own);

    if (host.plan || guest.plan) lines.push('План на неделю придётся собрать заново — он считался на другой состав едоков');

    return lines;
  }

  window.App = window.App || {};
  window.App.merge = { mergeStates, describeMerge, sumPerPeriod };
})();
