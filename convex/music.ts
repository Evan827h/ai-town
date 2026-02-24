import { query } from './_generated/server';

export const getBackgroundMusic = query({
  handler: async () => {
    return '/ai-town/assets/background.mp3';
  },
});
