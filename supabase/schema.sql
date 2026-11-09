-- Esquema para el agente de registro de proveedor.
-- Ejecutar en Supabase: SQL Editor -> pegar -> Run. Es idempotente.
-- El backend usa la clave service_role (solo en variables de entorno del servidor).

create table if not exists public.sessions (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.logs (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  caso       text,
  session_id text,
  herramienta text not null,
  ok         boolean not null,
  resumen    text not null
);
create index if not exists logs_caso_ts on public.logs (caso, ts);

-- Sin políticas: solo el rol service_role (que ignora RLS) puede leer o escribir.
alter table public.sessions enable row level security;
alter table public.logs     enable row level security;

-- Bucket privado para los paquetes (formulario, soportes, checklist, correo).
insert into storage.buckets (id, name, public)
values ('paquetes', 'paquetes', false)
on conflict (id) do nothing;
