import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.albrth.fxreplay',
  appName: 'FX Replay',
  webDir: 'dist',
  backgroundColor: '#0b0e13',
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
