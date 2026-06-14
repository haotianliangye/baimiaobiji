import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Book, Clock, Edit3, PieChart, Settings as SettingsIcon } from 'lucide-react';

export default function Layout() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-[100dvh] bg-stone-100 font-sans text-stone-900 overflow-hidden items-center justify-center">
      <div className="w-full max-w-md h-full bg-[#f4f4f0] shadow-sm ring-1 ring-black/5 flex flex-col relative overflow-hidden">
        {/* Global Nav */}
        <header className="flex h-12 shrink-0 items-center justify-between px-4 bg-black text-white">
          <h1 className="text-[15px] font-medium tracking-wide">白描笔记</h1>
          <button onClick={() => navigate('/settings')} className="p-1.5 hover:opacity-70 transition-opacity -mr-1.5">
            <SettingsIcon className="w-[18px] h-[18px]" />
          </button>
        </header>

        {/* Main Canvas */}
        <main className="flex-1 overflow-hidden bg-[#f4f4f0] selection:bg-black selection:text-white flex flex-col relative">
          <Outlet />
        </main>

        {/* Tab Bar */}
        <nav className="h-[60px] shrink-0 border-t border-stone-200/60 bg-[#f4f4f0]/90 backdrop-blur pb-safe z-50 relative">
          <div className="w-full h-full flex justify-around items-center px-2">
            <TabItem to="/" icon={<Edit3 />} label="记录" />
            <TabItem to="/diary" icon={<Book />} label="日记" />
            <TabItem to="/review" icon={<Clock />} label="回顾" />
            <TabItem to="/insights" icon={<PieChart />} label="洞察" />
          </div>
        </nav>
      </div>
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
