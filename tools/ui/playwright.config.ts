import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: ['**/*.e2e.ts'],
	timeout: 30000,
	expect: {
		timeout: 5000
	},
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'line',
	use: {
		baseURL: 'http://localhost:8181',
		trace: 'on-first-retry'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],
	webServer: process.env.PLAYWRIGHT_SKIP_WEB_SERVER
		? undefined
		: {
				command: 'node tests/e2e/mock-llama-server.mjs --build --dist ./dist --port 8181',
				port: 8181,
				timeout: 120000,
				gracefulShutdown: { signal: 'SIGINT', timeout: 500 },
				reuseExistingServer: !process.env.CI
			}
});
