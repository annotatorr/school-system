import React from 'react';
import { createRoot } from 'react-dom/client';
import { PortalApp } from '../../../packages/portal-ui/src/PortalApp';
const config = {
  key: 'student',
  title: 'Student',
  subtitle: 'Student learning space',
  intro: 'View your learning materials, assignments, results, attendance and fee statements.',
  overview: 'My learning space',
  modules: [
    'my class',
    'my assignments',
    'learning materials',
    'cats and assessments',
    'attendance',
    'results',
    'report cards',
    'student progress',
    'library',
    'fee statement',
    'timetable',
    'school calendar',
    'announcements',
    'messages',
    'documents',
    'support',
  ],
  urlHint: 'student.yourdomain.com',
} as const;
createRoot(document.getElementById('root')!).render(<React.StrictMode><PortalApp config={config} /></React.StrictMode>);
