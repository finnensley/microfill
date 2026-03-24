'use client'

import { useState } from 'react';
import { supabase } from '@/lib/supabase-client'; 

export default function LandingPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');

  const handleSubscribe = async (e) => {
    e.preventDefault();
    const { error } = await supabase.from('leads').insert([{ email }]);
    if (error) setStatus('Error joining list.');
    else setStatus('You’re on the list! We’ll reach out for the pilot.');
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6">
      <div className="max-w-3xl text-center">
        <h2 className="text-green-400 font-mono mb-4 text-sm tracking-widest uppercase">
          soloSoftwareDev LLC Presents
        </h2>
        <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight">
          Eliminate <span className="text-slate-400 italic">Shadow Inventory.</span>
        </h1>
        <p className="text-xl text-slate-400 mb-10 leading-relaxed">
          The lightweight, security-first sync tool for micro-fulfillment. 
          Stop manual tallying. Scan in, sync out, and never oversell again.
        </p>

        <form 
        onSubmit={handleSubscribe} 
        className="flex flex-col md:flex-row gap-4 justify-center">
          <input
            type="email"
            placeholder="Enter your work email"
            className="px-6 py-4 rounded-lg bg-slate-800 border border-slate-700 focus:outline-none focus:border-green-500 w-full md:w-80"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button className="bg-green-500 hover:bg-green-400 text-slate-900 font-bold py-4 px-8 rounded-lg transition-all transform hover:scale-105">
            Request Pilot Access
          </button>
        </form>
        
        {status && <p className="mt-4 text-green-400 font-medium">{status}</p>}
        
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 text-sm text-slate-500 uppercase tracking-widest">
          <div>✓ Shopify Verified</div>
          <div>✓ AES-256 Encrypted</div>
          <div>✓ Mobile Native</div>
        </div>
      </div>
    </div>
  );
}