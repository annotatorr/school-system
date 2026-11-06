import React from 'react';
import { createRoot } from 'react-dom/client';
import { PortalApp } from '../../../packages/portal-ui/src/PortalApp';
const config = {
  key: 'secretary',
  title: 'Secretary',
  subtitle: 'School office',
  intro: 'Manage admissions, student records, guardians, teacher applications and permitted fee administration.',
  overview: 'Office overview',
  modules: [
    'admissions',
    'student records',
    'parents and guardians',
    'teacher applications',
    'fee administration',
    'fee structure',
    'payments',
    'timetable',
    'documents and certificates',
    'events and calendar',
    'transport',
    'meals',
    'reports',
    'notifications',
    'audit history',
    'support',
  ],
  urlHint: 'secretary.yourdomain.com',
} as const;
createRoot(document.getElementById('root')!).render(<React.StrictMode><PortalApp config={config} /></React.StrictMode>);
