const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({ testDir:'./tests', testMatch:'*.spec.cjs', workers:1, use:{ headless:true, acceptDownloads:true }, webServer:{ command:'python -m http.server 8830 --bind 127.0.0.1', url:'http://127.0.0.1:8830/demo.html', reuseExistingServer:!process.env.CI }, reporter:'list' });
