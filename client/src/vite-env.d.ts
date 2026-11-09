/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** AG Studio licence key (a trial key works). Optional: Studio runs without one and shows a watermark. */
  readonly VITE_AG_STUDIO?: string;
}
