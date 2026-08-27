#!/usr/bin/env python3
"""Сборка приложения в один файл — для телефона.

Зачем. Обычная версия — это страница и два десятка файлов рядом с ней;
чтобы открыть её на телефоне, нужен работающий компьютер с start.bat
и общая сеть Wi-Fi. В магазине, в отпуске и просто при выключенном
ноутбуке этого нет.

Здесь всё — стили, весь код, иконка и манифест — вклеивается внутрь
страницы. Получается один файл, который отправляется на телефон любым
способом и открывается с него без сервера, без интернета и без
компьютера. Данные телефон хранит у себя.

Запуск:  python build.py
Итог:    overmoney.html
"""
import base64
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'overmoney.html')

# Консоль Windows живёт в cp1251, и стрелка «→» роняет вывод целиком —
# сборка при этом уже прошла, а выглядит как падение. Пусть лучше
# незнакомый символ подменится, чем упадёт печать отчёта.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, 'reconfigure'):
        stream.reconfigure(errors='replace')


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as fh:
        return fh.read()


def data_uri(text, mime):
    raw = base64.b64encode(text.encode('utf-8')).decode('ascii')
    return 'data:%s;base64,%s' % (mime, raw)


def guard(rel, text):
    """Вклеиваемый код не должен содержать закрывающий тег скрипта.

    Иначе браузер закончит блок посреди кода, и остаток страницы станет
    текстом. Проверяем прямо, а не надеемся: молча собранный битый файл
    хуже, чем несобранный.
    """
    if '</script' in text.lower():
        sys.exit('  Сборка отменена: в %s есть "</script" — вклеить нельзя.' % rel)
    return text


def build():
    html = read('index.html')

    # ---- стили ----
    css = read('css/app.css')
    html = re.sub(
        r'<link rel="stylesheet" href="css/app\.css[^"]*">',
        lambda _: '<style>\n' + css + '\n</style>',
        html)

    # ---- код: в том же порядке, в каком его грузила страница ----
    scripts = re.findall(r'<script src="([^"?]+)[^"]*"></script>', html)
    if not scripts:
        sys.exit('  Сборка отменена: в index.html не нашлось ни одного скрипта.')

    bundle = []
    for rel in scripts:
        bundle.append('/* ===== %s ===== */\n%s' % (rel, guard(rel, read(rel))))

    # Первый тег заменяем всей склейкой, остальные убираем.
    first = True
    def swap(match):
        nonlocal first
        if first:
            first = False
            return '<script>\n' + '\n'.join(bundle) + '\n</script>'
        return ''
    html = re.sub(r'<script src="[^"]+"></script>\s*', swap, html)

    # ---- иконка и манифест ----
    # Манифест ссылается на файл иконки, которого рядом уже не будет,
    # поэтому иконка тоже переезжает внутрь — иначе на домашнем экране
    # телефона окажется пустой квадрат.
    icon = data_uri(read('icon.svg'), 'image/svg+xml')
    manifest = json.loads(read('manifest.webmanifest'))
    manifest['icons'] = [dict(i, src=icon) for i in manifest.get('icons', [])]
    # Открытому из файла приложению некуда идти по относительному адресу:
    # стартовой страницей для него является он сам.
    manifest.pop('start_url', None)
    manifest.pop('scope', None)
    html = html.replace(
        '<link rel="manifest" href="manifest.webmanifest">',
        '<link rel="manifest" href="%s">' % data_uri(json.dumps(manifest, ensure_ascii=False), 'application/manifest+json'))

    # ---- пометка сборки ----
    # Чтобы по виду страницы было понятно, какая это версия: на телефоне
    # лежит копия, и без пометки не отличить свежую от прошлогодней.
    html = html.replace('<body>', '<body data-build="single-file">')

    with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(html)

    size = os.path.getsize(OUT)
    print()
    print('  Собрано: overmoney.html — %.0f КБ, файлов внутри: %d' % (size / 1024, len(scripts) + 3))
    print()
    print('  Что дальше:')
    print('    1. Отправьте overmoney.html на телефон — Telegram, почта, кабель, облако.')
    print('    2. Откройте его на телефоне (в Telegram — «Открыть в браузере»).')
    print('    3. Меню браузера → «Добавить на главный экран».')
    print()
    print('  Дальше приложение работает с иконки, без интернета и без компьютера.')
    print('  Данные телефон хранит у себя; перенос между устройствами — через')
    print('  «Настройки → Данные → Выгрузить в файл».')
    print()


if __name__ == '__main__':
    build()
