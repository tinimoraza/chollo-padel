-- ═══════════════════════════════════════════════════════
--  CHOLLO PADEL — Script SQL para Supabase
--  Copia y pega esto en: Supabase → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════

-- Tabla principal de alertas
CREATE TABLE IF NOT EXISTS alertas (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  query           TEXT NOT NULL,
  max_price       INTEGER,
  condition       TEXT,        -- 'nuevo', 'buen', 'aceptable' o null (cualquiera)
  platform        TEXT DEFAULT 'all',  -- 'all', 'wallapop', 'vinted'
  email           TEXT NOT NULL,
  activa          BOOLEAN DEFAULT TRUE,
  ultima_revision TIMESTAMPTZ,
  ultima_notificacion TIMESTAMPTZ
);

-- Tabla para llevar registro de qué chollos ya notificamos
-- (así no mandamos el mismo email dos veces)
CREATE TABLE IF NOT EXISTS notificaciones (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  alerta_id   UUID REFERENCES alertas(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL,
  precio      INTEGER,
  titulo      TEXT,
  url         TEXT,
  UNIQUE(alerta_id, item_id)   -- evita duplicados
);

-- Índices para que las consultas vayan rápido
CREATE INDEX IF NOT EXISTS idx_alertas_activa ON alertas(activa);
CREATE INDEX IF NOT EXISTS idx_notificaciones_alerta ON notificaciones(alerta_id);

-- Habilitar Row Level Security (recomendado)
ALTER TABLE alertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;

-- Política: el servidor (service role) puede hacer todo
-- Los usuarios anónimos no pueden ver datos de otros
CREATE POLICY "service_role_all" ON alertas FOR ALL USING (true);
CREATE POLICY "service_role_all" ON notificaciones FOR ALL USING (true);
