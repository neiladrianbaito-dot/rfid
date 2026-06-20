alter table public.auth_users
add column if not exists linked_card_uid text;
