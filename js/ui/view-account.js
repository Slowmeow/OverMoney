/* Экран аккаунта: вход, регистрация и общее хозяйство. */
(function () {
  'use strict';

  const U = () => window.App.ui;
  const A = () => window.App.account;
  const C = () => window.App.cloud;

  // Что показывать на экране входа: вход, регистрацию или восстановление.
  let mode = 'signin';
  let notice = '';
  let noticeTone = '';

  function say(text, tone) {
    notice = text;
    noticeTone = tone || '';
    U().refresh();
  }

  function render() {
    const u = U(), h = u.h;

    if (!C().available()) return offlineOnlyCard();
    if (!C().signedIn()) return h('div.view', {}, authCard());

    return h('div.view', {}, [
      accountCard(),
      householdCard(),
      inviteCard(),
      joinCard()
    ]);
  }

  /* Облако не настроено — рассказываем, что это значит, без упрёка. */
  function offlineOnlyCard() {
    const u = U(), h = u.h;
    return h('div.view', {}, u.card('Аккаунты не подключены', [
      h('p', { text: 'Приложение работает целиком в этом браузере: данные никуда не уходят, ' +
        'но и не появляются на других устройствах сами.' }),
      h('p.hint', { text: 'Чтобы включить аккаунты и синхронизацию, нужно один раз завести ' +
        'бесплатный проект Supabase и вписать два значения в js/core/config.js. ' +
        'Как — расписано в README, раздел «Аккаунты и синхронизация».' }),
      h('p.hint', { text: 'Пока этого нет, переносите данные файлом: «Настройки → Данные».' })
    ]));
  }

  // ---------------------------------------------------------------- вход

  function authCard() {
    const u = U(), h = u.h;

    const email = u.input({ type: 'email', placeholder: 'почта', autocomplete: 'email' });
    const pass = u.input({
      type: 'password', placeholder: 'пароль',
      autocomplete: mode === 'signup' ? 'new-password' : 'current-password'
    });

    function run(action) {
      const e = email.value.trim(), p = pass.value;
      if (!e) return say('Впишите почту', 'bad');
      if (mode !== 'reset' && p.length < 6) return say('Пароль — минимум 6 знаков', 'bad');
      say('Секунду…');
      action(e, p).then(function (res) {
        if (res && res.needsConfirmation) {
          say('Проверьте почту: там письмо со ссылкой для подтверждения. ' +
            'После неё возвращайтесь и входите.', '');
          mode = 'signin';
          U().refresh();
          return;
        }
        notice = '';
        u.toast(mode === 'signup' ? 'Аккаунт создан' : 'С возвращением');
        u.go('dashboard');
      }).catch(err => say(err.message, 'bad'));
    }

    const actions = {
      signin: {
        title: 'Вход',
        button: 'Войти',
        go: () => run(A().signIn),
        links: [
          ['Ещё нет аккаунта — зарегистрироваться', () => { mode = 'signup'; notice = ''; U().refresh(); }],
          ['Забыл пароль', () => { mode = 'reset'; notice = ''; U().refresh(); }]
        ]
      },
      signup: {
        title: 'Регистрация',
        button: 'Создать аккаунт',
        go: () => run(A().signUp),
        links: [['Уже есть аккаунт — войти', () => { mode = 'signin'; notice = ''; U().refresh(); }]]
      },
      reset: {
        title: 'Восстановление пароля',
        button: 'Прислать письмо',
        go: function () {
          const e = email.value.trim();
          if (!e) return say('Впишите почту', 'bad');
          say('Отправляю…');
          C().resetPassword(e)
            .then(() => say('Письмо отправлено, если такой аккаунт есть. Проверьте почту.', ''))
            .catch(err => say(err.message, 'bad'));
        },
        links: [['Вспомнил — войти', () => { mode = 'signin'; notice = ''; U().refresh(); }]]
      }
    }[mode];

    // Enter в любом поле делает то же, что кнопка: иначе на телефоне
    // приходится закрывать клавиатуру, чтобы дотянуться до кнопки.
    [email, pass].forEach(function (el) {
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') actions.go(); });
    });

    return u.card(actions.title, [
      h('p.hint', { text: 'Аккаунт нужен, чтобы данные жили не в одном браузере, ' +
        'а переходили между телефоном и компьютером — и не пропали, если браузер почистится.' }),
      u.field('Почта', email),
      mode !== 'reset' ? u.field('Пароль', pass, mode === 'signup' ? 'Минимум 6 знаков' : null) : null,
      notice ? h('p.notice' + (noticeTone === 'bad' ? '.bad' : ''), { text: notice }) : null,
      h('div.row-actions', {}, [
        u.button(actions.button, actions.go, 'primary'),
        ...actions.links.map(([label, fn]) => u.button(label, fn, 'ghost small'))
      ]),
      h('hr.sep'),
      h('p.hint', { text: 'Можно и без аккаунта — тогда данные останутся только в этом браузере, ' +
        'а при чистке истории пропадут. Завести аккаунт можно позже: всё, что успеете ' +
        'наработать, перенесётся.' }),
      u.button('Посмотреть без аккаунта', function () {
        A().setGuest(true);
        u.go('dashboard');
        u.toast('Работаем без аккаунта — данные только в этом браузере');
      }, 'ghost')
    ]);
  }

  // ---------------------------------------------------------------- вошли

  function accountCard() {
    const u = U(), h = u.h;
    const st = A().status();

    const line = st.conflict ? 'данные разошлись с облаком'
      : st.error ? st.error
      : st.pending ? 'сохраняю…'
      : 'всё сохранено';

    return u.card('Аккаунт', [
      h('table.kv', {}, h('tbody', {}, [
        h('tr', {}, [h('td', { text: 'Почта' }), h('td.num', { text: st.email })]),
        h('tr', {}, [h('td', { text: 'Состояние' }), h('td.num', { text: line })])
      ])),
      h('div.row-actions', {}, [
        u.button('Сохранить сейчас', function () {
          A().flushNow().then(() => u.toast('Отправлено')).then(() => u.refresh());
        }),
        u.button('Обновить с сервера', function () {
          A().pull({ adoptRemote: true }).then(function () {
            u.refresh();
            u.toast('Данные получены');
          });
        }),
        u.button('Сменить пароль', changePassword, 'ghost'),
        u.button('Выйти', function () {
          u.modal('Выйти из аккаунта?', [
            h('p', { text: 'Данные этого хозяйства сотрутся с этого устройства — чтобы их ' +
              'не увидел следующий, кто откроет приложение здесь.' }),
            h('p.hint', { text: 'В облаке они останутся и вернутся при следующем входе.' })
          ], [
            { label: 'Отмена' },
            { label: 'Выйти', cls: 'primary', onClick: function () {
              A().signOut().then(function () {
                u.refresh();
                u.toast('Вы вышли');
              });
            } }
          ]);
        }, 'ghost')
      ])
    ]);
  }

  function changePassword() {
    const u = U(), h = u.h;
    const pass = u.input({ type: 'password', placeholder: 'новый пароль', autocomplete: 'new-password' });
    u.modal('Смена пароля', [
      u.field('Новый пароль', pass, 'Минимум 6 знаков')
    ], [
      { label: 'Отмена' },
      { label: 'Сменить', cls: 'primary', onClick: function () {
        if (pass.value.length < 6) { u.toast('Пароль — минимум 6 знаков', 'bad'); return true; }
        C().changePassword(pass.value)
          .then(() => u.toast('Пароль изменён'))
          .catch(err => u.toast(err.message, 'bad'));
      } }
    ]);
  }

  // ---------------------------------------------------------------- хозяйство

  function householdCard() {
    const u = U(), h = u.h;
    const hh = A().household;
    if (!hh) return u.card('Хозяйство', [h('p.hint', { text: 'Загружаю…' })]);

    const list = h('ul.plain', {}, h('li', { text: 'Загружаю участников…' }));
    A().people().then(function (rows) {
      list.innerHTML = '';
      rows.forEach(function (p) {
        list.appendChild(h('li', { text: p.email + (p.user_id === (C().user() || {}).id ? '  — это вы' : '') }));
      });
      if (!rows.length) list.appendChild(h('li', { text: 'Пока только вы' }));
    }).catch(function () {
      list.innerHTML = '';
      list.appendChild(h('li', { text: 'Не удалось получить список' }));
    });

    return u.card('Общее хозяйство', [
      h('p.hint', { text: 'Бюджет, кладовая, цены и меню принадлежат хозяйству, а не человеку. ' +
        'Пока вы в нём один — это просто ваши данные. Появится второй — станут общими, ' +
        'потому что кастрюля на кухне тоже одна.' }),
      u.field('Название', u.input({
        value: hh.name,
        onchange: function (e) {
          A().rename(e.target.value.trim() || 'Моё хозяйство')
            .then(() => u.toast('Переименовано'))
            .catch(err => u.toast(err.message, 'bad'));
        }
      })),
      h('h3', { text: 'Кто в хозяйстве' }),
      list,
      A().household ? h('div.row-actions', {}, u.button('Выйти из хозяйства', function () {
        u.modal('Выйти из общего хозяйства?', [
          h('p', { text: 'Вы перестанете видеть общие данные. Вам заведётся своё хозяйство, ' +
            'и в нём останется копия того, что сейчас на экране.' }),
          h('p.hint', { text: 'Остальные участники ничего не потеряют.' })
        ], [
          { label: 'Отмена' },
          { label: 'Выйти', cls: 'primary', onClick: function () {
            A().leave().then(function () {
              u.refresh();
              u.toast('Вы вышли из общего хозяйства');
            }).catch(err => u.toast(err.message, 'bad'));
          } }
        ]);
      }, 'ghost small')) : null
    ]);
  }

  function inviteCard() {
    const u = U(), h = u.h;
    const hh = A().household;
    if (!hh) return null;

    return u.card('Позвать в хозяйство', [
      h('p', { text: 'Продиктуйте этот код тому, кого зовёте. Он вводит его у себя ' +
        'в «Аккаунте», и с этого момента бюджет, кладовая и цены у вас общие.' }),
      h('div.invite-code', { text: hh.invite_code }),
      h('p.hint', { text: 'В коде нет похожих друг на друга знаков — ноля и буквы «O», ' +
        'единицы и «I»: его диктуют голосом, и путать их не придётся.' }),
      h('div.row-actions', {}, [
        u.button('Скопировать', function () {
          const ok = () => u.toast('Код скопирован');
          if (navigator.clipboard) navigator.clipboard.writeText(hh.invite_code).then(ok).catch(() => {});
          else ok();
        }),
        u.button('Сменить код', function () {
          A().rotateInvite().then(function () {
            u.refresh();
            u.toast('Код сменён — старый больше не работает');
          }).catch(err => u.toast(err.message, 'bad'));
        }, 'ghost small')
      ])
    ]);
  }

  function joinCard() {
    const u = U(), h = u.h;
    const code = u.input({ placeholder: 'например, K7M4XPQR', maxlength: 12 });

    return u.card('Присоединиться к чужому хозяйству', [
      h('p', { text: 'Если вас позвали — введите код. Ваши данные не пропадут: ' +
        'бюджеты сложатся, кладовая и журнал цен объединятся, ваши профили ' +
        'добавятся к тем, что уже есть.' }),
      u.field('Код приглашения', code),
      h('div.row-actions', {}, u.button('Присоединиться', function () {
        const value = code.value.trim();
        if (!value) return u.toast('Введите код', 'bad');

        u.busy('Проверяю код…', function () {
          A().previewJoin(value).then(function (preview) {
            confirmJoin(value, preview);
          }).catch(err => u.toast(err.message, 'bad'));
        });
      }, 'primary'))
    ]);
  }

  /* Слияние необратимо, поэтому человек видит заранее, что именно изменится. */
  function confirmJoin(code, preview) {
    const u = U(), h = u.h;
    const changes = preview.changes || [];

    u.modal('Объединить хозяйства?', [
      h('p', { text: 'Вы присоединяетесь к хозяйству «' + (preview.household.name || 'без названия') + '».' }),
      changes.length
        ? h('div', {}, [
            h('p.hint', { text: 'Что изменится:' }),
            h('ul.plain', {}, changes.map(c => h('li', { text: c })))
          ])
        : h('p.hint', { text: 'В том хозяйстве пока нет данных — туда перенесётся всё ваше.' }),
      h('p.hint', { text: 'Разъединиться можно в любой момент, но разделить обратно то, ' +
        'что слилось, приложение не умеет: цены и кладовая останутся общими у обоих.' })
    ], [
      { label: 'Отмена', onClick: function () {
        // Вступление уже произошло — иначе состав чужого хозяйства не узнать.
        // Передумал, значит выходим обратно.
        A().leave().then(() => u.refresh());
      } },
      { label: 'Объединить', cls: 'primary', onClick: function () {
        u.busy('Объединяю…', function () {
          A().joinByCode(code).then(function () {
            u.refresh();
            u.toast('Хозяйства объединены — соберите неделю заново');
          }).catch(err => u.toast(err.message, 'bad'));
        });
      } }
    ]);
  }

  window.App = window.App || {};
  window.App.views = window.App.views || {};
  window.App.views.account = { title: 'Аккаунт', render: render };
})();
