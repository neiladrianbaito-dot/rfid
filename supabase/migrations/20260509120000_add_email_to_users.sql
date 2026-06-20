-- Link RFID card rows (users) to app login emails for dual-table sign-in checks.
alter table public.users
  add column if not exists email text;

create unique index if not exists users_email_lower_key
  on public.users (lower(trim(email)))
  where email is not null and length(trim(email)) > 0;
