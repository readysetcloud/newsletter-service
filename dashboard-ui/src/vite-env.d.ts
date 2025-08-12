/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
  readonly VITE_API_BASE_URL: string
  readonly VITE_AWS_REGION: string
  readonly VITE_AWS_COGNITO_USER_POOL_ID: string
  readonly VITE_AWS_COGNITO_USER_POOL_CLIENT_ID: string
  readonly VITE_AWS_COGNITO_DOMAIN: string
  readonly VITE_MOMENTO_API_KEY: string
  readonly VITE_MOMENTO_CACHE_NAME: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
