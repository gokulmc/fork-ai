// Typings for the native bridge Capacitor injects at document-start as
// `window.Capacitor.Plugins.*` in the Android/iOS app shell. This is the ONLY
// place in apps/code-web that declares `Window.Capacitor` — no @capacitor/*
// npm deps here, since the web app is loaded remotely by a thin native shell
// and must stay buildable/runnable standalone.
//
// Ported from apps/web/src/lib/native.ts — code-web only needs the push +
// haptics surface so far (no Filesystem/Share/App download helpers here).

export interface PluginListenerHandle {
  remove: () => Promise<void>;
}

export interface CapacitorHapticsPlugin {
  impact(options?: { style?: 'HEAVY' | 'MEDIUM' | 'LIGHT' }): Promise<void>;
  notification(options?: { type?: 'SUCCESS' | 'WARNING' | 'ERROR' }): Promise<void>;
  selectionChanged(): Promise<void>;
}

export interface CapacitorPushPlugin {
  requestPermissions(): Promise<{ receive: 'granted' | 'denied' | 'prompt' }>;
  register(): Promise<void>;
  // The injected runtime returns the listener handle SYNCHRONOUSLY; only
  // @capacitor/*'s npm wrapper promisifies it. Callers must Promise.resolve()
  // the result — calling .then() on it directly crashed the app shell in
  // apps/web (see its issues.md).
  addListener(
    eventName: 'registration',
    cb: (token: { value: string }) => void,
  ): PluginListenerHandle | Promise<PluginListenerHandle>;
}

// Subset of @capgo/native-purchases' real Product/Transaction shapes (see
// node_modules/@capgo/native-purchases/dist/esm/definitions.d.ts) — only the
// fields the IAP recharge flow actually reads, typed exactly against that
// plugin's declarations rather than invented.
export interface NativePurchaseProduct {
  readonly identifier: string;
  readonly priceString: string;
  readonly price: number;
}

export interface NativePurchaseTransaction {
  readonly transactionId: string;
  readonly productIdentifier: string;
  // StoreKit 2 JWS payload — this is what the backend's SignedDataVerifier
  // decodes (see POST /billing/iap/verify). Not present on Android.
  readonly jwsRepresentation?: string;
}

export interface CapacitorNativePurchasesPlugin {
  getProducts(options: { productIdentifiers: string[] }): Promise<{ products: NativePurchaseProduct[] }>;
  purchaseProduct(options: { productIdentifier: string }): Promise<NativePurchaseTransaction>;
}

declare global {
  interface Window {
    Capacitor?: {
      // Capacitor core (not a plugin) — always injected alongside Plugins.
      getPlatform?: () => string;
      Plugins?: {
        Haptics?: CapacitorHapticsPlugin;
        PushNotifications?: CapacitorPushPlugin;
        NativePurchases?: CapacitorNativePurchasesPlugin;
      };
    };
  }
}

export function isIosShell(): boolean {
  return window.Capacitor?.getPlatform?.() === 'ios';
}

// Best-effort — an empty array lets callers fall back to static price labels
// when the bridge or a specific product id isn't available.
export async function iapGetProducts(productIdentifiers: string[]): Promise<NativePurchaseProduct[]> {
  const plugin = window.Capacitor?.Plugins?.NativePurchases;
  if (!plugin) return [];
  try {
    const { products } = await plugin.getProducts({ productIdentifiers });
    return products;
  } catch {
    return [];
  }
}

// Throws on cancel/failure (mirrors AccountButton's existing Razorpay
// try/catch shape) — callers decide how to surface the error, this only
// resolves the transaction's signed JWS for backend verification.
export async function iapPurchase(productIdentifier: string): Promise<string> {
  const plugin = window.Capacitor?.Plugins?.NativePurchases;
  if (!plugin) throw new Error('In-app purchases are not available here');
  const transaction = await plugin.purchaseProduct({ productIdentifier });
  if (!transaction.jwsRepresentation) throw new Error('No signed transaction returned');
  return transaction.jwsRepresentation;
}

// Optional chaining makes these automatic no-ops in the browser or an app
// build older than the Haptics plugin — callers never need to feature-check.
export function hapticImpact(style: 'HEAVY' | 'MEDIUM' | 'LIGHT' = 'MEDIUM'): void {
  window.Capacitor?.Plugins?.Haptics?.impact({ style }).catch(() => {});
}
export function hapticSuccess(): void {
  window.Capacitor?.Plugins?.Haptics?.notification({ type: 'SUCCESS' }).catch(() => {});
}
export function hapticTick(): void {
  window.Capacitor?.Plugins?.Haptics?.selectionChanged().catch(() => {});
}
