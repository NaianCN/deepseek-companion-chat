import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: 'http://localhost:8090', timezoneId: 'Asia/Shanghai' },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:8090',
    reuseExistingServer: !process.env.CI,
  },
})
