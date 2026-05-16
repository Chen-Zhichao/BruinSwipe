update public.wallet_state
set data = jsonb_set(
  data,
  '{people}',
  coalesce(
    (
      select jsonb_agg(
        case
          when person ->> 'role' = 'organizer' then person || '{"contact": ""}'::jsonb
          else person
        end
      )
      from jsonb_array_elements(data -> 'people') as person
    ),
    '[]'::jsonb
  )
)
where id = 'main';
