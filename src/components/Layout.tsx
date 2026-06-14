import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Book, Clock, Edit3, PieChart, Settings as SettingsIcon } from 'lucide-react';

export default function Layout() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-[100dvh] bg-white font-sans text-stone-900 overflow-hidden">
      {/* Global Nav */}
      <header className="flex h-11 shrink-0 items-center justify-between px-4 bg-black text-white">
        <h1 className="text-sm font-medium tracking-tight">白描笔记</h1>
        <button onClick={() => navigate('/settings')} className="p-1 hover:opacity-70 transition-opacity">
          <SettingsIcon className="w-4 h-4" />
        </button>
      </header>

      {/* Main Canvas */}
      <main className="flex-1 overflow-hidden bg-stone-50 selection:bg-black selection:text-white flex justify-center">
        <div className="w-full max-w-md h-full bg-white shadow-sm ring-1 ring-black/5 flex flex-col relative">
          <Outlet />
        </div>
      </main>

      {/* Tab Bar */}
      <nav className="h-16 shrink-0 border-t border-stone-200 bg-white/90 backdrop-blur pb-safe">
        <div className="mx-auto max-w-md w-full h-full flex justify-around items-center px-2">
          <TabItem to="/" icon={<Edit3 />} label="记录" />
          <TabItem to="/diary" icon={<Book />} label="日记" />
          <TabItem to="/review" icon={<Clock />} label="回顾" />
          <TabItem to="/insights" icon={<PieChart />} label="洞察" />
        </div>
      </nav>
    </div>
  );
}

function TabItem({ to, icon, label, disabled = false }: { to: string, icon: React.ReactNode, label: string, disabled?: boolean }) {
  if (disabled) {
    return (
      <div className="flex flex-col items-center justify-center p-2 opacity-30 cursor-not-allowed">
        {React.cloneElement(icon as React.ReactElement<any>, { className: 'w-5 h-5 mb-1' })}
        <span className="text-[10px] tracking-wide">{label}</span>
      </div>
    );
  }
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center p-2 transition-colors duration-200 ${
          isActive ? 'text-black' : 'text-stone-400 hover:text-stone-600'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {React.cloneElement(icon as React.ReactElement<any>, {
            className: `w-5 h-5 mb-1 ${isActive ? 'stroke-[2.5px]' : 'stroke-2'}`,
          })}
          <span className={`text-[10px] tracking-wide ${isActive ? 'font-medium' : ''}`}>{label}</span>
        </>
      )}
    </NavLink>
  );
}
