type AndroidNativeResult = {
  success: boolean;
  verified?: boolean;
  message?: string;
  error?: string;
  [key: string]: any;
};

type NativeAndroidInterface = {
  isAndroidApp(): boolean;
  getDeviceInfo(token: string): string;
  isAccessibilityEnabled(token: string): boolean;
  openAccessibilitySettings(token: string): void;
  beginGoogleSignIn(clientId: string, token: string, callbackId: string): void;
  executeTool(name: string, argsJson: string, userId: string, token: string, callbackId: string): void;
};

declare global {
  interface Window {
    __HUBMIND_NATIVE_TOKEN__?: string;
    HubMindAndroidBridge?: NativeAndroidInterface;
    hubMindAndroid?: {
      isAndroidApp: boolean;
      getDeviceInfo: () => Promise<any>;
      isAccessibilityEnabled: () => Promise<boolean>;
      openAccessibilitySettings: () => void;
      signInWithGoogle: (clientId: string) => Promise<AndroidNativeResult>;
      executeTool: (name: string, args: Record<string, any>, userId?: string) => Promise<AndroidNativeResult>;
      __resolve?: (id: string, resultJson: string) => void;
    };
  }
}

const pending = new Map<string, (result: AndroidNativeResult) => void>();
let requestSequence = 0;

export function installAndroidNativeBridge(): boolean {
  if (typeof window === 'undefined') return false;
  const native = window.HubMindAndroidBridge;
  if (!native || typeof native.isAndroidApp !== 'function' || !native.isAndroidApp()) return false;
  if (window.hubMindAndroid?.isAndroidApp) return true;

  window.hubMindAndroid = {
    isAndroidApp: true,
    getDeviceInfo: async () => {
      try { return JSON.parse(native.getDeviceInfo(String(window.__HUBMIND_NATIVE_TOKEN__ || '')) || '{}'); }
      catch { return {}; }
    },
    isAccessibilityEnabled: async () => {
      try { return native.isAccessibilityEnabled(String(window.__HUBMIND_NATIVE_TOKEN__ || '')) === true; }
      catch { return false; }
    },
    openAccessibilitySettings: () => {
      try { native.openAccessibilitySettings(String(window.__HUBMIND_NATIVE_TOKEN__ || '')); } catch {}
    },
    signInWithGoogle: (clientId) => new Promise(resolve => {
      const callbackId = 'google-' + Date.now().toString(36) + '-' + (++requestSequence).toString(36);
      const timeout = window.setTimeout(() => {
        if (!pending.has(callbackId)) return;
        pending.delete(callbackId);
        resolve({ success: false, error: 'Google sign-in did not respond before timing out.' });
      }, 60000);
      pending.set(callbackId, result => {
        window.clearTimeout(timeout);
        resolve(result);
      });
      try {
        native.beginGoogleSignIn(String(clientId || ''), String(window.__HUBMIND_NATIVE_TOKEN__ || ''), callbackId);
      } catch (error: any) {
        window.clearTimeout(timeout);
        pending.delete(callbackId);
        resolve({ success: false, error: String(error?.message || 'Could not start Google sign-in.') });
      }
    }),
    executeTool: (name, args, userId = '') => new Promise(resolve => {
      const callbackId = 'android-' + Date.now().toString(36) + '-' + (++requestSequence).toString(36);
      const timeout = window.setTimeout(() => {
        if (!pending.has(callbackId)) return;
        pending.delete(callbackId);
        resolve({ success: false, verified: false, error: 'The Android native agent did not respond before the request timed out.' });
      }, 25000);
      pending.set(callbackId, result => {
        window.clearTimeout(timeout);
        resolve(result);
      });
      try {
        native.executeTool(name, JSON.stringify(args || {}), String(userId || ''), String(window.__HUBMIND_NATIVE_TOKEN__ || ''), callbackId);
      } catch (error: any) {
        window.clearTimeout(timeout);
        pending.delete(callbackId);
        resolve({ success: false, verified: false, error: String(error?.message || 'Could not reach the Android native agent.') });
      }
    }),
    __resolve: (id, resultJson) => {
      const resolve = pending.get(id);
      if (!resolve) return;
      pending.delete(id);
      try { resolve(JSON.parse(resultJson)); }
      catch { resolve({ success: false, verified: false, error: 'Android agent returned an invalid response.' }); }
    },
  };
  window.__hubMindAndroidResolve = (id: string, resultJson: string) => window.hubMindAndroid?.__resolve?.(id, resultJson);
  return true;
}

declare global {
  interface Window {
    __hubMindAndroidResolve?: (id: string, resultJson: string) => void;
  }
}
