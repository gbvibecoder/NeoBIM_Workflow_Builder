export { useAvatar } from "./useAvatar";
// `useExecution` was re-exported here historically but creates a server-side
// render trap: its module graph pulls in `sonner` (toast), which invokes
// `document.getElementsByTagName(...)` at module-eval time. Any file that
// imports `@/hooks` for `useLocale` — including `app/global-error.tsx`,
// `error.tsx`, `not-found.tsx`, `contact/page.tsx`, `privacy/page.tsx`,
// `MobileGate.tsx`, `CookieConsent.tsx` — would transitively evaluate
// `sonner` on the server and crash with TypeError in SSR.
//
// All real consumers of the hook import it directly from the feature path:
//   import { useExecution } from "@/features/execution/hooks/useExecution";
// (verified via grep across src/ — nothing depended on the barrel export).
//
// Removing the re-export breaks the SSR chain without changing any import
// site. If you need `useExecution` in a new file, import from the feature
// path above. Do NOT re-add it here.
export { useLocale } from "./useLocale";
