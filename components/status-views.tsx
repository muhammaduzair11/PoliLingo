'use client';
import Link from 'next/link';
import { ArrowRight, Mountain } from 'lucide-react';
import { Poli } from './art';
import { Header } from './site-chrome';
export function Loading() {
  return (
    <main id="main-content" className="loading-page" aria-busy="true">
      <div className="loading-mark">
        <Mountain size={42} />
      </div>
      <p>Getting your adventure ready…</p>
    </main>
  );
}
export function NotFoundView() {
  return (
    <>
      <Header />
      <main id="main-content" className="empty-page">
        <Poli pose="thinking" />
        <h1>A little off the trail.</h1>
        <p>This lesson or language could not be found.</p>
        <Link href="/" className="button button-purple">
          Find your way back <ArrowRight size={18} />
        </Link>
      </main>
    </>
  );
}
