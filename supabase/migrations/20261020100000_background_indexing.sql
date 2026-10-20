-- Indexação em segundo plano: o pg_cron chama a Edge Function brain-index-worker a cada 2 minutos.
-- O segredo do agendador é gerado aqui dentro e fica só no Vault; a função o valida pela RPC
-- brain_check_cron_secret, então ele nunca aparece no código nem em variáveis de ambiente.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'brain_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'brain_cron_secret');
  end if;
  if not exists (select 1 from vault.secrets where name = 'brain_project_url') then
    perform vault.create_secret('https://eicmqisneklcvhakvgce.supabase.co', 'brain_project_url');
  end if;
end $$;

create or replace function public.brain_check_cron_secret(p_secret text)
returns boolean
language sql
security definer
set search_path = public, vault
as $$
  select coalesce(p_secret <> '' and p_secret = (
    select decrypted_secret from vault.decrypted_secrets where name = 'brain_cron_secret'
  ), false);
$$;

revoke all on function public.brain_check_cron_secret(text) from public, anon, authenticated;
grant execute on function public.brain_check_cron_secret(text) to service_role;

create or replace function public.brain_trigger_indexing()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_secret text;
begin
  -- nada pendente: não gasta chamada
  if not exists (
    select 1 from public.brain_items
    where analysis_status = 'pending'
       or (analysis_status = 'processing' and analysis_updated_at < now() - interval '10 minutes')
  ) then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'brain_project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'brain_cron_secret';
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/brain-index-worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
end $$;

revoke all on function public.brain_trigger_indexing() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('brain-background-indexing')
  where exists (select 1 from cron.job where jobname = 'brain-background-indexing');
  perform cron.schedule('brain-background-indexing', '*/2 * * * *', 'select public.brain_trigger_indexing()');
end $$;
