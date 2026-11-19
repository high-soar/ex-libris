import type { Preview } from "@storybook/react";
import "../src/index.css";

if (typeof document !== "undefined") {
  document.documentElement.lang = "ja";
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
