const config = {
  appId: 'com.schoolaria.app',
  appName: 'Schoolaria',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
    cleartext: false,
    allowNavigation: [
      '*.firebaseapp.com',
      '*.googleapis.com',
      'accounts.google.com',
      '*.run.app',
    ],
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false,
  },
};

export default config;
