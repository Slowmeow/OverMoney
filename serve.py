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
import socketserver
import socket
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8777


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
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


if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('', PORT), NoCacheHandler) as httpd:
        print()
        print('  Продукты по бюджету — сервер запущен')
        print()
        print('  На этом компьютере:  http://localhost:%d/' % PORT)
        for ip in local_addresses():
            print('  С телефона по Wi-Fi: http://%s:%d/' % (ip, PORT))
        print()
        print('  Кеширование отключено: правки в коде видны сразу после F5.')
        print('  Окно не закрывать. Остановить — Ctrl+C.')
        print()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n  Остановлено.')
