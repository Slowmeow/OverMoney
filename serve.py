#!/usr/bin/env python3
"""Локальный сервер приложения.

Отличие от `python -m http.server` одно, но принципиальное: этот сервер
запрещает браузеру кешировать файлы. Без этого правки в .js и .css не доходят
до страницы — браузер продолжает исполнять код, скачанный в прошлый раз,
и создаётся впечатление, что исправления не работают.

Офлайн при этом не ломается: в магазине страницу держит service worker,
у него свой кеш, не связанный с этим заголовком.

Запуск:  python serve.py [порт]
"""
import http.server
import socket
import sys
import os
import json
import threading
import gzip

PORT = next((int(a) for a in sys.argv[1:] if a.isdigit()), 8777)

# Общая база: телефон и компьютер работают с одним файлом, поэтому цены,
# кладовая и планы у них всегда совпадают.
DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data.json')
DATA_LOCK = threading.Lock()


def read_data():
    if not os.path.exists(DATA_FILE):
        return {'rev': 0, 'state': None}
    try:
        with open(DATA_FILE, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {'rev': 0, 'state': None}


def write_data(payload):
    """Пишем через временный файл: если процесс упадёт на середине записи,
    прежняя база останется целой, а не превратится в обрубок."""
    tmp = DATA_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False)
    os.replace(tmp, DATA_FILE)


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    # HTTP/1.1 держит соединение открытым, поэтому двадцать с лишним файлов
    # страницы едут по одному каналу, а не по двадцати с лишним. На телефоне
    # через Wi-Fi это и есть разница между «секунда» и «сразу»: каждое новое
    # соединение стоит рукопожатия, а рукопожатие — это круг до роутера.
    protocol_version = 'HTTP/1.1'

    # ---------- общая база ----------

    def _send_json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split('?')[0] == '/api/state':
            with DATA_LOCK:
                self._send_json(200, read_data())
            return
        if self._send_gzipped():
            return
        super().do_GET()

    # Код, разметка и стили — это текст, который жмётся вчетверо. По кабелю
    # разницы не видно, а по Wi-Fi на телефон едет 90 КБ вместо 384.
    GZIP_TYPES = ('.js', '.css', '.html', '.json', '.webmanifest', '.svg')

    def _send_gzipped(self):
        path = self.path.split('?')[0]
        if not path.endswith(self.GZIP_TYPES):
            return False
        if 'gzip' not in self.headers.get('Accept-Encoding', ''):
            return False

        full = self.translate_path(self.path)
        try:
            with open(full, 'rb') as fh:
                body = gzip.compress(fh.read(), 6)
        except OSError:
            return False

        self.send_response(200)
        self.send_header('Content-Type', self.guess_type(full))
        self.send_header('Content-Encoding', 'gzip')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)
        return True

    def do_PUT(self):
        # Тело читаем всегда, даже если отвечаем отказом: соединение живёт
        # дальше, и непрочитанные байты сервер принял бы за начало
        # следующего запроса.
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except (ValueError, TypeError):
            length = 0
        raw = self.rfile.read(length) if length > 0 else b''

        if self.path.split('?')[0] != '/api/state':
            self.send_error(404)
            return
        try:
            incoming = json.loads(raw.decode('utf-8'))
        except (ValueError, TypeError, UnicodeDecodeError):
            self._send_json(400, {'error': 'битый запрос'})
            return

        with DATA_LOCK:
            current = read_data()
            base = incoming.get('baseRev')
            # Кто-то успел записать раньше — не затираем молча, отдаём конфликт
            # и пусть решает человек на устройстве.
            if current['rev'] and base is not None and base != current['rev'] and not incoming.get('force'):
                self._send_json(409, current)
                return
            payload = {'rev': current['rev'] + 1, 'state': incoming.get('state')}
            write_data(payload)
            self._send_json(200, {'rev': payload['rev']})

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        # Service worker должен уметь обновляться без ограничения области.
        if self.path.rstrip('/').endswith('sw.js'):
            self.send_header('Service-Worker-Allowed', '/')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Стандартный лог засоряет окно строкой на каждый файл.
        # Показываем только то, что пошло не так.
        status = args[1] if len(args) > 1 else ''
        if str(status).startswith(('4', '5')):
            sys.stderr.write('  %s %s\n' % (status, args[0] if args else ''))


NoCacheHandler.extensions_map.update({
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
})


def local_addresses():
    """Адреса, по которым приложение откроется с телефона в той же сети."""
    found = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith('127.') and ip not in found:
                found.append(ip)
    except OSError:
        pass
    return found


class Server(http.server.ThreadingHTTPServer):
    """Каждый запрос — в своём потоке.

    С HTTP/1.1 это обязательно, а не «на будущее»: соединение теперь живёт
    между запросами, и однопоточный сервер, заснув на одном открытом канале,
    перестал бы отвечать всем остальным. Раньше однопоточность просто
    замедляла загрузку, теперь она бы её остановила.
    """
    allow_reuse_address = True
    daemon_threads = True


def open_browser(url):
    """Открыть браузер, но только когда порт уже отвечает.

    В прежнем start.bat браузер стартовал раньше питона и успевал получить
    отказ в соединении — человек видел «не удаётся получить доступ к сайту»
    и жал F5. Отсюда и бралось «долго запускается»: приложение было готово
    за четверть секунды, но показать этого было некому.
    """
    def wait():
        import time
        import webbrowser
        for _ in range(200):                       # не дольше 10 секунд
            try:
                socket.create_connection(('127.0.0.1', PORT), 0.2).close()
                webbrowser.open(url)
                return
            except OSError:
                time.sleep(0.05)
    threading.Thread(target=wait, daemon=True).start()


if __name__ == '__main__':
    with Server(('', PORT), NoCacheHandler) as httpd:
        if '--no-browser' not in sys.argv:
            open_browser('http://localhost:%d/' % PORT)

        print()
        print('  Продукты по бюджету — сервер запущен')
        print()
        print('  На этом компьютере:  http://localhost:%d/' % PORT)
        for ip in local_addresses():
            print('  С телефона по Wi-Fi: http://%s:%d/' % (ip, PORT))
        print()
        if os.path.exists(os.path.join(os.path.dirname(DATA_FILE), 'overmoney.html')):
            print('  Версия для телефона одним файлом: overmoney.html')
            print('  (собрать заново — python build.py)')
            print()
        print('  Кеширование отключено: правки в коде видны сразу после F5.')
        print('  Окно не закрывать. Остановить — Ctrl+C.')
        print()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n  Остановлено.')
