/* Google Analytics gtag.js + GTM dataLayer global types */
interface GtagEventParams {
  [key: string]: string | number | boolean | undefined;
}

interface ConsentParams {
  analytics_storage?: "granted" | "denied";
  ad_storage?: "granted" | "denied";
  ad_user_data?: "granted" | "denied";
  ad_personalization?: "granted" | "denied";
  wait_for_update?: number;
}

interface Window {
  gtag?: {
    (command: "consent", action: "default" | "update", params: ConsentParams): void;
    (command: "event" | "config" | "set", targetOrName: string, params?: GtagEventParams): void;
  };
  // dataLayer accepts both plain event objects and gtag Arguments objects
  dataLayer?: unknown[];
}
