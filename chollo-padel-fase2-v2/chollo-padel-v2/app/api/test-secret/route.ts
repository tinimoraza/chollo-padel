export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({
    secret_length: process.env.CRON_SECRET?.length ?? 0,
    secret_start: process.env.CRON_SECRET?.substring(0, 6) ?? 'UNDEFINED',
    secret_end: process.env.CRON_SECRET?.slice(-6) ?? 'UNDEFINED',
  })
}
