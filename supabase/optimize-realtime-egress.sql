-- Limit incident change payloads to fields used by the live interfaces.
-- Media remains available through authenticated, ticket-scoped SELECT queries.
DO $$
DECLARE
  publicacion_todas_las_tablas boolean;
  filtro_incidentes text;
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION 'Se requiere PostgreSQL 15 o superior para limitar columnas de la publicación Realtime.';
  END IF;

  SELECT puballtables
  INTO publicacion_todas_las_tablas
  FROM pg_publication
  WHERE pubname = 'supabase_realtime';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe la publicación supabase_realtime en este proyecto.';
  END IF;

  IF publicacion_todas_las_tablas OR EXISTS (
    SELECT 1
    FROM pg_publication_namespace pn
    JOIN pg_namespace n ON n.oid = pn.pnnspid
    JOIN pg_publication p ON p.oid = pn.pnpubid
    WHERE p.pubname = 'supabase_realtime'
      AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION 'supabase_realtime publica todas las tablas o el esquema public; cambia esa configuración antes de limitar incidentes.';
  END IF;

  SELECT rowfilter
  INTO filtro_incidentes
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'incidentes';

  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'incidentes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.incidentes';
  END IF;

  IF filtro_incidentes IS NULL THEN
    EXECUTE $command$
      ALTER PUBLICATION supabase_realtime
      ADD TABLE public.incidentes (
        id, ticket, ciudadano_dni, tipo, prioridad, ubicacion, referencia,
        nota_evidencia, tiene_audio, tiene_audio_evidencia, tiene_foto,
        estado, unidad_asignada, unidad, unidad_codigo, eta_minutos,
        observaciones, timestamp, updated_at, atendido_at
      )
    $command$;
  ELSE
    EXECUTE format(
      'ALTER PUBLICATION supabase_realtime ADD TABLE public.incidentes (
        id, ticket, ciudadano_dni, tipo, prioridad, ubicacion, referencia,
        nota_evidencia, tiene_audio, tiene_audio_evidencia, tiene_foto,
        estado, unidad_asignada, unidad, unidad_codigo, eta_minutos,
        observaciones, timestamp, updated_at, atendido_at
      ) WHERE (%s)',
      filtro_incidentes
    );
  END IF;
END;
$$;
