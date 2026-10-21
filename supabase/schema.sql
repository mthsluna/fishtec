-- FISHTEC: progresso de cada conta (dinheiro, peixes, roupas compradas, aparência)
-- Cole tudo no Supabase em SQL Editor > New query e clique em Run.
-- As contas (e-mail e senha) ficam no Auth do próprio Supabase; aqui fica só o progresso do jogo.

create table if not exists public.game_saves (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  money      bigint      not null default 0 check (money >= 0),         -- em centavos de F$
  inv        jsonb       not null default '{}'::jsonb,                  -- { "salmao": 3, ... }
  owned      jsonb       not null default '[]'::jsonb,                  -- ids dos itens comprados
  look       jsonb       not null default '{}'::jsonb,                  -- apelido, cores, roupa vestida
  updated_at timestamptz not null default now(),
  -- limites de tamanho: impedem alguém de usar a tabela como depósito de lixo
  constraint inv_size   check (octet_length(inv::text)   < 8192),
  constraint owned_size check (octet_length(owned::text) < 8192),
  constraint look_size  check (octet_length(look::text)  < 4096)
);

-- atualiza updated_at sozinho a cada alteração
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists game_saves_updated_at on public.game_saves;
create trigger game_saves_updated_at
  before update on public.game_saves
  for each row execute function public.set_updated_at();

-- Segurança: cada pessoa só enxerga e altera o PRÓPRIO save.
alter table public.game_saves enable row level security;

drop policy if exists "ler o proprio save" on public.game_saves;
create policy "ler o proprio save"
  on public.game_saves for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "criar o proprio save" on public.game_saves;
create policy "criar o proprio save"
  on public.game_saves for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "atualizar o proprio save" on public.game_saves;
create policy "atualizar o proprio save"
  on public.game_saves for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- (sem policy de delete: o save some sozinho se a conta for apagada, por causa do "on delete cascade")
