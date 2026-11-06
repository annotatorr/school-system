import React from 'react';
import { createRoot } from 'react-dom/client';
import { PortalApp } from '../../../packages/portal-ui/src/PortalApp';
const config = {
  key: 'platform-admin',
  title: 'Platform Admin',
  subtitle: 'Platform control centre',
  intro: 'Manage school onboarding, subscriptions, maintenance revenue, accounts and audit activity.',
  overview: 'Platform overview',
  modules: [
    'school onboarding',
    'subscription control',
    'platform revenue',
    'users and roles',
    'payments',
    'reports',
    'audit log',
    'system settings',
    'support',
  ],
  urlHint: 'platform-admin.yourdomain.com',
} as const;
createRoot(document.getElementById('root')!).render(<React.StrictMode><PortalApp config={config} /></React.StrictMode>);
