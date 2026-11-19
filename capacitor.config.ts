import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.highsoar.exlibris",
  appName: "ExLibris",
  webDir: "dist",
  backgroundColor: "#000000",
  android: {
    backgroundColor: "#000000",
    adjustMarginsForEdgeToEdge: "auto",
  },
  plugins: {
    CapacitorHttp: {
      // Zero-Copy ArrayBuffer streaming via native Chromium fetch requires CapacitorHttp global patching to stay disabled.
      enabled: false,
    },
  },
};

export default config;
