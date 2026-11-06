import React from 'react';
import { createRoot } from 'react-dom/client';
import { PortalApp } from '../../../packages/portal-ui/src/PortalApp';
const config = {
  key: 'teacher',
  title: 'Teacher',
  subtitle: 'Teaching workspace',
  intro: 'Manage assigned classes, attendance, lesson plans, learning materials, assignments and results.',
  overview: 'Teaching overview',
  modules: [
    'my classes',
    'my students',
    'attendance',
    'lesson plans',
    'learning materials',
    'assignments',
    'cats and assessments',
    'marks and results',
    'results',
    'report cards',
    'timetable',
    'books issued',
    'student progress',
    'parent communication',
    'leave requests',
    'substitute arrangements',
    'notifications',
    'reports',
  ],
  urlHint: 'teacher.yourdomain.com',
} as const;
createRoot(document.getElementById('root')!).render(<React.StrictMode><PortalApp config={config} /></React.StrictMode>);
