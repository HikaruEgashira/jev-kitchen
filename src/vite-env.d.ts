interface ImportMetaEnv {
  readonly VITE_COMMIT_SHA?: string;
  readonly [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env?: ImportMetaEnv;
}
