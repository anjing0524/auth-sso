'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function ConsentContent() {
  const searchParams = useSearchParams();
  const consentCode = searchParams.get('consent_code');
  const scope = searchParams.get('scope') || '';

  useEffect(() => {
    if (consentCode) {
      fetch('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accept: true,
          consent_code: consentCode,
          scopes: scope.split(' ').filter(Boolean)
        })
      })
      .then(res => res.json())
      .then(data => {
        if (data.redirectURI) {
          window.location.href = data.redirectURI;
        } else if (data.url) {
          window.location.href = data.url;
        }
      })
      .catch(console.error);
    }
  }, [consentCode, scope]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center p-8 bg-white rounded-lg shadow-sm">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <h2 className="text-xl font-semibold mb-2">正在验证授权信息</h2>
        <p className="text-gray-500">正在为您安全重定向，请稍候...</p>
      </div>
    </div>
  );
}

export default function ConsentPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <ConsentContent />
    </Suspense>
  );
}
