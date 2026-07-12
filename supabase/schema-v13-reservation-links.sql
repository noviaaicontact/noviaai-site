-- Plusieurs liens de réservation / soumission par commerce
alter table public.tenants
  add column if not exists reservation_links jsonb default '[]'::jsonb;

update public.tenants
set reservation_links = jsonb_build_array(jsonb_build_object('label', '', 'url', reservation_url))
where coalesce(reservation_url, '') <> ''
  and (reservation_links is null or reservation_links = '[]'::jsonb);
