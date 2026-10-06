/**
 * Offline subsystem — device capability detection (2026-10-06).
 *
 * Gathers every honest signal the browser exposes, estimates a RAM class,
 * and hands the model registry enough to recommend a tier. NOTHING here
 * downloads anything; the recommendation is a starting point and the user
 * can always override it in the model picker.
 */

import { recommendModelForDevice, type DeviceRecommendation } from "./model-registry";

export interface DeviceCapabilities {
  /** navigator.gpu (WebGPU adapter handle) present */
  webgpu: boolean;
  /** navigator.hardwareConcurrency */
  cpuCores: number | null;
  /** navigator.deviceMemory — coarse, caps at ~8 in most browsers */
  deviceMemoryGB: number | null;
  /** navigator.storage.estimate() quota/usage (when available) */
  storageQuotaGB: number | null;
  storageUsedGB: number | null;
  /** platform string from userAgentData or navigator.platform */
  platform: string;
  /** CPU architecture from high-entropy UA data (when available) */
  cpuArchitecture: string | null;
  /** honest note about what could not be detected */
  detectionNotes: string[];
}

export interface DeviceAnalysis {
  capabilities: DeviceCapabilities;
  /** conservative RAM estimate in GB (deviceMemory caps at 8; storage quota hints at more) */
  ramEstimateGB: number;
  recommendation: DeviceRecommendation;
}

/**
 * Pure analysis — tested with explicit inputs. Browser detection feeds it:
 *  - RAM estimate: navigator.deviceMemory when present (a FLOOR, it caps at
 *    8 GB); if the storage quota far exceeds it, note the uncertainty
 *    rather than inventing a number.
 *  - free disk: (storage quota - usage) — only a quota, not a promise.
 */
export function analyzeDeviceCapabilities(caps: DeviceCapabilities): DeviceAnalysis {
  const notes = [...caps.detectionNotes];
  if (!caps.webgpu && !notes.some((n) => n.includes("WebGPU"))) {
    notes.push("WebGPU not available — inference will run on WASM (slower; the strongest tier is not recommended).");
  }
  let ramEstimateGB: number;
  if (caps.deviceMemoryGB !== null) {
    ramEstimateGB = caps.deviceMemoryGB;
    if (caps.deviceMemoryGB >= 8) {
      notes.push("deviceMemory reports 8 GB — browsers cap this value, so real RAM may be higher; the estimate is conservative.");
    }
  } else {
    ramEstimateGB = 2;
    notes.push("deviceMemory not exposed by this browser — assuming a conservative 2 GB floor.");
  }
  if (caps.cpuCores !== null && caps.cpuCores <= 2) {
    notes.push("Few CPU cores detected — inference will be slow; the lightweight tier is the honest fit.");
  }
  const freeDiskGB =
    caps.storageQuotaGB !== null && caps.storageUsedGB !== null
      ? Math.max(0, caps.storageQuotaGB - caps.storageUsedGB)
      : undefined;
  if (freeDiskGB !== undefined && freeDiskGB < 1) {
    notes.push(`Only ~${freeDiskGB.toFixed(1)} GB of storage quota free — a large model download may not fit.`);
  }
  const recommendation = recommendModelForDevice({ ramGB: ramEstimateGB, webgpu: caps.webgpu, freeDiskGB });
  return { capabilities: { ...caps, detectionNotes: notes }, ramEstimateGB, recommendation };
}

/**
 * Browser detection — best effort, never throws; every undetectable signal
 * is reported honestly in detectionNotes instead of being invented.
 */
export async function detectDeviceCapabilities(): Promise<DeviceAnalysis> {
  const notes: string[] = [];
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>> };
    storage?: { estimate?: () => Promise<{ quota?: number; usage?: number }> };
  };

  const webgpu = "gpu" in nav;
  if (!webgpu) notes.push("WebGPU not available — inference will run on WASM (slower; the strongest tier is not recommended).");

  const cpuCores = typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null;
  if (cpuCores === null) notes.push("CPU core count not exposed.");

  const deviceMemoryGB = typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;

  let storageQuotaGB: number | null = null;
  let storageUsedGB: number | null = null;
  try {
    const est = await nav.storage?.estimate?.();
    if (est?.quota !== undefined) storageQuotaGB = Math.round((est.quota / 1024 ** 3) * 10) / 10;
    if (est?.usage !== undefined) storageUsedGB = Math.round((est.usage / 1024 ** 3) * 10) / 10;
  } catch {
    notes.push("Storage estimate unavailable.");
  }

  let platform = (nav as { platform?: string }).platform ?? "unknown";
  let cpuArchitecture: string | null = null;
  try {
    if (nav.userAgentData?.getHighEntropyValues) {
      const hev = await nav.userAgentData.getHighEntropyValues(["architecture", "platform"]);
      if (typeof hev.platform === "string") platform = `${platform} / ${hev.platform}`;
      if (typeof hev.architecture === "string") cpuArchitecture = hev.architecture;
    } else {
      notes.push("High-entropy UA data unavailable — CPU architecture not detected.");
    }
  } catch {
    notes.push("CPU architecture detection failed.");
  }

  return analyzeDeviceCapabilities({
    webgpu,
    cpuCores,
    deviceMemoryGB,
    storageQuotaGB,
    storageUsedGB,
    platform,
    cpuArchitecture,
    detectionNotes: notes,
  });
}
