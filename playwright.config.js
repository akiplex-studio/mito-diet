// @ts-check
const { defineConfig, devices } = require('@playwright/test');

// スモークテスト用の最小構成。CIは不要・ローカルで走ればよい方針。
// index.html（1ファイル完結アプリ）を静的サーバーで配信し、ja-JP / en-US の2ロケールで起動確認する。
const PORT = 8123;

module.exports = defineConfig({
  // e2e/（起動スモーク）と tests/（クリティカルパス）の両方を拾う。
  // testMatchで *.spec.js に限定するので、ルートの tests.js（jscロジックテスト）は対象外。
  testDir: '.',
  testMatch: ['e2e/**/*.spec.js', 'tests/**/*.spec.js'],
  fullyParallel: true,
  forbidOnly: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  // index.html を配信するだけの静的サーバー（このMacには python3 がある。node http.serverでも可）
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: true,
    timeout: 20_000,
  },
  // ja-JP と en-US の2ロケールで同じスモークを走らせる
  projects: [
    {
      name: 'ja-JP',
      use: { ...devices['Desktop Chrome'], locale: 'ja-JP' },
    },
    {
      name: 'en-US',
      use: { ...devices['Desktop Chrome'], locale: 'en-US' },
    },
  ],
});
