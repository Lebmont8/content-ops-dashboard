import { once } from 'node:events';
import { openBrowser } from './browser.mjs';
import { createDashboard } from './dashboard.mjs';
import { createHttp } from './http.mjs';

const port = Number(process.env.PORT ?? 4175);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a valid TCP port.');

const dashboard = await createDashboard(await openBrowser(process.env.CHROME_PATH));
let server;
try {
  server = await createHttp(dashboard);
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  dashboard.start();
  console.log('http://127.0.0.1:' + server.address().port);
} catch (error) {
  await dashboard.close();
  throw error;
}

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const closed = new Promise(resolve => server.close(resolve));
  await dashboard.close();
  await closed;
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
