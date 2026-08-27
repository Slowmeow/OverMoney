-- Устройство базы для аккаунтов и синхронизации.
--
-- Выполняется один раз, целиком, в разделе SQL Editor вашего проекта Supabase.
-- Запускать повторно безопасно: всё создаётся с проверкой на существование.
--
-- ГЛАВНОЕ РЕШЕНИЕ, из которого следует всё остальное: данными владеет не
-- человек, а домохозяйство. Один человек — домохозяйство из одного. Двое
-- объединились — домохозяйство из двоих, и бюджет, кладовая и журнал цен
-- у них общие, потому что кастрюля на кухне тоже одна.
--
-- Если бы данные принадлежали человеку, объединение пришлось бы изображать
-- постоянным копированием туда-обратно, и любое расхождение решалось бы
-- гаданием, чья версия новее. А так у общих данных всегда ровно один хозяин
-- и ровно один номер версии.

-- ---------------------------------------------------------------- таблицы

create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Моё хозяйство',
  -- Короткий код для приглашения. По нему второй человек присоединяется,
  -- не зная ни идентификаторов, ни почты первого.
  invite_code text not null unique,
  -- Всё состояние приложения одним куском: настройки, профили, цены,
  -- кладовая, планы. Приложение и так хранит его целиком — разбирать
  -- на таблицы значило бы держать одну и ту же схему в двух местах
  -- и ловить расхождения между ними.
  state       jsonb,
  -- Номер версии. Растёт сам, триггером ниже. По нему ловятся расхождения,
  -- когда два устройства правят данные одновременно.
  rev         bigint not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists household_members_user_idx
  on public.household_members (user_id);

-- ---------------------------------------------------------------- версия

-- Номер версии обязан расти на сервере, а не приходить от устройства.
-- Устройство может ошибиться, отстать или соврать; сервер — единственное
-- место, где порядок записей виден целиком.
create or replace function public.bump_rev()
returns trigger
language plpgsql
as $$
begin
  new.rev := old.rev + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists households_bump_rev on public.households;
create trigger households_bump_rev
  before update on public.households
  for each row execute function public.bump_rev();

-- ---------------------------------------------------------------- доступ

-- Проверка членства. SECURITY DEFINER здесь обязателен: правила доступа
-- к households должны читать household_members, а правила доступа
-- к household_members — знать про households. Без обхода они бы ссылались
-- друг на друга по кругу и запрос уходил бы в бесконечную рекурсию.
create or replace function public.is_member(hid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;

-- Видеть и править своё хозяйство может только его участник.
-- Отдельного правила на удаление нет намеренно: строки хозяйств
-- не удаляются, последний уходящий просто перестаёт быть участником.
drop policy if exists households_read on public.households;
create policy households_read on public.households
  for select using (public.is_member(id));

drop policy if exists households_write on public.households;
create policy households_write on public.households
  for update using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists members_read on public.household_members;
create policy members_read on public.household_members
  for select using (public.is_member(household_id));

-- Вступление и выход идут через функции ниже, поэтому прямой вставки
-- и удаления записей об участии нет: иначе можно было бы вписать себя
-- в чужое хозяйство, зная только его идентификатор.
drop policy if exists members_leave on public.household_members;
create policy members_leave on public.household_members
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------- действия

-- Код приглашения. Без похожих друг на друга знаков: его диктуют голосом
-- и переписывают с чужого экрана, а «0» и «O», «1» и «I» в этот момент
-- неразличимы.
create or replace function public.make_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  code text;
  i integer;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.households where invite_code = code);
  end loop;
  return code;
end;
$$;

-- Завести хозяйство и сразу стать его участником.
--
-- Одной операцией, а не двумя: между «создать» и «вписать себя» правила
-- доступа не пускают никого, включая создателя, — хозяйство без участников
-- невидимо вообще всем. Разорвись это надвое, при сбое посередине осталась
-- бы строка, до которой нельзя дотянуться ни одним запросом.
create or replace function public.create_household(household_name text default null, initial_state jsonb default null)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.households;
begin
  if auth.uid() is null then
    raise exception 'нужен вход';
  end if;

  insert into public.households (name, invite_code, state)
  values (coalesce(nullif(trim(household_name), ''), 'Моё хозяйство'),
          public.make_invite_code(), initial_state)
  returning * into row;

  insert into public.household_members (household_id, user_id)
  values (row.id, auth.uid());

  return row;
end;
$$;

-- Присоединиться по коду приглашения.
--
-- Тоже SECURITY DEFINER, и по существу: чтобы найти хозяйство по коду,
-- надо его прочитать, а читать чужое хозяйство правила запрещают —
-- на то они и правила. Здесь мы разрешаем ровно один шаг: найти по коду
-- и вписать себя. Ни прочитать чужие данные, ни узнать что-либо
-- о хозяйстве, кода которого у тебя нет, это не позволяет.
create or replace function public.join_household(code text)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.households;
begin
  if auth.uid() is null then
    raise exception 'нужен вход';
  end if;

  select * into row from public.households
  where invite_code = upper(trim(code));

  if row.id is null then
    raise exception 'код не найден';
  end if;

  insert into public.household_members (household_id, user_id)
  values (row.id, auth.uid())
  on conflict do nothing;

  return row;
end;
$$;

-- Сменить код приглашения. Нужно, когда код разошёлся дальше, чем хотелось:
-- старый перестаёт работать сразу.
create or replace function public.rotate_invite_code(hid uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  fresh text;
begin
  if not public.is_member(hid) then
    raise exception 'не ваше хозяйство';
  end if;
  fresh := public.make_invite_code();
  update public.households set invite_code = fresh where id = hid;
  return fresh;
end;
$$;

-- Кто ещё в хозяйстве. Отдаём почту участников — по ней человек понимает,
-- с кем у него общий бюджет. Больше ничего из auth.users наружу не идёт.
create or replace function public.household_people(hid uuid)
returns table (user_id uuid, email text, joined_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select m.user_id, u.email::text, m.joined_at
  from public.household_members m
  join auth.users u on u.id = m.user_id
  where m.household_id = hid and public.is_member(hid)
  order by m.joined_at;
$$;

-- Хозяйства, в которых человек состоит. Первое по времени вступления
-- считается основным.
create or replace function public.my_households()
returns setof public.households
language sql
security definer
set search_path = public
stable
as $$
  select h.* from public.households h
  join public.household_members m on m.household_id = h.id
  where m.user_id = auth.uid()
  order by m.joined_at;
$$;

grant execute on function public.create_household(text, jsonb)  to authenticated;
grant execute on function public.join_household(text)            to authenticated;
grant execute on function public.rotate_invite_code(uuid)        to authenticated;
grant execute on function public.household_people(uuid)          to authenticated;
grant execute on function public.my_households()                 to authenticated;
grant execute on function public.is_member(uuid)                 to authenticated;
