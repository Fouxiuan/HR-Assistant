import { useEffect, useState } from 'react';
import { Shell } from './Shell';
import { CandidatesPage } from '../features/candidates/CandidatesPage';
import { GuidePage } from '../features/guide/GuidePage';
import { ResultsPage } from '../features/results/ResultsPage';
import { RunPage } from '../features/run/RunPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { MailPage } from '../features/mail/MailPage';

const pages = { '/guide': GuidePage, '/run': RunPage, '/settings': SettingsPage, '/results': ResultsPage, '/candidates': CandidatesPage, '/mail': MailPage } as const;
export type AppRoute = keyof typeof pages;
function currentRoute(): AppRoute { const path = window.location.hash.replace(/^#/, '').split(/[?#]/, 1)[0]; if (['/jobs', '/keywords', '/ai-config'].includes(path)) return '/settings'; return path in pages ? path as AppRoute : '/guide'; }

export function App() {
  const [route, setRoute] = useState<AppRoute>(currentRoute);
  useEffect(() => { const update = () => setRoute(currentRoute()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  const Page = pages[route];
  return <Shell route={route}><Page /></Shell>;
}
