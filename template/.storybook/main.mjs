/** @type {import('@storybook/web-components-vite').StorybookConfig} */
export default {
  framework: '@storybook/web-components-vite',
  stories: ['../stories/**/*.stories.@(js|jsx|mjs)'],
  addons: [
    {
      name: '@dylanlindgren/storybook-addon-sn-next-ui',
      options: {
        // Where your component source lives relative to the project root. 
        // Default: 'src/now-ui'.
        componentSrcDir: 'src/now-ui',
      },
    },
  ],
  core: { disableTelemetry: true },
}