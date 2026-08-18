-- ===========================================================================
-- THE COMMONS — the archive's memory
-- ---------------------------------------------------------------------------
-- Paste this whole file into the Supabase SQL editor and run it once.
--
-- The shape of it: anonymous visitors may read the archive and may do nothing
-- else. There is no INSERT policy anywhere, so the published anon key cannot
-- write a row however it is used. The only door is contribute(), which runs as
-- the definer, checks the code against a table anon cannot see at all, and
-- refuses anything malformed, oversized or too frequent.
--
-- Which is the piece's own argument, enforced: the archive is open to be
-- looked at by anyone and open to be added to by invitation.
-- ===========================================================================

-- --------------------------------------------------------------- invitations
create table if not exists public.invites (
  code        text primary key,
  label       text,                                   -- who you gave it to
  active      boolean     not null default true,
  created_at  timestamptz not null default now()
);
-- Two locks, because this is the one table nobody may ever read.
--
-- The privilege is revoked outright, which is what actually closes the door:
-- PostgREST asks as anon, anon has no select, the request fails. Row level
-- security on top adds a second refusal — enabled with no policy at all, which
-- denies everyone by default. contribute() and refine() still read it, because
-- they run as the definer and a table's owner is not subject to its RLS.
--
-- The revoke alone was enough. The dashboard's linter cannot see that, and
-- neither can someone reading this in a hurry, so both are here.
revoke all on public.invites from anon, authenticated;
alter table public.invites enable row level security;

-- -------------------------------------------------------------- the archive
create table if not exists public.contributions (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  thumb       text        not null,        -- 256 px JPEG as a data URI
  ar          real        not null,        -- aspect ratio
  feat        real[]      not null,        -- the 23 perceptual measurements
  aff         real[]      not null,        -- belonging: self / other / fiction
  rgb         real[],                      -- mean colour, for the record
  method      text        not null default 'resemblance',   -- or 'read'
  title       text,                        -- the kind it most resembles
  invite      text        references public.invites(code),  -- never exposed
  hidden      boolean     not null default false,            -- your veto
  absorbed    boolean     not null default false,  -- baked into the atlas
  clip        real[]                   -- CLIP's three raw scores, for re-centring
);

create index if not exists contributions_created_idx
  on public.contributions (created_at);

alter table public.contributions enable row level security;

-- read: everyone, except what you have hidden and what has already been baked
-- into the founding atlas by build/absorb.py — those plates ship with the page
-- now and would otherwise arrive twice.
drop policy if exists "the archive is open to look at" on public.contributions;
create policy "the archive is open to look at"
  on public.contributions for select
  to anon, authenticated
  using (hidden = false and absorbed = false);

-- no insert, update or delete policy exists, and that is the point.

-- column-level: `invite` and `hidden` are the archive's business, not a
-- visitor's. Selecting them fails even though the row is readable.
revoke all on public.contributions from anon, authenticated;
grant select (id, created_at, thumb, ar, feat, aff, rgb, method, title, clip)
  on public.contributions to anon, authenticated;

-- ----------------------------------------------------------------- the door
create or replace function public.contribute(
  p_code   text,
  p_thumb  text,
  p_ar     real,
  p_feat   real[],
  p_aff    real[],
  p_rgb    real[],
  p_method text,
  p_title  text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_recent int;
begin
  if not exists (select 1 from invites where code = p_code and active) then
    raise exception 'That invitation is not one the archive knows.';
  end if;

  if p_thumb is null or p_thumb !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
    raise exception 'The archive keeps pictures, and that is not one.';
  end if;

  if length(p_thumb) > 120000 then
    raise exception 'That picture is larger than the archive holds — 256 px is the cell.';
  end if;

  if p_feat is null or array_length(p_feat, 1) <> 23 then
    raise exception 'The measurements do not match what the archive expects.';
  end if;

  if p_aff is null or array_length(p_aff, 1) <> 3 then
    raise exception 'The belonging does not match what the archive expects.';
  end if;

  if p_ar is null or p_ar <= 0 or p_ar > 12 then
    raise exception 'That is not a shape a plate can be.';
  end if;

  select count(*) into v_recent
    from contributions
   where invite = p_code
     and created_at > now() - interval '1 hour';
  if v_recent >= 30 then
    raise exception 'That invitation has given the archive enough for one hour.';
  end if;

  insert into contributions (thumb, ar, feat, aff, rgb, method, title, invite)
  values (p_thumb, p_ar, p_feat, p_aff, p_rgb,
          coalesce(nullif(p_method, ''), 'resemblance'),
          left(coalesce(nullif(p_title, ''), 'unsorted'), 40),
          p_code)
  returning id into v_id;

  return v_id;
end;
$$;

-- ------------------------------------------------- the second opinion, later
-- CLIP finishes after the row already exists. It may revise where the picture
-- belongs, but only its own contributor's, and only on the day it was given.
create or replace function public.refine(
  p_code   text,
  p_id     uuid,
  p_aff    real[],
  p_method text,
  p_clip   real[] default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from invites where code = p_code and active) then
    raise exception 'That invitation is not one the archive knows.';
  end if;

  if p_aff is null or array_length(p_aff, 1) <> 3 then
    raise exception 'The belonging does not match what the archive expects.';
  end if;

  update contributions
     set aff = p_aff,
         method = coalesce(nullif(p_method, ''), 'read'),
         clip = coalesce(p_clip, clip)
   where id = p_id
     and invite = p_code
     and created_at > now() - interval '1 day';

  if not found then
    raise exception 'The archive has no such gift from that invitation.';
  end if;
end;
$$;

revoke all on function public.contribute(text, text, real, real[], real[], real[], text, text) from public;
revoke all on function public.refine(text, uuid, real[], text, real[]) from public;
grant execute on function public.contribute(text, text, real, real[], real[], real[], text, text) to anon, authenticated;
grant execute on function public.refine(text, uuid, real[], text, real[]) to anon, authenticated;

-- ===========================================================================
-- Hand out an invitation. Do this once per person, so you can switch one off
-- without switching everyone off.
--
--   insert into public.invites (code, label) values ('open-sesame', 'Ana');
--
-- Take one back:
--
--   update public.invites set active = false where code = 'open-sesame';
--
-- Take one picture down without deleting it:
--
--   update public.contributions set hidden = true where id = '…';
--
-- See what has been given, without the pictures:
--
--   select id, created_at, title, method, aff, invite
--     from public.contributions order by created_at desc limit 50;
-- ===========================================================================
