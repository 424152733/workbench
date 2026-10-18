export const LOCAL_API_HOST = '127.0.0.1';

export const localFrontendOrigins = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
]);

const extraLocalPort = Number(process.env.WORKBENCH_LOCAL_FRONTEND_PORT);
if (Number.isInteger(extraLocalPort) && extraLocalPort >= 1024 && extraLocalPort <= 65535) {
  localFrontendOrigins.add(`http://127.0.0.1:${extraLocalPort}`);
  localFrontendOrigins.add(`http://localhost:${extraLocalPort}`);
}

export function localCorsOrigin(origin, callback) {
  if (!origin || localFrontendOrigins.has(origin)) return callback(null, true);
  return callback(new Error('仅允许本机工作台访问 API'), false);
}
