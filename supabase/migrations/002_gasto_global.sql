-- Migración 002: consumo global diario (tope de gasto) y límite de velocidad por IP.
-- Aplicar en Supabase (SQL Editor) después de schema.sql. Es idempotente.

create table if not exists public.usage (
  dia            date primary key,
  tokens_entrada bigint  not null default 0,
  tokens_salida  bigint  not null default 0,
  costo_usd      numeric not null default 0,
  peticiones     integer not null default 0
);
alter table public.usage enable row level security;

create or replace function public.add_usage(
  p_dia date, p_entrada bigint, p_salida bigint, p_costo numeric, p_peticiones integer
) returns public.usage language sql as $$
  insert into public.usage as u (dia, tokens_entrada, tokens_salida, costo_usd, peticiones)
  values (p_dia, p_entrada, p_salida, p_costo, p_peticiones)
  on conflict (dia) do update set
    tokens_entrada = u.tokens_entrada + excluded.tokens_entrada,
    tokens_salida  = u.tokens_salida  + excluded.tokens_salida,
    costo_usd      = u.costo_usd      + excluded.costo_usd,
    peticiones     = u.peticiones     + excluded.peticiones
  returning *;
$$;

create table if not exists public.rate_limits (
  clave       text primary key,
  ventana_ini timestamptz not null,
  cuenta      integer not null
);
alter table public.rate_limits enable row level security;

-- Ventana fija: reinicia el contador al pasar la ventana. Devuelve el conteo actual.
create or replace function public.rate_hit(p_clave text, p_ventana_seg integer)
returns integer language plpgsql as $$
declare resultado integer;
begin
  insert into public.rate_limits as r (clave, ventana_ini, cuenta)
  values (p_clave, now(), 1)
  on conflict (clave) do update set
    ventana_ini = case when r.ventana_ini < now() - make_interval(secs => p_ventana_seg) then now() else r.ventana_ini end,
    cuenta      = case when r.ventana_ini < now() - make_interval(secs => p_ventana_seg) then 1 else r.cuenta + 1 end
  returning cuenta into resultado;
  return resultado;
end $$;

-- Solo service_role puede ejecutarlas.
revoke all on function public.add_usage(date, bigint, bigint, numeric, integer) from public, anon, authenticated;
revoke all on function public.rate_hit(text, integer) from public, anon, authenticated;
