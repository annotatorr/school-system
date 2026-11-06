import React from 'react';
import { createRoot } from 'react-dom/client';
import { PortalApp } from '../../../packages/portal-ui/src/PortalApp';
const config = {
  key: 'principal',
  title: 'Principal',
  subtitle: 'Leadership workspace',
  intro: 'Review school performance, approvals, reports, discipline and delegated permissions.',
  overview: 'Leadership overview',
  modules: [
    'school performance',
    'students',
    'classes',
    'teachers and staff',
    'attendance monitoring',
    'examinations',
    'results review',
    'timetable oversight',
    'leave and substitutions',
    'discipline and welfare',
    'school calendar',
    'fee overview',
    'reports',
    'report cards',
    'approvals',
    'notifications',
    'audit history',
    'support',
  ],
  urlHint: 'principal.yourdomain.com',
} as const;
createRoot(document.getElementById('root')!).render(<React.StrictMode><PortalApp config={config} /></React.StrictMode>);
