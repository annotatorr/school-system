import React from 'react';
import { createRoot } from 'react-dom/client';
import { PortalApp } from '../../../packages/portal-ui/src/PortalApp';
const config = {
  key: 'parent',
  title: 'Parent / Guardian',
  subtitle: 'Family workspace',
  intro: "Follow linked children's admissions, attendance, results and fee statements.",
  overview: 'Family overview',
  modules: [
    'linked children',
    'attendance updates',
    'timetable',
    'academic performance',
    'examination results',
    'assignments',
    'report cards',
    'school announcements',
    'school calendar',
    'fee statements',
    'payments',
    'receipts',
    'admission applications',
    'documents',
    'messages and communication',
    'notifications',
    'support',
  ],
  urlHint: 'parent.yourdomain.com',
} as const;
createRoot(document.getElementById('root')!).render(<React.StrictMode><PortalApp config={config} /></React.StrictMode>);
