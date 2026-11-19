import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.highsoar.exlibris",
  appName: "ExLibris",
  webDir: "dist",
  plugins: {
    CapacitorHttp: {
      // Zero-Copy ArrayBuffer streaming via native Chromium fetch requires CapacitorHttp global patching to stay disabled.
      enabled: false,
    },
  },
};

export default config;
