-- Migración 003: datos por usuario (login con Supabase Auth).
-- sessions.user_id y logs.user_id guardan el id del usuario autenticado (auth.users.id).
-- Nullable a propósito: las filas anteriores y la app sin login (AUTH=off) quedan con user_id nulo.
-- El servidor filtra SIEMPRE por user_id; las tablas siguen con RLS activo y sin políticas (solo service_role).
-- Idempotente: se puede volver a ejecutar.

alter table public.sessions add column if not exists user_id uuid;
alter table public.logs     add column if not exists user_id uuid;

-- Historial de un usuario, más recientes primero.
create index if not exists sessions_user_updated on public.sessions (user_id, updated_at desc);
create index if not exists logs_user_ts          on public.logs     (user_id, ts desc);
