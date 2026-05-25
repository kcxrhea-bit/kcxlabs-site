# KCx Labs Deployment Notes

This project is prepared for first deployment as a Vite static frontend on Vercel.

## Local Pre-Deployment Checks

Install dependencies:

```powershell
npm.cmd install
```

Run production build:

```powershell
npm.cmd run build
```

## Vercel Project Settings

- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

No backend services are required for this homepage deployment.
