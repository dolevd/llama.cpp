import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	expect: {
		timeout: 5000
	},
	forbidOnly: !!process.env.CI,
	fullyParallel: true,
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],
	reporter: 'line',
	retries: process.env.CI ? 2 : 0,
	testDir: 'tests/e2e',
	testMatch: ['**/*.e2e.ts'],
	timeout: 30000,
	use: {
		baseURL: 'http://localhost:8181',
		trace: 'on-first-retry'
	},
	webServer: process.env.PLAYWRIGHT_SKIP_WEB_SERVER
		? undefined
		: {
				command: 'node tests/e2e/mock-llama-server.mjs --build --dist ./dist --port 8181',
				port: 8181,
				timeout: 120000,
				gracefulShutdown: { signal: 'SIGINT', timeout: 500 },
				reuseExistingServer: !process.env.CI
			},
	workers: process.env.CI ? 1 : undefined
});
