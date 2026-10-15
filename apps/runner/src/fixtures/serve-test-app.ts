// Runs the controlled test application as its own process (Playwright `webServer`),
// so a busy test runner can never delay its responses. Usage:
//   node src/fixtures/serve-test-app.ts
import { TEST_APP_ORIGIN, startTestApp, stopTestApp } from './test-app.ts';

const server = await startTestApp();
process.stdout.write(`API QA test app listening on ${TEST_APP_ORIGIN}\n`);

const shutdown = (): void => {
  void stopTestApp(server).then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
