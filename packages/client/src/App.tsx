/**
 * App root — React Router v6 with createBrowserRouter.
 * Routes:
 *   /               → HomePage
 *   /r/:roomCode    → LobbyPage (lobby + scenario picker)
 *   /game/:roomCode → GamePage (all in-game phases)
 */

import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { Suspense, lazy } from 'react';

const HomePage = lazy(() => import('./pages/HomePage.js'));
const LobbyPage = lazy(() => import('./pages/LobbyPage.js'));
const GamePage = lazy(() => import('./pages/GamePage.js'));

function RootLayout(): JSX.Element {
  return (
    <div className="app">
      <Suspense
        fallback={
          <div className="min-h-screen bg-bunker-bg flex items-center justify-center">
            <span className="font-oswald text-xl text-bunker-muted animate-pulse">…</span>
          </div>
        }
      >
        <Outlet />
      </Suspense>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        path: '/',
        element: <HomePage />,
      },
      {
        path: '/r/:roomCode',
        element: <LobbyPage />,
      },
      {
        path: '/game/:roomCode',
        element: <GamePage />,
      },
    ],
  },
]);

function App(): JSX.Element {
  return <RouterProvider router={router} />;
}

export default App;
