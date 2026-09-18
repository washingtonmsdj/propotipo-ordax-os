alter table ordax_os.device_state
  add column if not exists delivery_number bigint,
  add column if not exists boot_refresh_required boolean;

alter table ordax_os.device_events
  add column if not exists delivery_number bigint,
  add column if not exists boot_refresh_required boolean;

create or replace function public.ordax_os_ingest_telemetry(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_device_id text;
  v_now timestamptz := now();
  v_previous jsonb;
  v_current jsonb;
  v_last_applied_at timestamptz;
  v_rescue_generation bigint;
  v_relay_version integer;
  v_delivery_number bigint;
  v_boot_refresh_required boolean;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'telemetry payload must be an object';
  end if;

  v_device_id := p_payload->>'deviceId';
  if v_device_id is null or v_device_id !~ '^[a-z0-9][a-z0-9._:-]{7,127}$' then
    raise exception 'invalid device id';
  end if;

  if coalesce(p_payload->>'lastAppliedAt','') <> '' then
    v_last_applied_at := (p_payload->>'lastAppliedAt')::timestamptz;
  end if;
  if coalesce(p_payload->>'rescueGeneration','') <> '' then
    v_rescue_generation := (p_payload->>'rescueGeneration')::bigint;
  end if;
  if coalesce(p_payload->>'deliveryNumber','') <> '' then
    v_delivery_number := (p_payload->>'deliveryNumber')::bigint;
    if v_delivery_number < 0 or v_delivery_number > 10000000 then
      raise exception 'invalid delivery number';
    end if;
  end if;
  if p_payload ? 'bootRefreshRequired' and p_payload->'bootRefreshRequired' <> 'null'::jsonb then
    if jsonb_typeof(p_payload->'bootRefreshRequired') <> 'boolean' then
      raise exception 'invalid boot refresh flag';
    end if;
    v_boot_refresh_required := (p_payload->>'bootRefreshRequired')::boolean;
  end if;
  v_relay_version := coalesce((p_payload->>'relayVersion')::integer, 1);

  select jsonb_build_object(
    'sourceSha', source_sha,
    'runtimeSurfaceSha', payload->>'runtimeSurfaceSha',
    'deliveryNumber', delivery_number,
    'bootRefreshRequired', boot_refresh_required,
    'surfaceSourceSha', payload->>'surfaceSourceSha',
    'surfaceState', surface_state,
    'targetSha', target_sha,
    'updateStatus', update_status,
    'phase', phase,
    'applyMode', apply_mode,
    'attemptId', attempt_id,
    'rejectedSha', rejected_sha,
    'healthySha', healthy_sha,
    'lastAppliedSha', last_applied_sha,
    'rescueGeneration', rescue_generation,
    'rescueAction', rescue_action,
    'lastError', last_error
  )
  into v_previous
  from ordax_os.device_state
  where device_id = v_device_id;

  insert into ordax_os.device_state (
    device_id, last_seen_at, source_sha, delivery_number, boot_refresh_required,
    target_sha, update_status, phase, apply_mode, attempt_id, rejected_sha,
    healthy_sha, last_applied_sha, last_applied_at, rescue_generation,
    rescue_action, surface_state, boot_id, last_error, relay_version, payload
  )
  values (
    v_device_id, v_now, nullif(p_payload->>'sourceSha',''), v_delivery_number,
    v_boot_refresh_required, nullif(p_payload->>'targetSha',''),
    nullif(p_payload->>'updateStatus',''), nullif(p_payload->>'phase',''),
    nullif(p_payload->>'applyMode',''), nullif(p_payload->>'attemptId',''),
    nullif(p_payload->>'rejectedSha',''), nullif(p_payload->>'healthySha',''),
    nullif(p_payload->>'lastAppliedSha',''), v_last_applied_at,
    v_rescue_generation, coalesce(nullif(p_payload->>'rescueAction',''),'none'),
    coalesce(nullif(p_payload->>'surfaceState',''),'unknown'),
    nullif(p_payload->>'bootId',''), nullif(p_payload->>'lastError',''),
    v_relay_version, p_payload
  )
  on conflict (device_id) do update set
    last_seen_at = excluded.last_seen_at,
    source_sha = excluded.source_sha,
    delivery_number = excluded.delivery_number,
    boot_refresh_required = excluded.boot_refresh_required,
    target_sha = excluded.target_sha,
    update_status = excluded.update_status,
    phase = excluded.phase,
    apply_mode = excluded.apply_mode,
    attempt_id = excluded.attempt_id,
    rejected_sha = excluded.rejected_sha,
    healthy_sha = excluded.healthy_sha,
    last_applied_sha = excluded.last_applied_sha,
    last_applied_at = excluded.last_applied_at,
    rescue_generation = excluded.rescue_generation,
    rescue_action = excluded.rescue_action,
    surface_state = excluded.surface_state,
    boot_id = excluded.boot_id,
    last_error = excluded.last_error,
    relay_version = excluded.relay_version,
    payload = excluded.payload;

  v_current := jsonb_build_object(
    'sourceSha', nullif(p_payload->>'sourceSha',''),
    'runtimeSurfaceSha', nullif(p_payload->>'runtimeSurfaceSha',''),
    'deliveryNumber', v_delivery_number,
    'bootRefreshRequired', v_boot_refresh_required,
    'surfaceSourceSha', nullif(p_payload->>'surfaceSourceSha',''),
    'surfaceState', coalesce(nullif(p_payload->>'surfaceState',''),'unknown'),
    'targetSha', nullif(p_payload->>'targetSha',''),
    'updateStatus', nullif(p_payload->>'updateStatus',''),
    'phase', nullif(p_payload->>'phase',''),
    'applyMode', nullif(p_payload->>'applyMode',''),
    'attemptId', nullif(p_payload->>'attemptId',''),
    'rejectedSha', nullif(p_payload->>'rejectedSha',''),
    'healthySha', nullif(p_payload->>'healthySha',''),
    'lastAppliedSha', nullif(p_payload->>'lastAppliedSha',''),
    'rescueGeneration', v_rescue_generation,
    'rescueAction', coalesce(nullif(p_payload->>'rescueAction',''),'none'),
    'lastError', nullif(p_payload->>'lastError','')
  );

  if v_previous is null or v_previous is distinct from v_current then
    insert into ordax_os.device_events (
      device_id, observed_at, source_sha, delivery_number, boot_refresh_required,
      target_sha, update_status, phase, apply_mode, attempt_id, rejected_sha,
      healthy_sha, last_applied_sha, rescue_generation, rescue_action,
      last_error, payload
    )
    values (
      v_device_id, v_now, nullif(p_payload->>'sourceSha',''), v_delivery_number,
      v_boot_refresh_required, nullif(p_payload->>'targetSha',''),
      nullif(p_payload->>'updateStatus',''), nullif(p_payload->>'phase',''),
      nullif(p_payload->>'applyMode',''), nullif(p_payload->>'attemptId',''),
      nullif(p_payload->>'rejectedSha',''), nullif(p_payload->>'healthySha',''),
      nullif(p_payload->>'lastAppliedSha',''), v_rescue_generation,
      coalesce(nullif(p_payload->>'rescueAction',''),'none'),
      nullif(p_payload->>'lastError',''), p_payload
    );
  end if;

  return jsonb_build_object('ok', true, 'deviceId', v_device_id, 'receivedAt', v_now);
end;
$function$;
