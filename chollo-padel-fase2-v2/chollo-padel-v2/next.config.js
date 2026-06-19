/** @type {import('next').NextConfig} */
const nextConfig = {
  // @xenova/transformers (usado por scripts/prices/embedding-matcher.js, vía
  // secondhand-matcher.js, vía app/api/cron/match-wallapop) carga onnxruntime-node,
  // que incluye binarios nativos .node por cada plataforma (darwin/linux/win32 x arm64/x64).
  // Sin esto, webpack intenta parsear esos binarios como JS y el build falla con
  // "Module parse failed: Unexpected character" en onnxruntime_binding.node.
  // serverComponentsExternalPackages hace que Next los deje fuera del bundle y los
  // cargue con require() normal de Node en tiempo de ejecución (serverless function).
  experimental: {
    serverComponentsExternalPackages: ['@xenova/transformers', 'onnxruntime-node'],
  },
}
module.exports = nextConfig
