import {
  processRepair,
  transferBuffers,
  type RepairRequest,
} from './mesh-repair-protocol';

self.onmessage = (event: MessageEvent<RepairRequest>) => {
  try {
    const response = processRepair(event.data);
    self.postMessage(response, {
      transfer: response.geometry ? transferBuffers(response.geometry) : [],
    });
  } catch {
    // Send no raw exception or provider content back into user-visible errors.
    self.postMessage({
      id: event.data.id,
      geometry: null,
      milliseconds: 0,
      failed: true,
    });
  }
};
