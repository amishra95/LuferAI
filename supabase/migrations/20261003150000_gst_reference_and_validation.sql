-- =============================================================================
-- 0001 · GST reference data + GSTIN validation helpers
-- -----------------------------------------------------------------------------
-- GSTIN layout (15 chars):
--   [1-2]  State code (e.g. 29 = Karnataka, 07 = Delhi)
--   [3-12] PAN of the registered entity
--   [13]   Entity number for the same PAN in the state (1-9, A-Z)
--   [14]   'Z' (default)
--   [15]   Checksum (base-36, mod-36 alternating-weight algorithm)
-- =============================================================================

-- GST state / UT codes ----------------------------------------------------------
create table if not exists public.gst_state_codes (
  code        char(2) primary key check (code ~ '^[0-9]{2}$'),
  name        text not null,
  is_union_territory boolean not null default false
);

comment on table public.gst_state_codes is
  'Reference list of GST state/UT codes (first two characters of a GSTIN).';

insert into public.gst_state_codes (code, name, is_union_territory) values
  ('01', 'Jammu and Kashmir', true),
  ('02', 'Himachal Pradesh', false),
  ('03', 'Punjab', false),
  ('04', 'Chandigarh', true),
  ('05', 'Uttarakhand', false),
  ('06', 'Haryana', false),
  ('07', 'Delhi', true),
  ('08', 'Rajasthan', false),
  ('09', 'Uttar Pradesh', false),
  ('10', 'Bihar', false),
  ('11', 'Sikkim', false),
  ('12', 'Arunachal Pradesh', false),
  ('13', 'Nagaland', false),
  ('14', 'Manipur', false),
  ('15', 'Mizoram', false),
  ('16', 'Tripura', false),
  ('17', 'Meghalaya', false),
  ('18', 'Assam', false),
  ('19', 'West Bengal', false),
  ('20', 'Jharkhand', false),
  ('21', 'Odisha', false),
  ('22', 'Chhattisgarh', false),
  ('23', 'Madhya Pradesh', false),
  ('24', 'Gujarat', false),
  ('26', 'Dadra and Nagar Haveli and Daman and Diu', true),
  ('27', 'Maharashtra', false),
  ('29', 'Karnataka', false),
  ('30', 'Goa', false),
  ('31', 'Lakshadweep', true),
  ('32', 'Kerala', false),
  ('33', 'Tamil Nadu', false),
  ('34', 'Puducherry', true),
  ('35', 'Andaman and Nicobar Islands', true),
  ('36', 'Telangana', false),
  ('37', 'Andhra Pradesh', false),
  ('38', 'Ladakh', true),
  ('97', 'Other Territory', true)
on conflict (code) do nothing;

-- GSTIN checksum (mirrors lib/gst-engine.ts → computeGstinChecksum) -------------
create or replace function public.gstin_checksum(p_first14 text)
returns char(1)
language plpgsql
immutable
strict
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  total    integer := 0;
  i        integer;
  val      integer;
  product  integer;
begin
  if length(p_first14) <> 14 then
    return null;
  end if;

  for i in 1..14 loop
    val := strpos(alphabet, substr(p_first14, i, 1)) - 1;
    if val < 0 then
      return null;
    end if;
    -- 1-indexed: odd positions weight 1, even positions weight 2
    product := val * (case when i % 2 = 0 then 2 else 1 end);
    total := total + (product / 36) + (product % 36);
  end loop;

  return substr(alphabet, ((36 - (total % 36)) % 36) + 1, 1);
end;
$$;

create or replace function public.is_valid_gstin(p_gstin text)
returns boolean
language sql
immutable
strict
as $$
  select p_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
     and right(p_gstin, 1) = public.gstin_checksum(left(p_gstin, 14));
$$;

comment on function public.is_valid_gstin(text) is
  'True when the GSTIN matches the 15-char structure and its checksum digit is correct.';
