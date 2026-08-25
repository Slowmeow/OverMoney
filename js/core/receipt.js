/* Разбор кассового чека.
 *
 * Что здесь честно возможно, а что нет.
 *
 * QR-код на российском чеке содержит только дату, сумму и фискальные признаки:
 * t (дата и время), s (сумма), fn, i, fp (номера накопителя, документа
 * и признак). Списка товаров в нём нет — его отдаёт лишь сервис ФНС,
 * которому нужны интернет и авторизация. Приложение работает без сети
 * и без аккаунтов, поэтому позиции оттуда взяться не могут ни при каком
 * старании, и обещать этого нельзя.
 *
 * Зато из QR берётся то, что важнее всего для учёта: точная дата и сумма
 * по кассе. А позиции у нас уже есть — в списке покупок, — и сверить их
 * с чеком быстрее, чем набивать заново.
 */
(function () {
  'use strict';

  /* Разбор строки из QR. Возвращает null, если это не фискальный код. */
  function parseQr(text) {
    if (!text) return null;
    const raw = String(text).trim();
    const params = {};
    raw.split('&').forEach(function (pair) {
      const eq = pair.indexOf('=');
      if (eq === -1) return;
      params[pair.slice(0, eq).trim().toLowerCase()] = pair.slice(eq + 1).trim();
    });

    if (!params.s && !params.t) return null;

    return {
      date: parseDate(params.t),
      time: parseTime(params.t),
      sum: params.s ? Math.round(parseFloat(params.s.replace(',', '.')) * 100) / 100 : null,
      fn: params.fn || '',
      doc: params.i || '',
      sign: params.fp || '',
      raw: raw
    };
  }

  /* Дата в QR записана как 20260824T1830 — без разделителей. */
  function parseDate(t) {
    if (!t || t.length < 8) return null;
    const y = t.slice(0, 4), m = t.slice(4, 6), d = t.slice(6, 8);
    if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) return null;
    return y + '-' + m + '-' + d;
  }

  function parseTime(t) {
    if (!t || t.length < 13) return '';
    const hh = t.slice(9, 11), mm = t.slice(11, 13);
    return /^\d{2}$/.test(hh) && /^\d{2}$/.test(mm) ? hh + ':' + mm : '';
  }

  /* Умеет ли браузер читать QR сам. Поддержка неровная: на телефонах с Chrome
     обычно есть, на части десктопов нет. Поэтому всегда остаётся ручной ввод. */
  function canScan() {
    return typeof window.BarcodeDetector === 'function';
  }

  function detector() {
    return new window.BarcodeDetector({ formats: ['qr_code'] });
  }

  /* Прочитать QR с фотографии чека. */
  function scanImage(file) {
    if (!canScan()) return Promise.reject(new Error('Браузер не умеет читать QR-коды'));
    return createImageBitmap(file)
      .then(bitmap => detector().detect(bitmap))
      .then(function (codes) {
        if (!codes || !codes.length) throw new Error('QR-код на фотографии не найден');
        return codes[0].rawValue;
      });
  }

  /* Прочитать QR с камеры. Возвращает объект с промисом результата
     и способом остановить камеру — её нельзя оставлять включённой. */
  function scanCamera(videoEl) {
    if (!canScan()) return Promise.reject(new Error('Браузер не умеет читать QR-коды'));
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('Нет доступа к камере'));
    }

    let stream = null;
    let stopped = false;

    const result = navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(function (s) {
        stream = s;
        videoEl.srcObject = s;
        return videoEl.play();
      })
      .then(function () {
        const det = detector();
        return new Promise(function (resolve, reject) {
          const timer = setInterval(function () {
            if (stopped) { clearInterval(timer); return; }
            det.detect(videoEl).then(function (codes) {
              if (codes && codes.length) {
                clearInterval(timer);
                resolve(codes[0].rawValue);
              }
            }).catch(function () { /* кадр не распознался — пробуем следующий */ });
          }, 400);

          // Держать камеру включённой бесконечно нельзя.
          setTimeout(function () {
            clearInterval(timer);
            if (!stopped) reject(new Error('QR-код не найден за 30 секунд'));
          }, 30000);
        });
      });

    return {
      result: result,
      stop: function () {
        stopped = true;
        if (stream) stream.getTracks().forEach(t => t.stop());
      }
    };
  }

  window.App = window.App || {};
  window.App.receipt = { parseQr, canScan, scanImage, scanCamera };
})();
