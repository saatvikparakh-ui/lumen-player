/**
 * Deprecated: Voice assistant and Hey Lumen have been removed per user specification.
 */
export const WakeWordService = {
  requestMicPermission: async () => false,
  start: () => {},
  stop: () => {},
  onWake: () => {}
};
