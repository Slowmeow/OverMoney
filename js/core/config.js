/* Подключение к облаку.
 *
 * Сюда вписываются два значения из вашего проекта Supabase:
 * Project Settings → API → Project URL и anon public.
 *
 * Ключ anon публичный по замыслу — он и должен лежать в коде страницы,
 * его видит любой, кто откроет приложение. Он не даёт доступа к данным
 * сам по себе: кто чьи строки может прочитать, решают правила на стороне
 * базы (schema.sql), и без входа в аккаунт этот ключ не открывает ничего.
 * Прятать его негде и незачем — а вот service_role ключ в код класть
 * нельзя никогда, он обходит все правила.
 *
 * Пока значения не заполнены, приложение работает ровно как раньше:
 * всё локально, без аккаунтов. Ничего не ломается, просто нет входа.
 */
(function () {
  'use strict';

  const CONFIG = {
    supabaseUrl: '',
    supabaseAnonKey: ''
  };

  function configured() {
    return !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
  }

  window.App = window.App || {};
  window.App.config = {
    get url() { return String(CONFIG.supabaseUrl || '').replace(/\/+$/, ''); },
    get anonKey() { return CONFIG.supabaseAnonKey; },
    configured: configured
  };
})();
