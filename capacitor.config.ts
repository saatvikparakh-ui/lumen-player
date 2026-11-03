import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lumen.music',
  appName: 'Lumen',
  webDir: 'dist',
  backgroundColor: '#080A10',
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: true,
    backgroundColor: '#080A10'
  },
  server: {
    androidScheme: 'https',
    cleartext: true
  }
};

export default config;
