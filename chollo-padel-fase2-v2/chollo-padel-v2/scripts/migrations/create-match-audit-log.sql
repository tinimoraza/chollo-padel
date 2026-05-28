-- ================================================================
-- match_audit_log
-- Tabla de auditoría automática de matches (TOP y CHOLLOS)
-- Creada por: scripts/migrations/create-match-audit-log.sql
-- Usada por:  /api/cron/audit-matches
-- ================================================================

CREATE TABLE IF NOT EXISTS match_audit_log (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  checked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Origen del problema
  source         TEXT NOT NULL CHECK (source IN ('top', 'chollos')),
  severity       TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
  check_code     TEXT NOT NULL,  -- 'M1_YEAR_MISMATCH', 'C1_URL_YEAR_MISMATCH', etc.

  -- Contexto del item afectado
  external_id    TEXT,           -- external_id en wallapop_cache (solo para TOP)
  pala_id        UUID,
  pala_modelo    TEXT,
  titulo         TEXT,           -- título del anuncio o URL del snapshot

  -- Descripción legible del problema
  descripcion    TEXT NOT NULL,

  -- ¿Se corrigió automáticamente?
  auto_corregido BOOLEAN NOT NULL DEFAULT FALSE
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS match_audit_log_checked_at  ON match_audit_log (checked_at DESC);
CREATE INDEX IF NOT EXISTS match_audit_log_source      ON match_audit_log (source);
CREATE INDEX IF NOT EXISTS match_audit_log_severity    ON match_audit_log (severity);
CREATE INDEX IF NOT EXISTS match_audit_log_check_code  ON match_audit_log (check_code);
CREATE INDEX IF NOT EXISTS match_audit_log_pala_id     ON match_audit_log (pala_id);

-- Row Level Security: solo service role puede escribir, cualquier autenticado puede leer
ALTER TABLE match_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON match_audit_log
  FOR ALL USING (true);

-- Limpieza automática: borrar logs de más de 90 días (evitar acumulación infinita)
-- Ejecutar manualmente o programar como pg_cron si está disponible:
-- DELETE FROM match_audit_log WHERE checked_at < NOW() - INTERVAL '90 days';

COMMENT ON TABLE match_audit_log IS
  'Log de auditoría automática de matches. Generado por /api/cron/audit-matches cada hora.
   Registra matches incorrectos detectados en TOP y CHOLLOS, y si fueron auto-corregidos.
   Consultar con: SELECT * FROM match_audit_log ORDER BY checked_at DESC LIMIT 100;';
