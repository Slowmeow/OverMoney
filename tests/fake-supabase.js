/* Поддельный Supabase: ровно те запросы, которые делает приложение.
 *
 * Нужен, чтобы облачный слой проверялся целиком — вход, обновление ключа,
 * хозяйства, слияние, расхождения, — а не только на глаз. Настоящий проект
 * для этого не годится: тест обязан идти одинаково при каждом запуске,
 * не требовать сети и не оставлять следов в чужой базе.
 *
 * Поведение повторяет supabase/schema.sql там, где это важно для приложения:
 *   - номер версии растёт на сервере, а не приходит от устройства;
 *   - запись проходит, только если номер версии совпал с ожидаемым;
 *   - читать и писать хозяйство может лишь его участник;
 *   - найти чужое хозяйство можно только по коду приглашения.
 *
 * Расхождения между этой подделкой и настоящей базой возможны, и тест их
 * не поймает — на то и написан schema.sql так, чтобы правила читались.
 * Зато всё, что приложение делает со своей стороны, проверяется полностью.
 */
const http = require('http');
const { URL } = require('url');

function makeServer() {
  const users = {};          // email -> { id, email, password }
  const sessions = {};       // access_token -> { userId, expiresAt }
  const refreshTokens = {};  // refresh_token -> userId
  const households = {};     // id -> { id, name, invite_code, state, rev }
  const members = [];        // { household_id, user_id }
  const log = [];            // что приложение спрашивало — для проверок

  let seq = 0;
  const nextId = prefix => prefix + '_' + (++seq);

  function issueSession(userId, ttlSeconds) {
    const access = nextId('access');
    const refresh = nextId('refresh');
    const expiresAt = Math.floor(Date.now() / 1000) + (ttlSeconds || 3600);
    sessions[access] = { userId: userId, expiresAt: expiresAt };
    refreshTokens[refresh] = userId;
    const u = Object.keys(users).map(k => users[k]).find(x => x.id === userId);
    return {
      access_token: access, refresh_token: refresh, expires_at: expiresAt,
      user: { id: u.id, email: u.email }
    };
  }

  function callerOf(req) {
    const auth = req.headers['authorization'] || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const s = sessions[token];
    if (!s) return null;
    if (s.expiresAt * 1000 < Date.now()) return { expired: true };
    return s.userId;
  }

  function isMember(hid, userId) {
    return members.some(m => m.household_id === hid && m.user_id === userId);
  }

  function inviteCode() {
    const abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let out = '';
    for (let i = 0; i < 8; i++) out += abc[Math.floor(Math.random() * abc.length)];
    return out;
  }

  const server = http.createServer(function (req, res) {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', function () {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      let payload = {};
      try { payload = body ? JSON.parse(body) : {}; } catch (e) { payload = {}; }

      log.push({ method: req.method, path: path, query: url.search });

      function send(code, data) {
        const text = JSON.stringify(data === undefined ? null : data);
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(text);
      }

      // Ключ проекта обязателен на каждом запросе — как у настоящего.
      if (!req.headers['apikey']) return send(401, { message: 'No API key found in request' });

      // ---------------------------------------------------------- вход

      if (path === '/auth/v1/signup') {
        const email = String(payload.email || '').toLowerCase();
        if (users[email]) return send(400, { msg: 'User already registered' });
        if (String(payload.password || '').length < 6) {
          return send(422, { msg: 'Password should be at least 6 characters' });
        }
        users[email] = { id: nextId('user'), email: email, password: payload.password };
        if (server.requireConfirmation) return send(200, { user: { id: users[email].id, email: email } });
        return send(200, issueSession(users[email].id, server.tokenTtl));
      }

      if (path === '/auth/v1/token') {
        const grant = url.searchParams.get('grant_type');
        if (grant === 'password') {
          const email = String(payload.email || '').toLowerCase();
          const u = users[email];
          if (!u || u.password !== payload.password) {
            return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
          }
          return send(200, issueSession(u.id, server.tokenTtl));
        }
        if (grant === 'refresh_token') {
          const userId = refreshTokens[payload.refresh_token];
          if (!userId) return send(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
          delete refreshTokens[payload.refresh_token];      // одноразовый, как в жизни
          server.refreshCount++;
          return send(200, issueSession(userId, server.tokenTtl));
        }
        return send(400, { msg: 'unsupported grant' });
      }

      if (path === '/auth/v1/logout') return send(204, null);
      if (path === '/auth/v1/recover') { server.recoverCount++; return send(200, {}); }

      if (path === '/auth/v1/user' && req.method === 'PUT') {
        const caller = callerOf(req);
        if (!caller || caller.expired) return send(401, { msg: 'invalid token' });
        const u = Object.keys(users).map(k => users[k]).find(x => x.id === caller);
        if (payload.password) u.password = payload.password;
        return send(200, { id: u.id, email: u.email });
      }

      // ---------------------------------------------------------- данные

      const caller = callerOf(req);
      if (!caller) return send(401, { message: 'JWT expired or missing' });
      if (caller.expired) return send(401, { message: 'JWT expired' });

      if (path === '/rest/v1/rpc/my_households') {
        return send(200, members.filter(m => m.user_id === caller).map(m => households[m.household_id]));
      }

      if (path === '/rest/v1/rpc/create_household') {
        const row = {
          id: nextId('hh'),
          name: (payload.household_name || '').trim() || 'Моё хозяйство',
          invite_code: inviteCode(),
          state: payload.initial_state || null,
          rev: 0
        };
        households[row.id] = row;
        members.push({ household_id: row.id, user_id: caller });
        return send(200, row);
      }

      if (path === '/rest/v1/rpc/join_household') {
        const code = String(payload.code || '').trim().toUpperCase();
        const row = Object.keys(households).map(k => households[k]).find(h => h.invite_code === code);
        if (!row) return send(400, { message: 'код не найден' });
        if (!isMember(row.id, caller)) members.push({ household_id: row.id, user_id: caller });
        return send(200, row);
      }

      if (path === '/rest/v1/rpc/rotate_invite_code') {
        const row = households[payload.hid];
        if (!row || !isMember(row.id, caller)) return send(400, { message: 'не ваше хозяйство' });
        row.invite_code = inviteCode();
        return send(200, row.invite_code);
      }

      if (path === '/rest/v1/rpc/household_people') {
        const hid = payload.hid;
        if (!isMember(hid, caller)) return send(200, []);
        return send(200, members.filter(m => m.household_id === hid).map(function (m) {
          const u = Object.keys(users).map(k => users[k]).find(x => x.id === m.user_id);
          return { user_id: m.user_id, email: u ? u.email : '', joined_at: '2026-01-01T00:00:00Z' };
        }));
      }

      if (path === '/rest/v1/households') {
        const idFilter = (url.searchParams.get('id') || '').replace('eq.', '');
        const row = households[idFilter];

        if (req.method === 'GET') {
          if (!row || !isMember(row.id, caller)) return send(200, []);
          return send(200, [row]);
        }

        if (req.method === 'PATCH') {
          if (!row || !isMember(row.id, caller)) return send(200, []);
          const revFilter = url.searchParams.get('rev');
          if (revFilter !== null) {
            const expected = Number(String(revFilter).replace('eq.', ''));
            // Номер версии не совпал — кто-то записался раньше. Ни одна
            // строка под условие не попадает, и сервер отдаёт пустой список.
            if (row.rev !== expected) return send(200, []);
          }
          if (payload.state !== undefined) row.state = payload.state;
          if (payload.name !== undefined) row.name = payload.name;
          row.rev += 1;                                     // растит сервер, не устройство
          return send(200, [row]);
        }
      }

      if (path === '/rest/v1/household_members' && req.method === 'DELETE') {
        const hid = (url.searchParams.get('household_id') || '').replace('eq.', '');
        const uid = (url.searchParams.get('user_id') || '').replace('eq.', '');
        if (uid !== caller) return send(403, { message: 'нельзя выписывать других' });
        for (let i = members.length - 1; i >= 0; i--) {
          if (members[i].household_id === hid && members[i].user_id === uid) members.splice(i, 1);
        }
        return send(204, null);
      }

      send(404, { message: 'нет такого пути: ' + path });
    });
  });

  server.tokenTtl = 3600;
  server.requireConfirmation = false;
  server.refreshCount = 0;
  server.recoverCount = 0;
  server.state = { users, households, members, sessions, log };
  return server;
}

module.exports = { makeServer };
