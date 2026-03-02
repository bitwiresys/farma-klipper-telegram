 'use client';

 import { useEffect, useMemo, useState } from 'react';

 type HealthState =
   | { status: 'idle' }
   | { status: 'loading' }
   | { status: 'ok'; body: unknown }
   | { status: 'error'; message: string };

 export default function Home() {
   const backendBaseUrl = useMemo(
     () => process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, '') ?? '',
     [],
   );

   const [health, setHealth] = useState<HealthState>({ status: 'idle' });

   useEffect(() => {
     if (!backendBaseUrl) {
       setHealth({
         status: 'error',
         message: 'NEXT_PUBLIC_BACKEND_URL is not set',
       });
       return;
     }

     const url = `${backendBaseUrl}/api/health`;
     const ac = new AbortController();

     (async () => {
       try {
         setHealth({ status: 'loading' });
         const res = await fetch(url, {
           method: 'GET',
           cache: 'no-store',
           signal: ac.signal,
         });

         const text = await res.text();
         let body: unknown = text;
         try {
           body = JSON.parse(text);
         } catch {
           body = text;
         }

         if (!res.ok) {
           setHealth({
             status: 'error',
             message: `HTTP ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
           });
           return;
         }

         setHealth({ status: 'ok', body });
       } catch (e) {
         const msg = e instanceof Error ? e.message : String(e);
         setHealth({ status: 'error', message: msg });
       }
     })();

     return () => ac.abort();
   }, [backendBaseUrl]);

   return (
     <main className="p-6">
       <h1 className="text-xl font-semibold">Farma</h1>

       <p className="mt-2 text-slate-300">Mini App bootstrap complete.</p>

       <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
         <div className="text-sm text-slate-300">Backend</div>
         <div className="mt-1 break-all font-mono text-xs text-slate-200">
           {backendBaseUrl || '(not set)'}
         </div>

         <div className="mt-3 text-sm text-slate-300">/api/health</div>
         <div className="mt-1 rounded bg-slate-950 p-3 font-mono text-xs text-slate-100">
           {health.status === 'idle' && 'idle'}
           {health.status === 'loading' && 'loading...'}
           {health.status === 'ok' && JSON.stringify(health.body, null, 2)}
           {health.status === 'error' && health.message}
         </div>
       </div>
     </main>
   );
 }
