alter table public.auth_users
add column if not exists password_hash text not null default '';
