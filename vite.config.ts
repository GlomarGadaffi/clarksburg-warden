import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import fs from 'fs'

// Web Serial requires a secure context. localhost is already secure, but to test
// from another device on the LAN you need HTTPS. Enable it only when the dev certs
// are present so a fresh clone can still `npm run dev` / `npm run build`.
const certKey = './cert-key.pem'
const certCrt = './cert.pem'
const https =
  fs.existsSync(certKey) && fs.existsSync(certCrt)
    ? { key: fs.readFileSync(certKey), cert: fs.readFileSync(certCrt) }
    : undefined

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  server: {
    host: true,
    https,
  },
})
