/// <reference types="vite/client" />

declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: string;
  }
}
declare const process: {
  env: NodeJS.ProcessEnv;
};
