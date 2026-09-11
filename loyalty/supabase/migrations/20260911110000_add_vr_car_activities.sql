begin;

-- Add the two new passport categories without changing any existing member
-- balance, reward count, visit total, or activity setting.
insert into public.loyalty_activities(
  slug,
  display_name,
  sort_order,
  points_per_visit,
  reward_threshold,
  reward_text,
  reward_text_ar
)
values
  (
    'vr',
    'VR',
    7,
    1,
    10,
    '10 VR visits unlock a reward',
    '10 زيارات في الواقع الافتراضي تمنحك مكافأة'
  ),
  (
    'car',
    'Car',
    8,
    1,
    10,
    '10 Car visits unlock a reward',
    '10 زيارات في السيارات تمنحك مكافأة'
  )
on conflict (slug) do nothing;

-- Every existing customer receives empty ledgers for the new activities.
-- ON CONFLICT deliberately leaves any pre-existing progress untouched.
insert into public.loyalty_accounts(customer_id, activity_id)
select c.id, a.id
from public.customers c
cross join public.loyalty_activities a
where a.slug in ('vr', 'car')
on conflict (customer_id, activity_id) do nothing;

-- Supports the bounded orphan-token cleanup in member_summary_v3 while also
-- helping audit lookups by their scan-token foreign key.
create index if not exists scan_events_scan_token_fk_idx
  on public.scan_events(scan_token_id)
  where scan_token_id is not null;

commit;
