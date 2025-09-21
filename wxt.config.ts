import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  extensionApi: 'chrome',
  srcDir: 'src',
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  manifest: {
    name: "__MSG_extensionName__",
    description: "__MSG_extensionDescription__",
    default_locale: 'en',
    permissions: ['storage', 'bookmarks', 'notifications', 'alarms'],
    host_permissions: ["https://*.github.com/", "https://*.githubusercontent.com/"],
    optional_host_permissions: [
      "*://*/*",
    ]
  }
});
