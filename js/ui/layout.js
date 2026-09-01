/* Выбор расположения экранов.
 *
 * Два разных взгляда на одни и те же данные, а не тема оформления:
 *
 *   «Вкладки»   — обзор, неделя, список, кладовая, цены, отчёты. Всё разложено
 *                 по полкам, видно цифры и как они получились.
 *   «Календарь» — месячная сетка, кружочки едоков, день открывается по нажатию.
 *                 Видно, что и когда есть и когда идти в магазин.
 *
 * Выбор хранится НА УСТРОЙСТВЕ, а не в общих данных хозяйства, и это
 * принципиально. Двое в одном хозяйстве делят бюджет, кладовую и цены —
 * но не привычки. Попади эта настройка в общее состояние, она бы
 * синхронизировалась: он переключил у себя, а перещёлкнуло и у неё,
 * посреди магазина. Расположение экранов — свойство человека и его телефона,
 * а не свойство хозяйства.
 */
(function () {
  'use strict';

  const KEY = 'spendings.layout';

  const LAYOUTS = {
    tabs: {
      id: 'tabs',
      n: 'Вкладки',
      short: 'Всё по полкам: обзор, неделя, список, цены, отчёты',
      why: 'Видно цифры и то, как они получились. Больше управления, больше экранов.',
      order: ['dashboard', 'week', 'list', 'pantry', 'prices', 'reports', 'settings', 'account'],
      home: 'dashboard',
      // Пусто — значит палитра по умолчанию, та самая, к которой привыкли.
      skin: ''
    },
    calendar: {
      id: 'calendar',
      n: 'Календарь',
      short: 'Месяц на одном экране, едоки кружочками, день открывается нажатием',
      why: 'Видно, что и когда есть и когда идти в магазин. Меньше цифр, больше картины.',
      order: ['calendar', 'list', 'pantry', 'prices', 'settings', 'account'],
      home: 'calendar',
      skin: 'forest'
    }
  };

  let current = null;

  function get() {
    if (current) return current;
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { /* без хранилища — по умолчанию */ }
    current = LAYOUTS[saved] ? saved : 'tabs';
    return current;
  }

  function set(id) {
    if (!LAYOUTS[id]) return get();
    current = id;
    try { localStorage.setItem(KEY, id); } catch (e) { /* переживёт до перезагрузки */ }
    applySkin();
    return current;
  }

  /* Палитра переключается одним признаком на корне страницы, а не подменой
     файла стилей: так обе темы лежат в одном файле, сборка в один файл для
     телефона не усложняется, и переключение происходит мгновенно —
     без вспышки нестилизованного содержимого. */
  function applySkin() {
    const skin = def().skin;
    const root = document.documentElement;
    if (skin) root.setAttribute('data-skin', skin);
    else root.removeAttribute('data-skin');
    // Цвет полосы браузера сверху тоже относится к оформлению: без этого
    // на телефоне шапка остаётся от прежней темы и выдаёт стык.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', skin === 'forest' ? '#14532d' : '#1f6f4a');
  }

  function def() { return LAYOUTS[get()]; }

  window.App = window.App || {};
  window.App.layout = {
    applySkin: applySkin,
    LAYOUTS: LAYOUTS,
    get: get,
    set: set,
    current: def,
    order: () => def().order,
    home: () => def().home
  };
})();
